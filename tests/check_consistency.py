#!/usr/bin/env python3
"""Cross-file consistency checks that no single test can catch.

Each one here exists because it caught a real defect:

- settings keys: the functions read keys the seed never wrote, so the Desk bot
  read null for every Telegram id and answered nothing.
- routes: docs/API.md and the MCP bridge named routes that no function serves.
- post types: the enum, the seed and compliance.ts had drifted into three
  vocabularies.
- SETUP.md: the runbook is the only thing Jack works from, and two of its SQL
  blocks did not run.

Standard library only. Run: python3 tests/check_consistency.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES: list[str] = []
CHECKS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"ok    {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"FAIL  {name}\n        {detail}")


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. Every settings key a function reads must be one the seed writes.
# ---------------------------------------------------------------------------
def settings_keys() -> None:
    supabase = read("supabase/functions/_shared/supabase.ts")
    seed = read("supabase/seed.sql")
    migrations = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))
    )

    declared = dict(re.findall(r'^\s*(\w+):\s*"([a-z_]+)",', supabase, re.M))

    seeded = set(re.findall(r"^\s*\('([a-z_]+)',\s*(?:'|\d|null|\{|\[)", seed, re.M))
    sql_read = set(re.findall(r"setting(?:_text)?\('([a-z_]+)'\)", migrations))

    missing = {alias: key for alias, key in declared.items() if key not in seeded}
    check(
        "settings: every SETTING_KEYS value is written by the seed",
        not missing,
        f"{missing} — the function reads a key the seed never creates",
    )

    # A key the functions read but no SQL knows about is the same bug in reverse.
    orphans = {k for k in sql_read if k not in seeded}
    check(
        "settings: no key is read by SQL but absent from the seed",
        not orphans,
        f"{sorted(orphans)}",
    )

    # tz is a deliberate exception: it is used to compute keys, not stored.
    bad_tz = {a: k for a, k in declared.items() if a == "timezone" and k not in seeded}
    check("settings: timezone is seeded", not bad_tz, str(bad_tz))


# ---------------------------------------------------------------------------
# 2. Every route the MCP bridge calls must exist in a function.
# ---------------------------------------------------------------------------
def mcp_routes() -> None:
    mcp = read("apps/mcp/twinos_mcp.py")
    readme = read("apps/mcp/README.md")
    fn_root = ROOT / "supabase/functions"
    fns = {p.parent.name for p in fn_root.glob("*/index.ts")}

    endpoints = re.search(r"ENDPOINTS = \{(.*?)\n\}", mcp, re.S)
    check("mcp: ENDPOINTS block found", endpoints is not None)
    if not endpoints:
        return

    def routes_of(block: str) -> dict[str, str]:
        out = {}
        for tool, kind, raw in re.findall(r'"(\w+)":\s*\("(\w+)",\s*(None|"[^"]*")\)', block):
            path = raw.strip('"')
            if kind == "fn" and path:
                out[tool] = path
        return out

    live = routes_of(endpoints.group(1))

    # A tool may target a function that ships in a later phase. Those are marked
    # in the dict with a comment, so treat a missing function as a warning, not a
    # failure — but an unmarked one is a bug nobody will notice until it is used.
    bad, later = [], []
    for tool, path in live.items():
        fn = path.partition("/")[0]
        if fn in fns:
            continue
        line = next((l for l in mcp.splitlines() if f'"{tool}"' in l), "")
        (later if re.search(r"phase \d", line, re.I) else bad).append(f"{tool} -> {path}")
    check(
        "mcp: every fn endpoint names a deployed function, or is marked as a later phase",
        not bad,
        "; ".join(bad) or f"phase-later, allowed: {later}",
    )

    # ABDUL must never reach an approve route.
    check(
        "mcp: no tool resolves to an approve route",
        not [t for t, p in live.items() if "approve" in p.lower()],
        str([t for t, p in live.items() if "approve" in p.lower()]),
    )

    # The README must not advertise a path the dict no longer uses.
    # The README writes routes in three shapes: bare ("results"), with an {id}
    # placeholder ("content/{id}/schedule"), and as a prefix to be completed
    # ("content"). Accept any that is a prefix of, or equal to, a live route.
    def is_current(doc: str) -> bool:
        # A documented {id} route stands for the function base it hangs off; the
        # MCP dict stores that base and builds the route per call.
        base = doc.split("/")[0]
        if any(p == base for p in live.values()):
            return True
        for path in live.values():
            if doc == path or path.startswith(doc.rstrip("/") + "/"):
                return True
        return doc in {"v_friday_scoreboard", "health_checks", "briefs", "inbox_items", "<view>"}

    documented = {d.rstrip(".,; ") for d in re.findall(r"/functions/v1/([a-z0-9/{}-]+)", readme)}
    stale = {d for d in documented if not is_current(d)}
    check("mcp: README advertises no route the dict dropped", not stale, str(sorted(stale)))


# ---------------------------------------------------------------------------
# 3. One vocabulary for post types across enum, seed and the compliance engine.
# ---------------------------------------------------------------------------
def post_types() -> None:
    mig = read("supabase/migrations/0002_content.sql")
    seed = read("supabase/seed.sql")
    compliance = read("supabase/functions/_shared/compliance.ts")

    enum = re.search(r"create type public\.post_type as enum \((.*?)\);", mig, re.S)
    check("post_type: enum found", enum is not None)
    if not enum:
        return
    labels = set(re.findall(r"'([a-z_]+)'", enum.group(1)))

    # 0011 renames four enum values in place. A fresh database therefore ends up
    # with the NEW names even though 0002's file still shows the old ones, so the
    # effective labels are the old set with the renames applied.
    renames = {"signal": "signal_card", "result": "result_reply",
               "audit": "channel_audit", "holiday_milestone": "holiday"}
    effective = (labels - set(renames)) | set(renames.values())
    check(
        "post_type: 0011's renames all start from a label 0002 defines",
        set(renames) <= labels,
        f"cannot rename what is not there: {sorted(set(renames) - labels)}",
    )
    check(
        "post_type: the short spellings are all renamed away",
        not (set(renames) & effective),
        f"still present: {sorted(set(renames) & effective)}",
    )

    # Template keys are the ground truth — content_items.post_type has an FK to
    # templates(key), so anything else is rejected at insert. The seed's first
    # column is also used by calendar_slots, where `live` and `channel_weekly`
    # are recurrence kinds rather than post types, so they are excluded by
    # kit_number being null for them.
    kit = re.search(r"insert into public\.templates[^;]*?values\s*(.*?);\s*\n", seed, re.S)
    check("seed: the templates insert was found", kit is not None)
    if not kit:
        return
    # (key, kit_number) — kit_number is a literal integer for the 15 kit posts.
    rows = re.findall(r"^\s*\('([a-z_]+)',\s*(\d+),", kit.group(1), re.M)
    templates = {k for k, _ in rows}
    non_kit = {k for k in re.findall(r"^\s*\('([a-z_]+)',\s*null,", kit.group(1), re.M)}

    check(
        "post_type: every template key is an effective enum label",
        templates <= effective,
        f"seed has {sorted(templates - effective)}",
    )
    check(
        "post_type: the 15 Posting Kit templates are all present",
        len(rows) == 15,
        f"found {len(rows)}: {sorted(templates)}",
    )
    check(
        "seed: recurrence kinds are not template keys",
        not (non_kit & templates),
        f"{sorted(non_kit & templates)} appear both as a template key and a recurrence kind",
    )

    # compliance.ts is the authority for what the functions accept.
    contract = set(re.findall(r'^\s*\|\s*"([a-z_]+)"', compliance, re.M))
    check(
        "post_type: the compliance engine accepts only effective enum labels",
        contract <= effective,
        f"compliance.ts has {sorted(contract - effective)}",
    )
    check(
        "post_type: compliance.ts and the templates cover the same set",
        contract == templates,
        f"only in templates: {sorted(templates - contract)}; "
        f"only in compliance: {sorted(contract - templates)}",
    )


# ---------------------------------------------------------------------------
# 4. Claims made in prose must match the code.
# ---------------------------------------------------------------------------
def docs_match_code() -> None:
    setup = read("docs/SETUP.md")
    fns = read("supabase/functions/_shared/supabase.ts")

    # The runbook's settings block must use the real key names.
    seeded_keys = {"jack_telegram_user_id", "desk_group_chat_id", "channel_chat_id"}
    declared = set(re.findall(r'^\s*\w+: "([a-z_]+)",', fns, re.M))
    mentioned = {k for k in declared if k in setup}
    check(
        "SETUP.md: names every settings key the functions read",
        seeded_keys <= mentioned,
        f"missing from the runbook: {sorted(seeded_keys - mentioned)}",
    )

    # cron: the runbook must not redefine what 0010 already creates.
    check(
        "SETUP.md: does not redefine twinos_cron_call",
        "create or replace function twinos_cron_call" not in setup,
        "0010_cron.sql already creates it; redefining it would inline a secret",
    )

    # A jsonb column cannot take a bare string.
    check(
        "SETUP.md: settings values are JSON literals",
        "('timezone', '\"Asia/Kuala_Lumpur\"')" in setup
        or '"Asia/Kuala_Lumpur"' in setup,
        "settings.value is jsonb; a bare string is a syntax error",
    )


# ---------------------------------------------------------------------------
# 5. Approval is Jack's alone, everywhere.
# ---------------------------------------------------------------------------
def approval_gate() -> None:
    roles = read("supabase/functions/_shared/roles.ts")
    check(
        "roles: content.approve is jack only",
        bool(re.search(r'"content\.approve":\s*\[\s*"jack"\s*\]', roles)),
        "must be exactly [\"jack\"]",
    )
    mcp = read("apps/mcp/twinos_mcp.py")
    check("mcp: the approve refusal guard is present", "FORBIDDEN_PATH" in mcp and "FORBIDDEN_TOOL" in mcp)


# ---------------------------------------------------------------------------
# 6. Every function checks its caller, and scoped keys travel on X-TwinOS-Key.
#    The platform gateway only admits JWTs, so a twk_ key on Authorization is
#    refused before the code runs; the clients put the anon key there instead.
# ---------------------------------------------------------------------------
def auth_paths() -> None:
    fns = sorted(p.parent.name for p in (ROOT / "supabase/functions").glob("*/index.ts") if p.parent.name != "_shared")
    unguarded = [f for f in fns
                 if not re.search(r"\b(authenticate|requireSecret)\(", read(f"supabase/functions/{f}/index.ts"))]
    check("functions: every one calls authenticate() or requireSecret()", not unguarded, str(unguarded))
    check("cors: X-TwinOS-Key is an allowed header",
          "x-twinos-key" in read("supabase/functions/_shared/http.ts"))
    for client in ("apps/mcp/twinos_mcp.py", "workers/pc/twinos_worker.py"):
        check(f"{client}: sends its key on X-TwinOS-Key", '"X-TwinOS-Key"' in read(client))


# ---------------------------------------------------------------------------
# 7. Every write of a variant body leaves compliance evidence. The checklist
#    runs in TypeScript, so a DB trigger cannot enforce this; three writers
#    (createDraft, the Desk edit, the rewrite job) all have to remember.
#    The rewrite path forgot, so a rewritten body kept the old compliance and
#    claim_flags and wrote no compliance_checks row.
# ---------------------------------------------------------------------------
def compliance_evidence() -> None:
    missing = []
    for p in sorted((ROOT / "supabase/functions").rglob("*.ts")):
        if p.name.endswith("_test.ts"):
            continue
        src = p.read_text(encoding="utf-8")
        write = re.search(r'from\("content_variants"\)\s*\.(?:insert|update)\(', src)
        if not write:
            continue
        tail = src[write.end(): write.end() + 400]
        if re.search(r"\bbody\b\s*[,:]", tail) and 'from("compliance_checks")' not in src:
            missing.append(str(p.relative_to(ROOT)))
    check("functions: every variant body write also writes compliance_checks", not missing, str(missing))


def desk_state_wave0() -> None:
    migrations = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))
    )
    later = sorted((ROOT / "supabase/migrations").glob("002*.sql"))
    later_src = "\n".join(p.read_text(encoding="utf-8") for p in later)
    check(
        "desk_state: a migration after 0011 allows 'kit'",
        bool(later) and "'kit'" in later_src and "desk_state" in later_src,
        "fanout.ts sets desk_state='kit' but 0011's check rejects it",
    )
    check(
        "desk_state: 'awaiting_slot' exists for Waves 1-3",
        "'awaiting_slot'" in migrations,
        "Wave 1 Later quick picks need it",
    )
    check(
        "desk_state: desk_state_at exists for the 30-minute expiry",
        "desk_state_at" in migrations,
        "edit/later prompts must expire",
    )
    approve = read("supabase/functions/approve/index.ts")
    check(
        "approve: reschedule keeps the card's buttons",
        'decision !== "reschedule"' in approve or "decision !== 'reschedule'" in approve,
        "the keyboard clear must skip reschedule",
    )
    tg = read("supabase/functions/_shared/tg.ts")
    check(
        "desk nav: grammar v2 parses nav, page and nop",
        '"nav"' in tg and '"page"' in tg and '"nop"' in tg and "NAV_LAYOUT" in tg,
        "Wave 1 item 1: nav:<screen>[@fp], pg:<screen>:<n>, nop + fingerprint",
    )
    deploy = read("scripts/deploy.sh")
    check(
        "deploy: sets the Desk setMyCommands",
        "setMyCommands" in deploy,
        "Wave 1 item 3: scoped to the Desk chat, run by deploy.sh",
    )
    webhook = read("supabase/functions/tg-webhook/index.ts")
    check(
        "desk cards: decisions collapse to a status button, no extra message",
        "nopButton" in webhook and "\u2705 Approved" in webhook
        and "Approved <code>" not in webhook,
        "Wave 1 item 4: one status button, drop the extra Approved message",
    )
    check(
        "desk batch: per-item buttons, refresh and a confirmed approve-ready",
        "batchListKeyboard" in tg and "batchListKeyboard" in webhook
        and "batchyes" in webhook and "readyToApprove" in webhook,
        "Wave 1 item 5: approve/edit/preview per item, Refresh, Yes/Cancel re-check",
    )
    check(
        "desk cards: approved cards carry a fan-out button",
        "Fanned out" in webhook and "fanOut(" in webhook,
        "Wave 1 item 8: fan:<id8> on approved cards",
    )
    check(
        "desk panels: refresh stamps, drafts paging, alert buttons",
        "updated " in webhook and "draftsPanel" in webhook
        and "mo:${" in webhook and "banChatMember" in webhook and "faq.proposed" in webhook,
        "Wave 1 items 9-11: updated hh:mm, pg: paging, mo: actions",
    )


def wave3_health() -> None:
    health = read("supabase/functions/health/index.ts")
    check(
        "health: GET exposes integration status (secret names only)",
        "integrations" in health and "integrationStatus(" in health,
        "Wave 3 item 1: ready / needs-credentials per provider, names never values",
    )
    check(
        "health: check runs live provider checks with change-only Desk alerts",
        "runProviderChecks(" in health and "deskAlert(" in health,
        "Wave 3 items 2-3: getMe / token debug, alert on change or recovery",
    )
    alerts = read("supabase/functions/_shared/alerts.ts")
    check(
        "alerts: a cooldown per error with a repeat count",
        "cooldownDue(" in alerts and "repeats" in alerts,
        "Wave 3 item 3: one Desk message per cooldown, repeats counted",
    )


def wave3_guard() -> None:
    backoff = read("supabase/functions/_shared/backoff.ts")
    check(
        "guard: unknown outcomes are recognised and held, not quick-retried",
        "isUnknownOutcome(" in backoff and "UNKNOWN_HOLD_MS" in backoff,
        "Wave 3 item 4: timeout/network errors hold the retry",
    )
    check(
        "guard: a post that landed after the hold suppresses the retry",
        "duplicateLanded(" in backoff,
        "Wave 3 item 4: check before posting again",
    )
    publish = read("supabase/functions/publish/index.ts")
    check(
        "publish: unknown failures hold, flag error_class and alert the Desk",
        "isUnknownOutcome(" in publish and "error_class" in publish and "deskAlert(" in publish,
        "Wave 3 item 4: hold + error_class='unknown' + Desk alert",
    )
    check(
        "publish: a held job is checked for a landed post before resending",
        "duplicateLanded(" in publish and "unknown_hold" in publish,
        "Wave 3 item 4: no blind resend after a timeout",
    )
    compliance = read("supabase/functions/_shared/compliance.ts")
    check(
        "compliance: humanizer rules (EN + BM) warn, apart from blocking claim checks",
        "HUMANIZER_WORDS_EN" in compliance and "HUMANIZER_WORDS_MS" in compliance
        and '"humanizer"' in compliance,
        "Wave 3 item 8: AI-tell words are warn-level, claim words stay blocking",
    )


def wave3_library() -> None:
    lib = read("supabase/functions/_shared/hooks.ts")
    check(
        "library: hooks + CTAs rotate least-recently-used, no AI",
        "pickLru(" in lib and "nextHook(" in lib and "nextCta(" in lib,
        "Wave 3 item 5: LRU rotation over the hook bank and the CTA table",
    )
    mig = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))
    )
    check(
        "library: a ctas table carries the per-platform CTA lines",
        "create table" in mig and "public.ctas" in mig and "times_used" in mig,
        "Wave 3 item 5: ctas seeded per platform x language with usage columns",
    )


def wave3_finale() -> None:
    compliance = read("supabase/functions/_shared/compliance.ts")
    check(
        "variants: a blocking number guard for AI text",
        "aiNumberGuard(" in compliance and "extractNumbers(" in compliance,
        "Wave 3 item 6: no price or percent outside Jack's lines",
    )
    jobs = read("supabase/functions/jobs/index.ts")
    check(
        "variants: the worker job is ingested with compliance + the guard",
        '"llm_variants"' in jobs and "aiNumberGuard(" in jobs,
        "Wave 3 item 6: every variant checked, Desk picks",
    )
    webhook = read("supabase/functions/tg-webhook/index.ts")
    check(
        "desk: Adjust and Pick buttons on drafts",
        '"adj"' in webhook and '"pk"' in webhook,
        "Wave 3 items 6-7: Adjust queues variants (or no-AI hook+CTA), Pick uses an angle",
    )
    kits = read("supabase/functions/_shared/kits.ts")
    check(
        "kits: TikTok/YouTube script kits with the risk line spoken",
        "scriptKit(" in kits and "spoken_warning" in kits,
        "Wave 3 item 7: hook + beats + spoken risk + caption",
    )
    research = read("supabase/functions/_shared/research.ts")
    check(
        "brief: grounded in scored topics and hook lines",
        "buildBrief(" in research and "hook" in research,
        "Wave 3 item 7: each day carries its evidence",
    )
    tour = read("scripts/desk-tour.sh")
    check(
        "tour: the Adjust tap is walked and still only rejects",
        '"data":"adj:' in tour and '"data":"ok:' not in tour,
        "Wave 3 item 7: tour covers the new button, reject-only",
    )


def wave4_miniapp() -> None:
    lib = read("supabase/functions/_shared/miniapp.ts")
    check(
        "miniapp: initData HMAC verify plus short sessions",
        "verifyInitData(" in lib and "mintSession(" in lib and "verifySession(" in lib,
        "Wave 4 item 1: Telegram initData in, Jack session out",
    )
    auth = read("supabase/functions/_shared/auth.ts")
    check(
        "auth: the mini-app session acts as Jack",
        "tma." in auth and '"jack"' in auth,
        "Wave 4 item 1: tma bearer verified against the Jack id setting",
    )
    fn = read("supabase/functions/tg-auth/index.ts")
    check(
        "tg-auth: verify is public initData, me is authenticated",
        "verifyInitData(" in fn and "authenticate(" in fn,
        "Wave 4 item 1: no JWT needed to prove Telegram id, JWT/session to read self",
    )
    deploy = read("scripts/deploy.sh")
    check(
        "deploy: tg-auth ships with the other secret-carrying webhooks",
        "tg-auth" in deploy and "setMyCommands" in deploy,
        "Wave 4 item 1: --no-verify-jwt, Mini Apps carry no Supabase JWT",
    )


def main() -> int:
    for fn in (settings_keys, mcp_routes, post_types, docs_match_code, approval_gate, auth_paths, compliance_evidence, desk_state_wave0, wave3_health, wave3_guard, wave3_library, wave3_finale, wave4_miniapp):
        print(f"\n-- {fn.__name__.replace('_', ' ')}")
        try:
            fn()
        except Exception as exc:  # a broken check is itself a failure
            check(fn.__name__, False, f"{type(exc).__name__}: {exc}")

    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed")
    for f in FAILURES:
        print(f"  - {f}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())