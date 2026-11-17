# TwinOS — Upgrade Plan v2 (2026-10-25)

Second research + code-review pass. This supersedes the root `UPGRADE-PHASES.md`
of 24 Oct: five PRs (#121–#125) and eighteen migrations landed since, so several
items in that file are already built.

Everything below was verified against the code and the **live** database today,
with the query or file quoted. Nothing is proposed from memory.

---

## 0. What changed since the last review (read this first)

Already built — do **not** rebuild these:

| Item | Evidence |
|---|---|
| AI prompt library + memories + eval harness | `_shared/prompts.ts`, `_shared/eval.ts`, `functions/ai-eval/`, migration `20261024000400_ai_pipeline.sql` |
| Compliance co-pilot endpoint | `content/index.ts:398` `POST /content/validate` |
| Webhooks + delivery ledger | `functions/webhooks/`, `webhook_deliveries` table (+1653 seq scans) |
| Partner API keys | migration `20261024001000_partner_keys.sql` |
| Request metrics + Prometheus | `_shared/metrics.ts`, `health/index.ts:186` `GET /health/metrics`, `request_stats` |
| Weekly bloat snapshot | migration `20261024000700_weekly_bloat.sql` |
| Clip auto-create | migration `20261024000500_clip_auto_create.sql` |
| Threshold alerts, decision defaults, settings guard | `20261024000100`–`20261024000200` |
| EzyAI removed, sales-bot beat stopped | `20261025000200`, `20261025000300`; PRs #121, #123 |
| All 50+ migrations applied live | `supabase migration list --linked` matches through `20261025000300` |
| RLS on every table | live query: `select ... where relkind='r' and not relrowsecurity` → **0 rows** |

So the earlier "apply migrations, add webhooks, add AI evals" advice is spent.
What remains is narrower and mostly about **trust in what is already built**.

---

## 1. Research — what is actually worth importing

Established repos (GitHub API, 25 Oct). Newly-created repos in these topics were
checked and are noise (0–5 stars), so they are excluded on purpose.

| Repo | ⭐ | Use it for | Verdict |
|---|---|---|---|
| `n8n-io/n8n` | 208k | Workflow UI conventions, webhook retry UX | borrow patterns only |
| `paperclipai/paperclip` | 106k | Agent-management surface for a solo operator | borrow, Phase G |
| `heygen-com/hyperframes` | 71k | HTML→MP4 with burned-in captions, deterministic | **adopt**, Phase E |
| `mem0ai/mem0` | 67k | Memory extraction heuristics | already mimicked in `ai_memory` |
| `remotion-dev/remotion` | 66k | React video (heavier than HyperFrames) | skip |
| `twentyhq/twenty` | 59k | CRM data model if IB partners grow | later |
| `postiz-app` | 37k | Per-platform provider adapter + OAuth-per-user | **adopt**, Phase F |
| `langfuse/langfuse` | 36k | Trace UI for every LLM call | borrow (we have metrics; need traces) |
| `drizzle-team/drizzle-orm` | 36k | Typed SQL | skip — migrations are hand-written and checked |
| `pgvector/pgvector` | 23k | Semantic dedupe of feed items | Phase H |
| `triggerdotdev/trigger.dev` | 16k | Durable jobs replacing pg_cron loops | Phase H (only if cron grows) |
| `pgmq/pgmq` | 5.4k | Native Postgres queue | skip — `jobs` already does atomic claim |
| `grammyjs/grammY` | 3.8k | Bot framework | skip — `_shared/tg.ts` is 765 lines and tested |

Rule applied: adopt only what removes work Jack does by hand, not what adds a
dependency. Most of the trending stack is already covered by the existing code.

---

## 2. Verified defects (the review)

Each line is a fact from today's code or DB, with the fix in Phase A–D.

| # | Finding | Proof |
|---|---|---|
| 1 | OpenRouter call has **no timeout, no retry, no cancel** | `_shared/openrouter.ts:34` — bare `await fetch(...)`; no `AbortSignal` in the file |
| 2 | **29 foreign keys have no leading index** | live `pg_constraint` vs `pg_index` query; includes `publish_jobs_content_id_fkey`, `signal_posts_*`, `clip_candidates_*`, `webhook_deliveries_webhook_id_fkey` |
| 3 | **Platform tokens sit in `settings` as plaintext jsonb** while the schema says they must not | `seed.sql:112-118` (`meta_ig_token`, `meta_page_token`, `threads_token`, `yt_api_key`, `openrouter_api_key`) vs `content.sql:256` "Never store the token here" and `cron.sql:62` which already reads `vault.decrypted_secrets` |
| 4 | **No retention**: two tables grow forever | live sizes: `action_log` 47,025 rows / 11 MB, `health_checks` 40,681 rows / 8.5 MB; only one-off deletes exist in migrations, no prune |
| 5 | **Zero E2E tests** in either repo | no `playwright.config.*` anywhere; 39 deno unit files + 17 vitest files, all in-process |
| 6 | **No coverage gate** | `deno.json` has no coverage task; `vitest.config.ts` has no `coverage.thresholds` |
| 7 | **Secret handling is untested** | `_shared/log.ts` (the redactor) and `_shared/openrouter.ts` have no `*_test.ts`; 31 of 33 shared modules are tested |
| 8 | Metrics are **collected but never shown** | `request_stats` + `/health/metrics` exist; `mirror-hub/src/routes/_shell/health.tsx` has no reference to either |
| 9 | 23 `any` in dashboard non-test code | `grep -c ': any\|as any'`; `strict: true` is on, so these are deliberate casts hiding real shapes |
| 10 | Job claim runs two table-wide UPDATEs per poll | `jobs/index.ts:70-73` before the claim; harmless at 30 rows, worth folding into the same index work as #2 |

Not defects, checked and cleared: RLS is complete; settings and API-key lookups
are cached (`supabase.ts:40`, `auth.ts:138`); no import cycles; `strict: true`
already on; `deno check`/`lint`/`test` and the schema-drift guard already gate CI.

---

## 3. Phases

Order is by **trust per day of work**, not by feature appeal. Each phase is
test-first per the repo's TDD rule: failing test → fix → green → PR → merge.

### Phase A — Correctness and secrets (2–3 days, highest value)

| # | Work | Test that proves it | Files |
|---|---|---|---|
| A1 | Timeout + retry on OpenRouter | `openrouter_test.ts`: stub `fetch` that never resolves → throws `upstream_timeout` in < 21 s; 429 then 200 → one retry, success | `_shared/openrouter.ts` |
| A2 | Reuse the existing `jitteredBackoff()` from `_shared/backoff.ts` instead of a new retry loop | same test asserts the delay sequence | `_shared/backoff.ts` |
| A3 | Redaction unit tests | `log_test.ts`: token-shaped strings, whole `*_token` settings, and a Telegram bot URL all come out as `***` | `_shared/log.ts` |
| A4 | Tokens move to Vault | migration: `public.get_secret(name)` SECURITY DEFINER over `vault.decrypted_secrets`, settings rows for the five secrets become names, all readers switched; smoke test asserts a token is unreadable through `settings` | new migration, `integrations.ts`, `metrics.ts`, `ai/index.ts` |
| A5 | FK index migration + CI guard | new `tests/check_fk_indexes.py` fails when an FK lacks a leading index (with a documented allowlist for lookup tables); migration makes it pass | `supabase/migrations/`, `tests/`, `.github/workflows/ci.yml` |
| A6 | Retention cron | `twinos_prune()`: `action_log` 90 d, `health_checks` 30 d, resolved `alerts` 90 d, `request_stats` snapshots 30 d; smoke test inserts old rows, runs it, asserts counts | new migration + `smoke.sql` |

Exit: `deno test`, smoke, and the two new consistency checks green; no secret
readable from `settings`.

### Phase B — Test infrastructure (3–4 days)

| # | Work | Why |
|---|---|---|
| B1 | Playwright against a local seeded Supabase | Five flows only: compose→send to Desk, approve from Inbox, schedule→cancel, Clips list, Health page. This is the class of bug that bit before (403 on Jack's id, HMAC key order, comment status) and no unit test can catch |
| B2 | `bun run e2e` in mirror CI, nightly on `main` | Keeps it out of every PR's critical path while it stabilises |
| B3 | Coverage: `deno test --coverage` job (advisory), vitest `coverage.thresholds` | Baseline first, then ratchet to 80/70; do not block on day one |
| B4 | Contract test for `health` payload keys the dashboard reads | `queries.ts` and `health.ts` already disagree silently when a key is renamed |

Exit: one red E2E run proves the gate works (deliberately break a button, see it fail, revert).

### Phase C — Surface the observability already paid for (2 days)

| # | Work | Detail |
|---|---|---|
| C1 | Health page: request table | p50/p95/error-rate per route from `request_stats`, 24 h and 7 d, top 10 by p95 |
| C2 | Health page: queue panel | `jobs` counts by status/kind + oldest queued age (the number that predicts a stuck publish) |
| C3 | Alert rule: slow route | `p95 > 1500 ms` for 15 min → `alerts` row, same dedupe pattern as `stop_if` |
| C4 | AI cost panel | tokens and model per `ai_eval_runs`/generation, week-to-date spend; makes model choice a fact instead of a guess |

Exit: a deliberately slow route shows up in the dashboard within one poll.

### Phase D — Dashboard structure and performance (4–5 days)

| # | Work | Detail |
|---|---|---|
| D1 | Split the three monolith routes | `calendar.tsx` 993, `approve.tsx` 951, `friday.tsx` 863 lines; extract panels/rows/dialogs, no behaviour change (pure refactor commit, tests green before and after) |
| D2 | Split `ResearchPanels.tsx` (851 lines) per panel | it is also the worst bundle offender: one file pulls every chart and dialog |
| D3 | Bundle budget | measure first (`bun run build`, read `dist/assets`), then set a per-route budget (suggest 150 kB gzip) and fail CI on regression |
| D4 | Remove the 23 `any` | only where the cast hides a real shape (`fn.ts` generics, `queries.ts` row types); leave test-only casts |
| D5 | Empty/loading/error parity | every new panel from D1/D2 uses the existing `LoadError` / `EmptyState` / `SkeletonRows` so states do not drift |

Exit: no route file over ~400 lines; bundle budget enforced in CI.

### Phase E — Content loop intelligence (1 week)

The loop is currently open: `results` measures posts, `research` proposes topics,
but nothing feeds measurements back into proposals.

| # | Work | Detail |
|---|---|---|
| E1 | Close the loop | `research` scoring reads `v_hook_performance` + `v_post_engagement`; a topic that lost twice is demoted, a hook that won is preferred — one SQL view + one function change |
| E2 | Hook auto-promotion | when a hook variant beats the incumbent by a set margin over N posts, surface "promote" on the Friday page (Jack approves, never automatic) |
| E3 | HyperFrames for the clip path | keep `studio/clipper.py` for cutting; render the caption/cover overlay with HyperFrames (HTML→MP4, deterministic) instead of leaving captions to CapCut; `npx hyperframes render` as a worker job kind |
| E4 | Trend source probe | one adapter interface for a per-video views source (TikTok); probe 2–3 vendors, pick on cost per lookup — this is the blocker for the double-down alert |

Exit: a Friday run names the winning hook and the losing topic in its own text.

### Phase F — Platform coverage (ongoing, 1 per sprint)

| # | Work |
|---|---|
| F1 | Activate the written metrics pollers — needs Meta/Threads/YouTube tokens (Jack) |
| F2 | Adopt Postiz's provider-adapter shape: one file per platform, `publish`, `metrics`, `refresh_token`, `revoke` |
| F3 | YouTube Shorts upload + retention metrics (highest ROI for trading content) |
| F4 | Instagram/Threads insights; then X (OAuth 2.0 + PKCE) |
| F5 | Only then consider LinkedIn/Pinterest/Bluesky/Discord/Slack |

### Phase G — Agent surface (3–4 days)

| # | Work |
|---|---|
| G1 | Extend `apps/mcp` verbs to the new endpoints (`webhooks`, `ai-eval`, `keys`, `metrics`) with the existing "never approve" guard kept |
| G2 | Dashboard page for `webhook_deliveries`: last 100, status, retry button (backend exists, no UI) |
| G3 | Partner key page: scope, last used, rotate (backend exists, no UI) |

### Phase H — Deliberately last

| # | Work | Trigger to start |
|---|---|---|
| H1 | pgvector semantic dedupe of feed items | feed volume > 500/week |
| H2 | Trigger.dev for cron | a second stuck-queue incident |
| H3 | CRM for IB partners (`twenty` pattern) | more than ~20 partners |
| H4 | Voice clone + TTS bake-off | Jack records the reference clips |

---

## 4. Needs Jack (blocking, in order)

1. **Vault decision** for A4: move the five platform keys, or accept plaintext and document it. Recommended: move.
2. **E2E credentials**: a Supabase test project (or local stack) so B1 can write rows without touching live data.
3. **Trend source budget** for E4 (even $20/month picks a vendor).
4. **Meta / Threads / YouTube tokens** for F1 — pollers are written and waiting.
5. Two earlier decisions still open: health stale threshold, inbox badge counts drafts.

---

## 5. Priority table

| Phase | Effort | Impact | Risk if skipped |
|---|---|---|---|
| A | 2–3 d | Removes the three ways a secret or a hang becomes an incident | High |
| B | 3–4 d | Catches the bug class that already shipped twice | High |
| C | 2 d | Turns collected data into an early warning | Medium |
| D | 4–5 d | Keeps the dashboard changeable by one person | Medium |
| E | 1 wk | Makes content decisions evidence-based instead of felt | Medium |
| F | ongoing | Reach, but each platform is real support surface | Low per sprint |
| G | 3–4 d | Lets other tools drive TwinOS instead of Jack | Low |
| H | — | Premature until a trigger fires | — |

**Recommendation:** run A and B together next, because A's fixes are only
trustworthy once B's E2E exists to prove the loops still work.
