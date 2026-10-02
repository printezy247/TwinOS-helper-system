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
- [x] API keys minted for pc_worker, abdul, ezyai (2 Oct, `./scripts/mint-keys.sh`; keys live in the keyring and ride on `X-TwinOS-Key`). The ezyai key still has to be copied to the signal bot host by Jack
- [x] @EzyOps_bot created; token in keyring and function secrets
- [x] EzyMap Desk group created (Jack + bot); chat ids in `settings`
- [x] Functions deployed; Telegram webhook set with derived secret; `getWebhookInfo` clean (redeploy with `scripts/deploy.sh` after each merge that touches functions)
- [x] Cron schedules installed (publish, health/check, stop-if, friday, backup, keep-alive)
- [x] Lovable project created (frontend-only, Jack's Supabase via public key, no Lovable Cloud), knowledge set — 2 Oct; GitHub sync optional (own repo)
- [ ] Reference-channel benchmark study + `benchmarks` seed + high-capital ICP note — research task
- [ ] Invite-link naming convention agreed (`src-campaign-yymm`) — Jack
- [ ] The EzyMap indicator repo made private — Jack
- [x] Backend scaffolding: `_shared`, ten functions, PC worker, docs, CI (this repo, Phase 0 commit)

**Phase 1 is live.** Jack confirmed the Supabase project and the functions are
deployed (`cdnyybrfoclexjlroqcf`, all 11 at v8 as of 2 Oct); migrations
`0001`–`0020` are applied live and match the repo. What remains unverified is
anything that needs a real Telegram tap or a real posted signal: the Desk loop
end to end, a result reply under a posted card, and the TradingView/signal-bot
handoffs.

Everything above the Jack items is verified against a real Postgres 17 and a real
Deno 2.9.7, and CI repeats all of it on every push. The `pg_cron`, `pg_net` and
pgvector extensions are enabled, the functions are deployed and the Telegram
webhook is set.

## Phase 1 — Desk loop (8–21 Oct)
Exit: Jack approves the map and a signal from his phone; a result reply posts by itself.
- [ ] Desk drafts with approve buttons working end to end (`tg-webhook` → `content` → `approve` → `publish`)
- [x] Telegram publisher and scheduler running every minute; backoff verified with a forced 429 (`twinos-publisher-tick` fires once a minute — 10 `scheduler` beats in 10 distinct minutes live; `_shared/backoff_test.ts` and `_shared/tg_test.ts` force a 429 through a stubbed Bot API and assert the retry/backoff; `smoke.sql` §15 proves one `publish_jobs` row per variant)
- [x] Templates for all 15 post types seeded and rendering without `[NEEDED]` on the daily ones (`templates.body`; `tests/check_templates.ts` renders all 15 through the compliance engine in CI)
- [ ] TradingView alert → signal card draft (COUNTER-TREND line kept); alert JSON set in TradingView — Jack
- [ ] The signal bot pushing to `signals-ingest` (key on its host) — Jack + signal bot repo
- [ ] Result replies under signals from board status changes (`results/run` drains the queued `result_reply` jobs and is scheduled every minute; needs a **posted** signal card to prove end to end, which needs a real approved signal)
- [ ] Stop-if alarm firing on a test signal with no result (route deployed, `v_stop_if` + dedupe covered by `smoke.sql` §4/§17, cron live; not yet fired on a real signal)
- [x] Compliance checks on every variant; evidence trail in `compliance_checks` (the rewrite path in `jobs` now checks and logs like `createDraft` and the Desk edit; `check_consistency.py` fails if any variant-body write skips `compliance_checks`)
- [ ] PC worker installed as a user service; `--self-test` green; nightly backup file appears (service installed, enabled, lingering; `--self-test` 200; a queued job claimed and finished live. The nightly backup file needs keyring `db_url` — Jack)
- [x] 07:40 / 19:55 reminders (cron → content) (`content/remind-map` + `content/remind-wrap` deployed; `twinos-map-reminder` `40 23 * * 0-4` and `twinos-evening-reminder` `55 11 * * 1-5` live; once per MYT day, only when nothing arrived; `_shared/time_test.ts` covers the day boundary)
- [x] Baseline hours `/hours` in the Desk (deployed; `_shared/hours_test.ts`; Friday scorecard gains an hours line)
- [x] Approval Inbox screen in Lovable (jack-only Approve) — built 2 Oct; Jack to sign in and confirm with a real draft

## Phase 2 — ABDUL + batch + Friday (22–31 Oct)
Exit: Friday report arrives without Jack opening a spreadsheet.
- [x] MCP server in `apps/mcp/` with the verbs (no approve; `FORBIDDEN_PATH` guard, 40 tests). Registering it next to `abdul mcp` is Jack's one command (`claude mcp add twinos -- python3 ~/TwinOS-helper-system/apps/mcp/twinos_mcp.py`)
- [ ] `twinos_call()` in ABDUL with the key from the keyring
- [x] Wednesday 14:30 batch: 7 lessons (5 skill + 2 Start Safe), audit, poll, offer, numbered by `batch_no`, edits by "N: text" (`content/batch`, `_shared/batch.ts`, 15 tests; cron `twinos-wednesday-batch` live; the function needs `scripts/deploy.sh`)
- [x] Thursday sweep (`content/batch-sweep`, cron `twinos-thursday-sweep` Thu 09:00 MYT): queues approved-but-unscheduled posts, nudges the Desk about the rest. `/batch ok` approves what is ready and claim-free
- [x] Scorecard image renderer (`workers/pc/studio/scorecard.py`, Pillow; `test_scorecard.py`)
- [ ] Friday scoreboard with Vantage + TikTok manual inputs; `v_friday_scoreboard` complete
- [ ] Content log rows automatic + Sheet export
- [x] Named invite links through TwinOS (`POST /links`, `src-campaign-yymm` enforced). Weekly Telechurn import: the worker handler exists, it needs Jack's weekly CSV in `~/EzyMap/telechurn/`
- [ ] Content Calendar, Health, Analytics/Friday screens in Lovable

## Phase 3 — Repurposing (November)
Exit: one TikTok reaches seven places with only the TikTok, YouTube and X taps by hand; ≥60% hours cut.
- [ ] Meta app Live, Standard Access; IG / FB Reels / Threads providers in `publish` (limits 100 / 30 / 250 per 24 h)
- [x] Fan-out: one master post becomes a child item per platform (`POST /content/{id}/fanout`, Desk `/fanout`); captions adapted per platform, TikTok/YouTube/X as copy-paste kits sent to the Desk, approvals stay per platform in the dashboard. The worker drop folder already ingests the asset; attach it with `asset_id`
- [ ] YouTube API project; audit form submitted; private uploads until it passes
- [x] Per-platform validator (`_shared/platforms.ts`: media needed, video length and size, hashtag count, caption length; conservative limits in one table) and the caption adapter (risk line kept in front of any cut)
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
