# Graphify Review — fixes & upgrades needed by phase (2026-10-24)

Source of truth inputs:
- `graphify . --code-only` → `graphify-out/graph.json` (2,622 nodes, 5,373 edges), `.graphify_analysis.json`, `GRAPH_REPORT.md` (139 communities after `cluster-only`)
- `docs/PHASES.md` (master checklist, Phase 0–9, Wave 0–5 of Phase 9)
- `docs/PHASE8.md` (revenue core findings + narrow read spec + parallel-run plan)
- `docs/UPGRADE-IDEAS.md` (21+ research ideas, statuses)
- `docs/AI-CODER-PROMPT.md` (v4 build prompt, hard rules)
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/LOVABLE-KNOWLEDGE.md` as referenced by the prompt

---

## How to read this review

- **built** — done in this repo, with tests green.
- **pending** — designed/planned, not yet built (or not yet proven).
- **needs Jack** — a human decision, credential, account, or manual step only Jack can do.
- **deferred** — deliberately waiting.
- **blocked** — waiting on something outside this repo (site repo, sales bot repo, Jack's PC/keys).

Status legend is repeated in `docs/PHASES.md` and `docs/UPGRADE-IDEAS.md`.

---

## Phase 0 — Plan and mind (1–7 Oct 2026)

**Exit:** schema reviewed; baseline logged.

| # | Item | State |
|---|---|---|
| 1 | Baseline week: hours by task logged (`baseline_hours`) | **needs Jack** — feeds Phase 3 hours-cut measurement |
| 2 | Unified monthly-first price list decided | **built** — catalog prices kept; TradingView Pro $29/mo |
| 3 | Reference-channel handles given | **built** — `benchmarks` table only (44fx, Callisto Fx, Orient Fx, 10X INTERNATIONAL, SandyFx, vexaflowai, bengoldtrader) |
| 4 | Schema written + reviewed, verified vs real Postgres, reconciled with functions | **built** |
| 5 | Seed: settings, brand_facts, products, personas, 17 templates, style_guide, hooks, calendar_slots, live_runsheets, mod_rules, benchmarks | **built** |
| 6 | MCP `ENDPOINTS` matched, 40 tests pass | **built** |
| 7 | Settings keys aligned | **built** |
| 8 | `docs/SETUP.md` verified — all 7 SQL blocks execute | **built** |
| 9 | Cross-file consistency checks (`tests/check_consistency.py`, 25 checks) in CI | **built** |
| 10 | `deno check`/`deno lint`/`deno test` clean on Deno 2.9.6 | **built** |
| 11 | Supabase project created, migrations + seed applied, smoke green | **built** |
| 12 | pg_cron, pg_net, pgvector enabled; private `assets` bucket | **built** |
| 13 | Jack's login created with `twinos_role = jack`; API keys minted (pc_worker, abdul, ezyai; keyring + `X-TwinOS-Key`) | **built** — ezyai key copy to signal bot host still **needs Jack** |
| 14 | @EzyOps_bot created; EzyMap Desk group created | **built** |
| 15 | Functions deployed; Telegram webhook set with derived secret; getWebhookInfo clean | **built** |
| 16 | Cron schedules installed (publish, health/check, stop-if, friday, backup, keep-alive) | **built** |
| 17 | Lovable project created (frontend-only), knowledge set | **built** |
| 18 | Reference-channel benchmark study: numbers section done; 2 of 7 channels publish a counter, view rate 1.80% vs 4.30% at a sixth the size | **built** — left: five manual rows + high-capital ICP note (**needs Jack**, reading an offer is a judgement) |
| 19 | Invite-link naming convention agreed (`src-campaign-yymm`) | **needs Jack** |
| 20 | The EzyMap indicator repo made private | **needs Jack** |

**Phase 0 open items:** baseline hours (needs Jack), invite-link naming (needs Jack), indicator repo privacy (needs Jack).

---

## Phase 1 — Desk loop (8–21 Oct 2026)

**Exit:** Jack approves the map and a signal from his phone; a result reply posts by itself.

| # | Item | State |
|---|---|---|
| 1 | Desk drafts with approve buttons working end to end (`tg-webhook` → `content` → `approve` → `publish`) | **built** live on 2 Oct via `scripts/desk-tour.sh` (7 posts made, 7 rejected, 0 publish jobs) after #38 fixed the 403 (Jack's Telegram id read as a number). Left: one real ✅ on a morning map — **needs Jack** (checked on @ezymap) |
| 2 | Telegram publisher + scheduler running every minute; backoff verified with forced 429 | **built** (`twinos-publisher-tick` once a minute; 10 scheduler beats in 10 distinct minutes live; backoff tests + `smoke.sql` §15) |
| 3 | Templates for all 17 post types seeded and rendering without `[NEEDED]` | **built** (`templates.body`; `tests/check_templates.ts` renders all 17 through compliance in CI) |
| 4 | TradingView alert → signal card draft (COUNTER-TREND line kept) | **needs Jack** — alert JSON set in TradingView |
| 5 | The signal bot pushing to `signals-ingest` (key on its host) | **needs Jack** — Jack + signal bot repo |
| 6 | Result replies under signals from board status changes | **pending** — `results/run` drains `result_reply` jobs (scheduled every minute); needs a **posted** signal card to prove end to end, which needs a real approved signal |
| 7 | Stop-if alarm firing on a test signal with no result | **built** (route deployed, `v_stop_if` + dedupe covered by `smoke.sql` §4/§17, cron live); not yet fired on a real signal |
| 8 | Compliance checks on every variant; evidence trail in `compliance_checks` | **built** — rewrite path in `jobs` now checks and logs like `createDraft` and the Desk edit; `check_consistency.py` fails if any variant-body write skips `compliance_checks` |
| 9 | PC worker installed as user service; `--self-test` green; nightly backup file appears | **built** — service installed, enabled, lingering; `--self-test` 200; queued job claimed and finished live. Nightly backup file needs keyring `db_url` — **needs Jack** |
| 10 | 07:40 / 19:55 reminders (cron → content) | **built** (`content/remind-map` + `content/remind-wrap`; crons live; `_shared/time_test.ts` covers day boundary) |
| 11 | Baseline hours `/hours` in the Desk | **built** (`_shared/hours_test.ts`; Friday scorecard gains an hours line) |
| 12 | Approval Inbox screen in Lovable (jack-only Approve) | **built** 2 Oct; Jack to sign in and confirm with a real draft |

**Phase 1 open items:** real ✅ morning map (needs Jack); TradingView alert JSON (needs Jack); signal bot push (needs Jack + bot repo); stop-if on real signal; PC worker backup keyring `db_url` (needs Jack).

---

## Phase 2 — ABDUL + batch + Friday (22–31 Oct 2026)

**Exit:** Friday report arrives without Jack opening a spreadsheet.

| # | Item | State |
|---|---|---|
| 1 | MCP server in `apps/mcp/` with the verbs (no approve; `FORBIDDEN_PATH` guard, 40 tests) | **built** — Jack registers: `claude mcp add twinos -- python3 ~/TwinOS-helper-system/apps/mcp/twinos_mcp.py` |
| 2 | `twinos_call()` in ABDUL with the key from the keyring | **pending** — needs the key wiring |
| 3 | Wednesday 14:30 batch: 7 lessons (5 skill + 2 Start Safe), audit, poll, offer, numbered by `batch_no`, edits by "N: text" | **built** (`content/batch`, `_shared/batch.ts`, 15 tests; cron `twinos-wednesday-batch` live; needs `scripts/deploy.sh`) |
| 4 | Thursday sweep (`content/batch-sweep`, cron `twinos-thursday-sweep` Thu 09:00 MYT) | **built** — queues approved-but-unscheduled posts, nudges the Desk about the rest; `/batch ok` approves what is ready and claim-free |
| 5 | Scorecard image renderer (`workers/pc/studio/scorecard.py`, Pillow; `test_scorecard.py`) | **built** |
| 6 | Friday scoreboard with Vantage + TikTok manual inputs; `v_friday_scoreboard` complete | **pending** |
| 7 | Content log rows automatic (`v_content_log`, filled from `tg_posts` + `post_snapshots`) + `GET /friday/export?view=content_log` returns the sheet as CSV (RFC 4180 + formula guard) | **built** — pushing straight into a Google Sheet needs a service account Jack has not set up; importing the CSV is one menu click |
| 8 | Named invite links through TwinOS (`POST /links`, `src-campaign-yymm` enforced) | **built** — weekly Telechurn import: worker handler exists, needs Jack's weekly CSV in `~/EzyMap/telechurn/` |
| 9 | Content Calendar, Health, Analytics/Friday screens in Lovable | **built** 2 Oct; Jack to sign in and look at real data |

**Phase 2 open items:** `twinos_call()` in ABDUL (pending); Friday scoreboard Vantage + TikTok manual inputs (pending); Jack's weekly Telechurn CSV (needs Jack).

---

## Phase 3 — Repurposing (November)

**Exit:** one TikTok reaches seven places with only the TikTok, YouTube and X taps by hand; ≥60% hours cut.

| # | Item | State |
|---|---|---|
| 1 | Meta app Live, Standard Access — Jack (`docs/SETUP.md` 3.1) | **needs Jack** — `_shared/meta.ts` providers written and tested against a stand-in Graph API (IG Reels/photo, FB Reels, Threads; 24 h caps 100/30/250 hold a job for 30 min without using an attempt) |
| 2 | Fan-out: one master post becomes a child item per platform | **built** (`POST /content/{id}/fanout`, Desk `/fanout`; captions adapted per platform, TikTok/YouTube/X as copy-paste kits to the Desk, approvals per platform in dashboard) |
| 3 | Asset-ingest fan-out: ingested asset → caption variants per platform + publish kits | **built** (worker drop folder ingests asset; attach with `asset_id`; verified live 24 Oct: telegram master + per-platform drafts behind approval gate, kit for TikTok, sha256 retries replay instead of duplicating; `contentIdem` added after acceptance run caught a duplicate draft tree) |
| 4 | YouTube API project; audit form submitted; private uploads until it passes | **pending** — Jack |
| 5 | Per-platform validator + caption adapter (risk line kept in front of any cut) | **built** (`_shared/platforms.ts`: media needed, video length/size, hashtag count, caption length; conservative limits in one table; caption adapter keeps risk line in front of any cut) |
| 6 | Metrics pollers (IG/FB/Threads/YouTube) | **pending** — Meta token-expiry watch done (`health` warns 7 days ahead, alerts once a day); pollers wait for the Meta tokens |
| 7 | "All platforms posted" Friday report line | **built** (`v_fanout_week` + `fanoutLine`, migration 0021, in scorecard `hours` field) |
| 8 | Hours cut ≥60% vs baseline — measured by `v_hours_cut` (saved minutes per KL week vs first baseline week), printed on Friday scorecard | **pending** — machinery live (`post_snapshots` 95 rows, `v_friday_scoreboard` 13 rows). Data state 24 Oct: `baseline_hours` empty, `time_saved` 0 rows, `manual_metrics` 0 rows, so target cannot be evaluated yet. **Jack's first step:** Desk `/hours` command to log the baseline week (Mon 5 Oct start). |

**Phase 3 open items:** Meta app Live (needs Jack); YouTube API (needs Jack); metrics pollers (wait Meta tokens); hours-cut baseline (needs Jack).

---

## Phase 4 — Community + tracking (Nov–Dec)

**Exit:** every swap shows joins and 7-day retention.

| # | Item | State |
|---|---|---|
| 1 | Discussion group linked; bot admin; `mod_rules` seeded; warn → mute → ban live | **pending** — engine rebuilt and tested (`_shared/moderation.ts`: scam phrases EN/BM, new-member link block with own domains allowed, impersonation incl. lookalike letters, ladder warn → 24 h mute → ban, admins and Jack exempt). Flood control: every group message counted in `flood_counters` (migration 0031) inside widest flood window. Switches on when Jack links group: `settings.discussion_group_chat_id` + bot as admin (delete, restrict, ban). **needs Jack** |
| 2 | Join-request captcha + CAS check (`onJoinRequest`) | **built** — CAS-banned account declined and logged `cas_blocked`; otherwise private "I am a person" button, only that person can press it; needs invite links created with approval |
| 3 | Scam-impersonation watch (flag to the Desk, nothing removed) + repeat-question detector (`v_repeat_questions`, migration 0022) | **built** — Desk hears about a question the second time it is asked |
| 4 | Post view snapshots at +1 h / 24 h / 7 d (`metrics/snapshots`, cron every 15 min) | **built** — reads public preview `t.me/s/<channel>` because bots cannot read views; parser checked against real @ezymap page; snapshot only taken inside its window. Needs `scripts/deploy.sh` |
| 5 | Swap tracker (one named link per partner through `POST /links`) + funnel view (`v_funnel`, cost per first-time depositor in `v_stop_if`) | **built** |
| 6 | Reference-channel benchmark cards refreshed weekly (`metrics/benchmarks`, Monday 03:00 MYT) | **built** — size, average views, view rate, posts per day into `benchmarks`; handles never leave the table. A channel with preview switched off is skipped |
| 7 | Signal board + Inbox screens in Lovable (built 2 Oct: Signals with dry-run preview before any result is posted; Messages placeholder that fills when Phase 3 comment polling exists) | **built** |

**Phase 4 open items:** discussion group linked (needs Jack).

---

## Phase 5 — Studio + research (Dec–Jan)

**Exit:** a live becomes clips without CapCut's help for the cut list; Monday brief every week; ≥70% hours cut.

| # | Item | State |
|---|---|---|
| 1 | `studio/clipper.py` on the GPU: transcript, cut points, SRT, clean clips, cover text | **pending** — pipeline and pure parts (highlight picking, SRT, cover text) now tested; queue contract fixed (the MCP and the worker disagreed: every clip job would have failed with "source not found: tiktok"). **First real run needs Jack's PC** — `pip install faster-whisper`, ffmpeg, recording in `~/EzyMap/lives/` |
| 2 | Layout templates (chart full, chart + face, blurred fill) and end card (`studio/layouts.py`) | **built** — tested as ffmpeg commands: 1080x1920, drawtext-safe text, silent track so the card joins. A real render still needs ffmpeg on the PC |
| 3 | Research (autocomplete + channel RSS): personas, autocomplete expansion (ms/MY), Search Console, Bing, YouTube competition score, channel RSS — autocomplete built and checked against real endpoint; channel RSS built; social sources, ideas and channel research built (second wave, 2026-10-05) | **built** — RSS 2.0 and Atom parsed in `_shared/feed.ts`, 6-hourly cron, ABDUL `twinos_feeds` / `twinos_research`. Social sources (`feeds.kind` gains `bluesky` and `mastodon`, migration `20261005070000`), `twinos_search`, `research/ideas` + `twinos_ideas`, `research/channels` + `twinos_channels`, native Telegram polls (`sendPoll`, `parsePoll`; `poll_results` + `tg_posts.poll_id`, migration `20261006080000`, `onPoll`, `pollSnapshot`, `twinos_polls`) all built. Dead feed cron pages the Desk (`feedStale`); poll tallies read back. **Not built, deliberately:** TikTok and X research — no official read that fits the method rules |
| 4 | Monday brief against the 28-day calendar (`research/brief`, Monday 07:00 MYT) | **built** — week's calendar slots, best fitting scored topic per pillar, each used once, to `briefs` and the Desk; score = demand x ICP fit x (1 - compliance risk). CSI capture: `POST /research/csi` live-ready; dashboard form in Research screen |
| 5 | Double-down alert (part 2 within 48 h) | **pending** — not buildable yet: needs per-video TikTok views and there is no source for them (only weekly totals Jack types). Starts as soon as a source exists |
| 6 | The Monday brief has topics to suggest — the generated-column write bug (260 queries, 0 clusters, error discarded) was fixed; Postgres computes the score now | **built** |

**Phase 5 open items:** clipper GPU run (needs Jack); double-down alert source (pending research).

---

## Phase 6 — Pilot readiness (January 2027)

**Exit:** cost per FTD visible daily.

| # | Item | State |
|---|---|---|
| 1 | Ad landing attribution checked end to end (printezy read endpoint) | **pending** — endpoint contract specified in `docs/PHASE8.md`; has to be built in the **site's own Lovable project** (separate repo TwinOS never writes to) |
| 2 | Cost per first-time depositor per campaign (`POST /friday/campaign`, `v_campaign_cost`, migration 0025) | **built** — spend, accounts and depositors per campaign, kept apart from weekly totals so nothing double-counts; week's ad spend optional Friday source `ads` |
| 3 | Quarter target tracker + stop-if alarms (`v_quarter_targets`, `v_stop_if`) | **built** — Q4 2026 / Q1 / Q2 targets and days left read live; stop-if: no-result signal, cost per depositor over $120 two weeks running, refunds over 3%; none flagged yet |
| 4 | Lawyer's opinion on compliance obtained before paid ads (decision 7) | **needs Jack** |

**Phase 6 open items:** attribution endpoint (blocked on site repo); lawyer's opinion (needs Jack).

---

## Phase 7 — Q1–Q2 extras (Feb–Jun 2027)

| # | Item | State |
|---|---|---|
| 1 | YouTube long-form from Sunday lives — pick (the 8–20 min window with the most chart talk) and YouTube chapter list built and tested (`studio/longform.py`, `run_long`); wired to the queued clip job (`{"longform": true}` cuts the window with chapters) | **built** — first real run on Jack's PC still to do |
| 2 | BM SEO article briefs (`POST /research/article`) | **built** — title options, questions as headings, keywords, rules a financial article keeps; built from stored autocomplete suggestions, Malay first; a person writes the article and Jack reviews |
| 3 | WhatsApp retention hooks — **not built**: no WhatsApp sending channel and no spec for the messages yet. Starts when Jack picks the channel (WhatsApp Business API or a broadcast list) and the moments to nudge (7 days before expiry is already in the Friday numbers) | **pending** — needs Jack |

| 4 | Annual-plan offer variants (`POST /content/annual-offer`) | **built** — pairs each `*_1m` product with its `*_1y` twin, works out the saving from the table, drafts the offer for Jack's approval; with no sku it only lists what could be offered. A dearer annual price is no offer |

**Phase 7 open items:** YouTube long-form first run (needs Jack); WhatsApp hooks channel pick (needs Jack).

---

## Phase 8 — Revenue core (after Phase 7)

**Exit:** payments match the old bot for two weeks.

### Findings in the printezy payment path (docs/PHASE8.md — separate repo, not this one)

1. **Check, then insert.** `recordSitePurchase` looks for an existing row, then inserts. Two deliveries of the same event arriving together can both pass the check; the second insert fails on the unique column, the function throws, the webhook answers `400`, so Stripe retries. No double purchase results (unique column holds), only noise and a delayed second pass. **Fix:** insert with `on conflict (stripe_session_id) do nothing returning id`, and notify Sarah only when a row came back.
2. **`listUsers({ perPage: 1000 })`** in `provisionAccount` looks for a repeat buyer among the first 1,000 users only. Past 1,000 users a repeat buyer is not found, no account is linked to the purchase (the purchase still records). **Fix:** look the user up by email through the admin API's filter, or keep an `email → user_id` lookup.

### Phase 8 items

| # | Item | State |
|---|---|---|
| 1 | Stars payment idempotency | **pending** — Telegram Stars is a paid-channel decision; sales bot already takes Stars, so TwinOS only reports it (Phase 8 revenue migration). No Telegram Stars code exists in the site |
| 2 | Larger Stripe de-dupe window | **pending** — the unique column is a permanent de-dupe, not a window; the real fix is finding 1 |
| 3 | Service-role key replaced by a narrow read | **pending** — narrow read spec in `docs/PHASE8.md`: `GET /api/public/twinos/attribution?week=YYYY-MM-DD` with `Authorization: Bearer <read-only key>`; counts per campaign tag only, no emails/names/amounts per person; TwinOS stores the answer in `manual_metrics` (kind `campaign`, migration 0025) so `v_campaign_cost` can show cost per depositor |
| 4 | Sales bot migration with parallel running | **pending** — plan + exit criterion in `docs/PHASE8.md`; needs the sales bot's repo; plan: both bots receive the same events for two weeks, only the old one acts; new one writes what it *would* do; each night a comparison lists every purchase, grant and refund the two disagree on; **zero differences for 14 nights in a row** is the exit criterion; cut over on a quiet weekday morning, keep old bot acting on nothing for another week; money paths never auto-retry a failed grant silently |
| 5 | Hosting decision for the sales bot (existing host vs VPS) | **needs Jack** — criteria in `docs/PHASE8.md`: (1) payments never stop, (2) secrets stay out of repo and browser, (3) one place to look when something breaks, (4) cost at this size. Recommendation: **leave the sales bot where it is** until the parallel run proves the new one; decide hosting only then; moving and rewriting at the same time doubles the risk on the money path |

**Phase 8 open items:** Stars idempotency + Stripe fix + narrow read + sales bot migration + hosting decision.

---

## Phase 9 — v4 upgrade: navigation, UX and functions (from Oct 2026)

Plan: `UPGRADE-PLAN.md` §17. Builder prompt: `docs/AI-CODER-PROMPT.md`. Every function change ends with `scripts/deploy.sh` + `scripts/desk-tour.sh` PASS (Jack runs both).

### Wave 0 — fixes: **all built**

- [x] `desk_state` check allows `'kit'` (+ `awaiting_slot`); `desk_state_at` added; fan-out kits get their state (`0026_desk_state_wave0.sql`, `fanout.ts`; `desk_test.ts` 5 passed, consistency 30/30)
- [x] Reschedule keeps the card's buttons (`approve/index.ts`: clear skipped on reschedule; consistency guard)
- [x] Edit / Later prompts get ✖ Cancel and expire after 30 minutes (`desk.ts` `PROMPT_TTL_MS` + `cancelKeyboard`, `tg-webhook` expiry + `cancel` handler)
- [x] Contract test for the `tg-webhook` → `approve` hop (`desk.ts` `buildApprovePayload`, all 4 call sites; user_id always text)
- [x] Dead-button test (every emitted callback verb has a handler) (`HANDLED_CALLBACK_VERBS` vs emitted verbs)

### Wave 1 — Desk bot navigation: **all built**

- [x] Callback grammar v2 (`nav:` `pg:` `nop` + stale-menu fingerprint) (`tg.ts` `Callback` union, `NAV_LAYOUT v1`; `nav_test.ts` 5 passed)
- [x] `/menu` home panel, edit in place, Back + Home on every screen (`onNav`, shared screen texts, unknown → home; tour walks `/menu`)
- [x] `setMyCommands` for the Desk, set by `deploy.sh` (Desk-chat scope, best effort; consistency guard)
- [x] Decision cards collapse to a status button; no extra "Approved" message (`approvedStamp` + nop button; `cards_test.ts` + consistency)
- [x] `/batch` list with per-item buttons, Refresh, confirm before "Approve ready" (`batchListKeyboard`, `cmd:` refresh/ready/batchyes/batchno, Yes re-checks)
- [x] Later quick picks (13:00 · 18:00 · Tomorrow 08:00 · Custom) (`rs:<id8>:<slot>` via `parseTime`; prompt keyboard cleared after pick)
- [x] Edit presets (Soften · BM · Shorter · Write my own) + Cancel (`ed:<id8>:<preset>` queues the rewrite; own stays a reply)
- [x] Fan-out button on approved cards (`fan:<id8>`; collapses to Fanned out; `panels_test.ts` + consistency)
- [x] Refresh + "updated hh:mm" on Status, Friday, Hours (`screenKeyboard` + stamp in all three texts)
- [x] Paging for long lists + a pending-drafts screen (`draftsPanel`, 5 per page, `pg:drafts:n`, per-item buttons)
- [x] Buttons on moderation alerts and repeat questions (`mo:<id8>:<action>`: ban/mute/ignore/faq/drop, recorded)

### Wave 2 — dashboard (Lovable, one prompt per item): **built 3 Oct, not yet seen signed in — Jack checks on desktop and phone**

- [x] App-shell layout route, `useRole()`, no-role screen (`src/routes/_shell.tsx`, `src/lib/role.tsx`)
- [x] Grouped sidebar with icons + pending badge; bottom nav on phones; read-only Settings page (`src/components/AppNav.tsx`)
- [x] Skeletons, empty states, errors with Retry; the Inbox never shows Approve when variants or findings failed to load (`src/components/states.tsx`)
- [x] Inbox: picked / original variant (never an unpicked AI angle), kits Reject-only, inline approve/reject with confirm (Dialog / Drawer), keyboard J/K/A/R/S/?; every overlay on `ResponsiveDialog`
- [x] ⌘K command palette (pages, pending posts, safe actions only); Approve wording matches the backend ("right away" when unscheduled)
- [x] Motion and surface tokens (green), focus ring, page fade, reduced motion (CSS only)
- [x] Realtime instead of polling (migration 0033 publication); live dot, badge, new-draft and alert toasts; slow fallback only while disconnected
- [x] Health as integration cards with Check now; Settings integrations section (secret names only)
- [x] Stat tiles, Inbox status tabs, specific toasts, filter chips with aria-pressed; Friday forms for `jack` only

### Wave 3 — functions: **all built**

- [x] Integration status in `health` (secret names only); live provider checks, alert on change / recovery; error alerts to the Desk with cooldown (`alerts.ts` `deskAlert`: one open row per key, repeats counted)
- [x] Unknown-outcome guard in publish / fan-out (`backoff.ts` `isUnknownOutcome` + 10-min `UNKNOWN_HOLD_MS`, `duplicateLanded` pre-send check in `publish/index.ts`, `error_class='unknown'`, `deskAlert` to the Desk; `_shared/outcome_test.ts` 4 passed, shared suite 184, consistency 44/44)
- [x] Hook and CTA library (no AI) (`_shared/hooks.ts` `pickLru` / `nextHook` / `nextCta` over the `hooks` bank + new `ctas` table, migration 0027, 28 lines x 7 platforms x en/ms, smoke §21; `hooks_test.ts` 3 passed, shared 187, consistency 46/46)
- [x] `llm_variants` PC-worker job (off by default, local model, compliance + number guard) (`worker job_llm_variants`: loopback llama-server only, strict-JSON 3 angles/platform; `jobs/result` ingests each through `compliance` + blocking `aiNumberGuard`, Desk pick buttons `pk:`; `compliance_test.ts` + `test_worker.py` 5 passed, shared 191, consistency 52/52)
- [x] Adjust button, script kits, grounded Monday brief (🎛 on decision cards: AI-on queues the job, AI-off refreshes hook + CTA from the library; `_shared/kits.ts` TikTok/YouTube kits with spoken risk line, attached to fan-out kits + `fanoutSummary`; `buildBrief` carries hook evidence per day; tour walks `adj:` reject-only)
- [x] Banned words / humanizer rules as compliance warnings (`compliance.ts` `HUMANIZER_WORDS_EN/MS` + `humanizerHits`, warn-level `humanizer` finding apart from the blocking claim checks; `compliance_test.ts` + consistency)

### Wave 4 — bigger bets (each needs Jack's go first)

| # | Item | State |
|---|---|---|
| 1 | Telegram Mini App approval view (initData → session) | **pending go** — backend done, review-fixed 3 Oct (HMAC key order was swapped, so every real initData failed; now pinned by a Python-signed vector; initData ≤ 1 h, session 2 h, sent in `x-twinos-session` because the gateway admits only JWTs). Lovable `/mini` route built (commit `9ccc744`: Telegram script, `tg-auth/verify` → session in memory, `x-twinos-session` on every call, list from `GET content/pending`, approve/reject with confirm; gateway admits the publishable key, checked live). **Left for Jack:** publish the dashboard, register the Mini App with @BotFather (Telegram opens Mini Apps from a group only through a `t.me/<bot>/<app>` link), and one live test |
| 2 | Postiz-style calendar scheduler | **built** — backend: `content_items.first_comment` + delay, `publish_jobs.kind` post/comment sharing the variant, comment posted as a checked reply under the channel post, `platform_signatures` setting; calendar UI prompt 2 in `docs/LOVABLE-WAVE4-PROMPTS.md`; migration 0029 + smoke §22; shared 196, consistency 60/60 |
| 3 | Clip pipeline upgrade (scene detection, moment scoring, reframe, `clip_candidates`) | **built** — `studio/moments.py`: ffmpeg scene splits, keyword-burst scoring with scene bonus, face-following 1080x1920 reframe, exact-window cut; `clip_candidates` job proposes, Desk Use/Drop discards, `/clips` lists; migration 0030 + smoke §23; worker 60, shared 196, consistency 63/63 |
| 4 | Fan-out retries with a Desk alert on the last failure | **built** — jobs-table queue + `content/fanout-drain` cron + stuck-backlog alert; pgmq deferred (CI Postgres has no pgmq extension) |
| 5 | Voiceover in Jack's cloned voice | **pending go** — `UPGRADE-PLAN.md` §17 Wave 4.5: `voiceover` PC-worker job on Confucius4-TTS (Apache-2.0, EN + BM; never OmniVoice, which is non-commercial), risk line appended in code and checked by a faster-whisper transcript, ffmpeg mix, Desk approval with an AI-voice label. **First:** a 20 s BM bake-off on the 1050 Ti or CPU — **Jack records the reference clips** |

### Wave 5 — research-driven upgrades (from Oct 2026): mostly built

- [x] Poison-update guard; burned-in word-level captions + hook-text cover thumbnails; hook A/B by evidence; best-times + engagement + signal-ledger views; no-delete watchdog; channel staleness alert; hashtag minimum + signature rotation; 2026 humanizer tells
- [ ] RSS macro digest — **needs Jack** (the only non-self-contained idea: Jack's feed URL)
- [ ] Telegram Stars reporting / ad share rows — Phase 8 revenue decisions (decision 7 lawyer first)

### Review 3 Oct (code review of #41–#55), fixed in one PR: **all built**

- Live DB was missing migrations 0026–0032 while functions v12 were deployed; applied 0026–0032 live via the Supabase MCP after checking every dependency column
- Approving queued every variant → now approve checks `isPublishableVariant`
- Unknown publish outcomes re-sent on a timer → now parked with Desk buttons It's posted / Send again (`hp`/`hs`); post-send bookkeeping errors no longer turn a sent post into a retry
- Fan-out retries marked done on failure (`fanoutFailure`); first comments always failed (status + risk-line rule, `checkComment`); comment text writable before the role gate
- Provider check errors could carry the bot / Meta token to the Desk and `/health` (`redactSecrets`)
- Mini App HMAC key order swapped; session moved to `x-twinos-session`; initData ≤ 1 h, session 2 h
- Desk: shared panels lost other items' buttons on a tap (`replaceRowsFor`); a second Refresh posted a duplicate panel; rewritten cards counted as expired prompts; typed `/batch ok` skipped the confirm; replies to the Edit/Later prompt missed the draft; clip Use/Drop not atomic; rewrites skipped the number guard; stale job claims looped forever; `/health` failed-jobs count always empty; cover text escaping
- Wave 2 (dashboard) built in Lovable on 3 Oct (9 prompts; type check and the routing test pass after each; project knowledge carries the Wave 2 rules). Not yet seen signed in — Jack checks on desktop and phone.

---

## Graphify findings mapped onto fixes / upgrades

From `GRAPH_REPORT.md` on the 2026-10-24 run (built from commit `ef9b27bc`):

- **Stats:** 2,622 nodes · 5,373 edges · 139 communities (97 shown, 42 thin omitted); extraction 98% EXTRACTED, 2% INFERRED (106 edges, avg confidence 0.85); token cost 0/0 (code-only run, no LLM).
- **God nodes:** `react` (80 edges), `LoadError()` (52), `lucide-react` (47), `HttpError` (41), `ResponsiveDialog()` (39), `EmptyState()` (36), `SkeletonRows()` (32), `@tanstack/react-router` (32), `admin()` (30), `TestRequestShapes` (27).
- **Surprising connections (all EXTRACTED):** `Row` →references→ `PostType` (`tests/check_templates.ts` → `_shared/compliance.ts`); `loadMemories()` →calls→ `admin()` (`_shared/prompts.ts` → `_shared/supabase.ts`); `promptCatalog()` →calls→ `admin()`; `upsertSignal()` →calls→ `admin()`; `SidebarMenuSkeleton` →calls→ `Skeleton()`.
- **Import cycles:** none detected.
- **Knowledge gaps:** 622 isolated nodes (`FailedJob`, `SettingChange`, `Tone`, `Search`, `Row` + 617 more; ≤1 connection — possible missing edges). 42 thin communities (<3 nodes) omitted from the report; run `graphify query` to explore isolated nodes.

### What this maps to, per phase area

- **health cluster cohesion 0.05** → `health.tsx` may deserve splitting before Wave 4 grows it further (integration/health beats, failed jobs, settings changes).
- **backoff.ts cohesion 0.05** → backoff logic may deserve splitting (backoff params, poison updates, fan-out retries) as the failure-handling surface grows.
- **twinos_mcp.py cohesion 0.05** → ABDUL verb surface may deserve splitting as new verbs land (analytics views, research verbs, scheduler reads).
- **tg-webhook/index.ts cohesion 0.07** → the webhook is a large handler cluster (menus, panels, callbacks); dead-button coverage is already enforced by tests, which is the right guard.
- **LoadError + EmptyState/Skeleton cluster (cohesion 0.09)** → frontend error/empty state surface is cohesive; the god nodes (`react`, `lucide-react`, `ResponsiveDialog`, `EmptyState`) confirm the design system layer is doing its job.
- **622 isolated nodes** → worth a follow-up `graphify query` pass to find missing tests or missing cross-references (e.g. `FailedJob`, `SettingChange`, `Tone`, `Search`, `Row`). These are candidates for new tests rather than new code.
- **High betweenness bridges:** `@supabase/supabase-js` (0.242) across `types.ts`, `research.ts`, `hooks.ts`, `alerts.ts`, `package.json`, `supabase.ts`; `react` (0.085) across many frontend files; `req()` (0.066) across auth/publish/results/webhooks/research/health.

---

## Consolidated open checklist (the "fixes or upgrades needed")

### Needs Jack (human steps / decisions / credentials) — highest priority first

1. **Phase 0:** log the baseline week (`baseline_hours`) — unlocks Phase 3 hours-cut.
2. **Phase 0:** agree invite-link naming convention (`src-campaign-yymm`).
3. **Phase 0:** make the EzyMap indicator repo private.
4. **Phase 1:** run **one real ✅ on a morning map** on @ezymap (Desk loop end-to-end proof).
5. **Phase 1:** set the TradingView alert JSON (signal card draft, COUNTER-TREND kept).
6. **Phase 1:** signal bot push to `signals-ingest` (key on its host) — Jack + signal bot repo.
7. **Phase 1:** PC worker nightly backup file needs keyring `db_url`.
8. **Phase 2:** `twinos_call()` in ABDUL with the key from the keyring.
9. **Phase 2:** Friday scoreboard with Vantage + TikTok manual inputs; `v_friday_scoreboard` complete.
10. **Phase 3:** Meta app Live, Standard Access — Jack.
11. **Phase 3:** YouTube API project; audit form submitted; private uploads until it passes — Jack.
12. **Phase 3:** hours-cut baseline week (Jack logs from Mon 5 Oct) then a real week.
13. **Phase 4:** link the discussion group; bot admin; `mod_rules` seeded; warn → mute → ban live — Jack.
14. **Phase 5:** real GPU run of `studio/clipper.py`; Jack records in `~/EzyMap/lives/`.
15. **Phase 5:** double-down alert source (per-video TikTok views) — pending research.
16. **Phase 6:** lawyer's opinion on compliance before paid ads — Jack.
17. **Phase 7:** YouTube long-form first real run on Jack's PC.
18. **Phase 7:** pick the WhatsApp channel + spec the retention hooks.
19. **Phase 8:** hosting decision — Jack (recommend: leave the sales bot where it is until the parallel run).
20. **Phase 9 Wave 4:** publish the dashboard for the Mini App; register the Mini App with @BotFather; one live test — Jack.
21. **Phase 9 Wave 4.5:** record the 20 s BM voiceover reference clips — Jack (for the TTS bake-off).

### Needs builds (code) still open

1. **Phase 8 (repo-adjacent):** `recordSitePurchase` check-then-insert race fix (site repo) — `on conflict do nothing returning id`; notify Sarah only when a row came back. Stripe retries on 400 → noise + delayed second pass; no double purchase (unique column holds).
2. **Phase 8 (repo-adjacent):** `listUsers({perPage: 1000})` in `provisionAccount` — look the buyer up by email via admin filter, or keep an `email → user_id` lookup. Past 1,000 users a repeat buyer is not found.
3. **Phase 8:** narrow read endpoint in the site's Lovable project — `GET /api/public/twinos/attribution?week=YYYY-MM-DD` + Bearer read-only key; per-campaign-tag counts only; no emails/names/amounts per person; TwinOS stores in `manual_metrics` (kind `campaign`).
4. **Phase 8:** sales bot migration (separate repo) with the parallel-running plan — two weeks both bots, old acts, new writes what it would do; nightly comparison; **zero differences for 14 nights** is the exit criterion; cut over on a quiet weekday morning; failed grants raise an alert + Desk message, never auto-retry silently.
5. **Phase 3:** metrics pollers waiting on the Meta tokens (pollers written; activation waits on tokens).
6. **Phase 5:** double-down alert — blocked until a per-video views source exists.

### Pending builds / research

1. Phase 2: Friday scoreboard with Vantage + TikTok manual inputs.
2. Phase 5: double-down alert design once a source exists.
3. Phase 7: WhatsApp retention hooks design once the channel is picked.
4. Phase 9 Wave 5: RSS macro digest (needs Jack's feed URL); Telegram Stars / ad share reporting rows (Phase 8 decisions first).

### Graph-driven follow-ups (from the review itself)

1. Run `graphify query` to explore the 622 isolated nodes (candidates: `FailedJob`, `SettingChange`, `Tone`, `Search`, `Row` + 617 more) — likely missing tests or missing cross-references, not necessarily missing code.
2. Consider splitting the low-cohesion clusters before further Wave growth: `health.tsx` (0.05), `backoff.ts` (0.05), `twinos_mcp.py` (0.05), `tg-webhook/index.ts` (0.07), `_helpers.py` (0.06), `LoadError` (0.09), `twinos_worker.py` (0.07), `fanout.ts` (0.07), `routeTree.gen.ts` (0.05) — each is a navigation/candidate for module split as phases mature.
3. The high-betweenness bridges (`@supabase/supabase-js`, `react`, `req()`) are healthy signs of real cross-cutting seams (shared types, design system, request plumbing), not bugs.

---

## Recommended next actions (in order)

1. **Jack's manual steps first** (the "needs Jack" list above) — each is one command or one decision he makes.
2. **Phase 8 fixes** — build the two printezy-side fixes (repo-adjacent) and the narrow read endpoint, since Phase 6 exit depends on them.
3. **Finish Phase 9 Wave 4** — Mini App go-live sequence (publish dashboard → @BotFather → live test) needs Jack's go; voiceover bake-off needs Jack's recordings.
4. **Close Phase 9 Wave 5** — Jack's RSS feed URL for the macro digest; then Stars/ad-share reporting rows ride the Phase 8 decisions.
5. Re-run `graphify update .` before any further review so the graph reflects current code.

## Sources

- `docs/PHASES.md`, `docs/PHASE8.md`, `docs/UPGRADE-IDEAS.md`, `docs/AI-CODER-PROMPT.md`, `docs/UPGRADE-PLAN.md` (§17)
- `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, `graphify-out/.graphify_analysis.json`, `graphify-out/manifest.json`
- `supabase/functions/_shared/*`, `supabase/functions/*/index.ts`, `workers/pc/*`, `apps/mcp/*`, `tests/check_consistency.py`, `mirror-hub/*`

---

Report compiled at `docs/reports/2026-10-24-graphify-review.md`.
