# Phases — checklist (plan §13)

Tick as done. "Jack" items are in `docs/SETUP.md` with commands.

## Phase 0 — Plan and mind (1–7 Oct 2026)
Exit: schema reviewed; baseline logged.
- [ ] Baseline week: hours by task logged (`baseline_hours`) — Jack
- [x] Unified monthly-first price list decided (§16 Q2): catalog prices kept, TradingView Pro $29/mo; EzyAI founding price deferred to Q1 2027
- [x] Reference-channel handles given (§16 Q1) — in the `benchmarks` table only (44fx, Callisto Fx, Orient Fx, 10X INTERNATIONAL, SandyFx, vexaflowai, bengoldtrader)
- [x] Schema written and reviewed (`supabase/migrations`, 0001–0017)
- [x] Schema verified against a real Postgres: migrations + seed + `tests/smoke.sql` load and pass, and CI repeats it on every push
- [x] Schema reconciled with the Edge Functions (`0011_contract.sql`) — the two halves had drifted and nothing had ever run them together
- [x] Seed: settings, brand_facts, products, personas, 15 templates, style_guide, hooks, calendar_slots, live_runsheets, mod_rules, benchmarks (`supabase/seed.sql`)
- [x] MCP `ENDPOINTS` matched to the deployed function routes; 40 tests pass
- [x] Settings keys aligned: the functions read the same names the seed and views write
- [x] `docs/SETUP.md` verified — all 7 SQL blocks execute, all counts checked against a live database
- [x] Cross-file consistency checks (`tests/check_consistency.py`, 25 checks) in CI
- [x] `deno check`/`deno lint`/`deno test` run locally against Deno 2.9.6 and are clean
- [x] Supabase project created in Jack's account (`cdnyybrfoclexjlroqcf`, Singapore); migrations + seed applied and fingerprint-checked; smoke test green
- [x] `pg_cron`, `pg_net` (in `extensions`), pgvector enabled; private `assets` bucket created (45 MB limit)
- [x] Jack's login created with `twinos_role = jack`
- [ ] API keys minted for pc_worker, abdul, ezyai; stored in keyring / on the host — Jack: `./scripts/mint-keys.sh` (helper + `rotate_api_key()` shipped; keys ride on `X-TwinOS-Key`)
- [x] @EzyOps_bot created; token in keyring and function secrets
- [x] EzyMap Desk group created (Jack + bot); chat ids in `settings`
- [x] Functions deployed; Telegram webhook set with derived secret; `getWebhookInfo` clean (redeploy with `scripts/deploy.sh` after each merge that touches functions)
- [x] Cron schedules installed (publish, health/check, stop-if, friday, backup, keep-alive)
- [x] Lovable project created (frontend-only, Jack's Supabase via public key, no Lovable Cloud), knowledge set — 2 Oct; GitHub sync optional (own repo)
- [ ] Reference-channel benchmark study + `benchmarks` seed + high-capital ICP note — research task
- [ ] Invite-link naming convention agreed (`src-campaign-yymm`) — Jack
- [ ] The EzyMap indicator repo made private — Jack
- [x] Backend scaffolding: `_shared`, ten functions, PC worker, docs, CI (this repo, Phase 0 commit)

**Phase 1 does not start until Jack confirms the Supabase project exists and the
functions are deployed.** Until then the work is local only.

Everything above the Jack items is verified against a real Postgres 17 and a real
Deno 2.9.6, and CI repeats all of it on every push. What remains unverified is
anything that needs a live Supabase project: the `pg_cron`, `pg_net` and
pgvector extensions, a real deployment, and the Telegram webhook.

## Phase 1 — Desk loop (8–21 Oct)
Exit: Jack approves the map and a signal from his phone; a result reply posts by itself.
- [ ] Desk drafts with approve buttons working end to end (`tg-webhook` → `content` → `approve` → `publish`)
- [ ] Telegram publisher and scheduler running every minute; backoff verified with a forced 429
- [x] Templates for all 15 post types seeded and rendering without `[NEEDED]` on the daily ones (`templates.body`; `tests/check_templates.ts` renders all 15 through the compliance engine in CI)
- [ ] TradingView alert → signal card draft (COUNTER-TREND line kept); alert JSON set in TradingView — Jack
- [ ] The signal bot pushing to `signals-ingest` (key on its host) — Jack + signal bot repo
- [ ] Result replies under signals from board status changes
- [ ] Stop-if alarm firing on a test signal with no result
- [ ] Compliance checks on every variant; evidence trail in `compliance_checks`
- [ ] PC worker installed as a user service; `--self-test` green; nightly backup file appears
- [ ] 07:40 / 19:55 reminders (cron → content)
- [x] Approval Inbox screen in Lovable (jack-only Approve) — built 2 Oct; Jack to sign in and confirm with a real draft

## Phase 2 — ABDUL + batch + Friday (22–31 Oct)
Exit: Friday report arrives without Jack opening a spreadsheet.
- [ ] MCP server in `apps/mcp/` with the twelve verbs (no approve) — registered next to `abdul mcp`
- [ ] `twinos_call()` in ABDUL with the key from the keyring
- [ ] Wednesday 14:30 batch (7 lessons + audit + poll + offer), numbered, edits by "N: instruction"
- [ ] Thursday auto-scheduling of the approved batch
- [ ] Scorecard image renderer (`studio/scorecard.py`, port of the sales bot's `receipt.py`)
- [ ] Friday scoreboard with Vantage + TikTok manual inputs; `v_friday_scoreboard` complete
- [ ] Content log rows automatic + Sheet export
- [ ] Named invite links through the bot (`POST /links`); weekly Telechurn numbers imported
- [ ] Content Calendar, Health, Analytics/Friday screens in Lovable

## Phase 3 — Repurposing (November)
Exit: one TikTok reaches seven places with only the TikTok, YouTube and X taps by hand; ≥60% hours cut.
- [ ] Meta app Live, Standard Access; IG / FB Reels / Threads providers in `publish` (limits 100 / 30 / 250 per 24 h)
- [ ] Drop-folder fan-out: asset → per-platform caption variants + publish kits (TikTok, YouTube, X)
- [ ] YouTube API project; audit form submitted; private uploads until it passes
- [ ] Per-platform validator (caption length, hashtags, duration, size)
- [ ] Metrics pollers (IG/FB/Threads/YouTube) + Meta token-expiry watch in `health`
- [ ] "All platforms posted" Friday report line
- [ ] Hours cut ≥60% vs baseline (from `time_saved`)

## Phase 4 — Community + tracking (Nov–Dec)
Exit: every swap shows joins and 7-day retention.
- [ ] Discussion group linked; bot admin; `mod_rules` seeded; warn → mute → ban live
- [ ] Join-request captcha + CAS check
- [ ] Scam-impersonation watch; repeat-question detector → the FAQ bot's sheet
- [ ] Post view snapshots at +1 h / 24 h / 7 d
- [ ] Swap tracker (one link per partner) + funnel view (`v_funnel`)
- [ ] Reference-channel benchmark cards refreshed weekly
- [ ] Signal board + Inbox screens in Lovable

## Phase 5 — Studio + research (Dec–Jan)
Exit: a live becomes clips without CapCut's help for the cut list; Monday brief every week; ≥70% hours cut.
- [ ] `studio/clipper.py` on the GPU: transcript, cut points, SRT, clean clips, cover text
- [ ] Layout templates (chart full, chart + face, blurred fill) and the end card
- [ ] Research: personas, autocomplete expansion (ms/MY), Search Console, Bing, YouTube competition score, channel RSS
- [ ] CSI weekly capture form; Monday brief against the 28-day calendar
- [ ] Double-down alert (part 2 within 48 h)
- [ ] Research briefs screen in Lovable

## Phase 6 — Pilot readiness (January 2027)
Exit: cost per FTD visible daily.
- [ ] Ad landing attribution checked end to end (printezy read endpoint)
- [ ] Cost per first-time depositor per campaign
- [ ] Quarter target tracker + stop-if alarms (`v_quarter_targets`, `v_stop_if`)
- [ ] Lawyer's opinion on compliance obtained before paid ads (decision 7) — Jack

## Phase 7 — Q1–Q2 extras (Feb–Jun 2027)
- [ ] YouTube long-form from Sunday lives
- [ ] BM SEO article briefs
- [ ] WhatsApp retention hooks
- [ ] Annual-plan offer variants

## Phase 8 — Revenue core (after Phase 7)
Exit: payments match the old bot for two weeks.
- [ ] Stars payment idempotency; larger Stripe de-dupe window; service-role key replaced by a narrow read
- [ ] The sales bot migration with parallel running
- [ ] Hosting decision for the sales bot (existing host vs VPS)
