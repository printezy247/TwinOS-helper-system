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
`0001`–`0021` are applied live and match the repo. What remains unverified is
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
- [ ] Meta app Live, Standard Access — Jack (docs/SETUP.md 3.1). Providers are written and tested against a stand-in Graph API (`_shared/meta.ts`: Instagram Reels/photo, Facebook Reels, Threads; 24 h caps 100/30/250 hold a job for 30 min without using an attempt); they switch on when the secrets exist
- [x] Fan-out: one master post becomes a child item per platform (`POST /content/{id}/fanout`, Desk `/fanout`); captions adapted per platform, TikTok/YouTube/X as copy-paste kits sent to the Desk, approvals stay per platform in the dashboard. The worker drop folder already ingests the asset; attach it with `asset_id`
- [ ] YouTube API project; audit form submitted; private uploads until it passes
- [x] Per-platform validator (`_shared/platforms.ts`: media needed, video length and size, hashtag count, caption length; conservative limits in one table) and the caption adapter (risk line kept in front of any cut)
- [ ] Metrics pollers (IG/FB/Threads/YouTube) — Meta token-expiry watch is done (`health` warns 7 days ahead and alerts once a day); the pollers wait for the Meta tokens
- [x] "All platforms posted" Friday report line (`v_fanout_week` + `fanoutLine`, migration 0021, in the scorecard `hours` field)
- [ ] Hours cut ≥60% vs baseline — measured by `v_hours_cut` (saved minutes per KL week against the first baseline week) and printed on the Friday scorecard; it needs the baseline week Jack logs from Mon 5 Oct, then a real week of use

## Phase 4 — Community + tracking (Nov–Dec)
Exit: every swap shows joins and 7-day retention.
- [ ] Discussion group linked; bot admin; `mod_rules` seeded; warn → mute → ban live — the engine is rebuilt and tested (`_shared/moderation.ts`: scam phrases EN/BM, new-member link block with our own domains allowed, impersonation incl. lookalike letters, ladder warn → 24 h mute → ban, admins and Jack exempt). It switches on when Jack links the group: `settings.discussion_group_chat_id` and the bot as admin (delete, restrict, ban). Flood control is NOT enforced yet: it needs a per-message counter that is not stored
- [x] Join-request captcha + CAS check (`onJoinRequest`: a CAS-banned account is declined and logged `cas_blocked`; otherwise a private "I am a person" button, only that person can press it; needs invite links created with approval)
- [x] Scam-impersonation watch (flag to the Desk, nothing removed) and repeat-question detector (`v_repeat_questions`, migration 0022; the Desk hears about a question the second time it is asked)
- [x] Post view snapshots at +1 h / 24 h / 7 d (`metrics/snapshots`, cron every 15 min, reads the public preview `t.me/s/<channel>` because bots cannot read views; parser checked against the real @ezymap page; a snapshot is only taken inside its window so it is never mislabelled). Needs `scripts/deploy.sh`
- [x] Swap tracker (one named link per partner through `POST /links`) + funnel view (`v_funnel`, cost per first-time depositor in `v_stop_if`)
- [x] Reference-channel benchmark cards refreshed weekly (`metrics/benchmarks`, Monday 03:00 MYT: size, average views, view rate, posts per day into `benchmarks`; handles never leave the table). A channel with its preview switched off is skipped
- [ ] Signal board + Inbox screens in Lovable

## Phase 5 — Studio + research (Dec–Jan)
Exit: a live becomes clips without CapCut's help for the cut list; Monday brief every week; ≥70% hours cut.
- [ ] `studio/clipper.py` on the GPU: transcript, cut points, SRT, clean clips, cover text — the pipeline and its pure parts (highlight picking, SRT, cover text) are now tested, and the queue contract is fixed (the MCP and the worker disagreed: every clip job would have failed with "source not found: tiktok"). The first real run needs Jack's PC: `pip install faster-whisper`, ffmpeg, a recording in `~/EzyMap/lives/`
- [x] Layout templates (chart full, chart + face, blurred fill) and the end card (`studio/layouts.py`, tested as ffmpeg commands: 1080x1920, drawtext-safe text, a silent track so the card joins). A real render still needs ffmpeg on the PC
- [ ] Research: personas, autocomplete expansion (ms/MY), Search Console, Bing, YouTube competition score, channel RSS — autocomplete expansion is built and checked against the real endpoint (`research/expand`, weekly: every persona seed in en/ms/manglish plus its core words, scored into `topic_clusters`; a CSI reading Jack typed lifts a matching topic). Search Console, Bing and the YouTube Data API need Jack's accounts and keys, so they are not built
- [x] Monday brief against the 28-day calendar (`research/brief`, Monday 07:00 MYT: the week's calendar slots, the best fitting scored topic per pillar, each used once, to `briefs` and the Desk; score = demand x ICP fit x (1 - compliance risk)). CSI capture: `POST /research/csi` is live-ready; the dashboard form is in the Research screen
- [ ] Double-down alert (part 2 within 48 h) — not buildable yet: it needs per-video TikTok views and there is no source for them (only the weekly totals Jack types). It starts as soon as a source exists
- [ ] Research briefs screen in Lovable

## Phase 6 — Pilot readiness (January 2027)
Exit: cost per FTD visible daily.
- [ ] Ad landing attribution checked end to end (printezy read endpoint)
- [x] Cost per first-time depositor per campaign (`POST /friday/campaign`, `v_campaign_cost`, migration 0025: spend, accounts and depositors per campaign, kept apart from the weekly totals so nothing double-counts; the week's ad spend is an optional Friday source `ads`). It fills as Jack enters numbers
- [x] Quarter target tracker + stop-if alarms (`v_quarter_targets`: Q4 2026 / Q1 / Q2 targets and days left read live; `v_stop_if`: no-result signal, cost per depositor over $120 two weeks running, refunds over 3%, none flagged yet). Actuals follow the data
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
