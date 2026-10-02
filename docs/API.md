# API (plan §11) — request/response examples

Base URL: `https://<project-ref>.supabase.co/functions/v1`.
Auth: a login uses `Authorization: Bearer <session JWT>`. A scoped key
(ABDUL, PC worker, signal bot) sends the project's public anon key as
`Authorization: Bearer <anon key>` (and `apikey: <anon key>`) plus
`X-TwinOS-Key: twk_<role>_<40hex>`: the platform gateway only lets JWTs
through, and the function decides who is calling from the `X-TwinOS-Key`
header. Webhooks carry their own secret instead. Every error is
`{ "error": "<code>", "message": "<human>", ...detail }` with codes
`unauthorized 401 · forbidden 403 · bad_request 400 · not_found 404 · conflict 409 · not_configured 503 · upstream_failed 503 · internal 500`.
POSTs that create or change something accept `Idempotency-Key: <id>`
(or `idempotency_key` in the body): a repeat returns the stored response with
`"replayed": true`; the same key with a different body is a 409.

## Who may call what

| Plan endpoint | Function route | Roles |
|---|---|---|
| `POST /desk/input` | `tg-webhook` (Desk group message) | ops_bot (Jack's id) |
| `POST /content/draft` | `POST /content/draft` | jack, abdul, cron, ops_bot |
| `POST /content/{id}/request-approval` | same | jack, abdul, cron, ops_bot |
| `POST /content/{id}/approve` | `POST /approve` | **jack only** |
| `POST /content/{id}/schedule` | `POST /content/{id}/schedule` | jack; abdul/cron for non-claim posts |
| `POST /signals/ingest` | `POST /signals-ingest` | ezyai key |
| `POST /tv/alert` | `POST /tv-webhook?secret=…` | TradingView secret |
| `POST /results/{signal}/reply` | `POST /results` | abdul, cron, ezyai, jack |
| (result drain) | `POST /results/run` | cron, abdul, jack |
| `POST /assets/ingest` | `POST /jobs/asset` (+ `jobs/upload-url`) | pc_worker, jack |
| `POST /links` | `POST /links` | jack, abdul |
| `POST /metrics/manual` | `POST /friday/manual` | jack, abdul |
| `POST /imports/telechurn` | `POST /jobs/telechurn` | jack, pc_worker |
| `GET /friday`, `GET /health`, `GET /jobs` | same | all logged-in / keyed |
| `POST /research/csi`, `GET /research/brief` | Phase 5 | jack, abdul |
| (worker) | `POST /jobs/claim`, `POST /jobs/result` | pc_worker |
| (beats) | `POST /health` | ezyai, ops_bot, pc_worker, cron, abdul, jack |

The full matrix is `supabase/functions/_shared/roles.ts`.

---

## content

### POST /content/draft
```json
{ "post_type": "gold_map", "lang": "en", "platform": "telegram",
  "fields": { "raw_notes": "4590 held, bias up, watch 4612", "date": "01/10/2026" },
  "allowed_numbers": [4590, 4612], "push_to_desk": true,
  "media": [{ "kind": "photo", "file_id": "AgACAgUAAx…" }] }
```
→ `201`
```json
{ "content_id": "6f1c…", "variant_id": "a2b3…", "status": "pending_approval",
  "body": "…rendered text…", "needed": [],
  "compliance": { "ok": true, "needs_approval": true, "claim_flags": ["level","gold_map"],
                  "findings": [{ "check": "claims", "severity": "needs_approval", "message": "…" }] },
  "desk": { "chat_id": -1001234, "message_id": 882 } }
```
`post_type` ∈ gold_map · macro_card · signal_card · result_reply · lesson · channel_audit · scorecard · outlook · offer · poll · evening_wrap · news_alert · member_result · holiday · start_here.
Missing template fields become `[NEEDED:field]` and block publishing.

### POST /content/{id}/request-approval → `{ "ok": true, "desk": {…} }`

### POST /content/remind-map · POST /content/remind-wrap
The 07:40 / 19:55 MYT nudges, called by cron. Once per day (the idempotency key
is the MYT date) and only when nothing arrived: `remind-map` is skipped when a
`gold_map` already exists today, `remind-wrap` when an `evening_wrap` does.
→ `{ "ok": true, "reminded": true, "day": "2026-10-02" }`, or
`{ "ok": true, "skipped": "a gold_map already arrived today" }`.

### POST /content/{id}/schedule
`{ "run_at": "2026-10-02T00:00:00Z" }` → `{ "ok": true, "jobs": 1, "run_at": "…" }`.
Requires status `approved`. If the variant carries a claim flag the caller must be `jack`.

### GET /content/{id} → `{ "item": {…}, "variants": [ … ] }`

## approve  (jack only)
```json
{ "content_id": "6f1c…", "decision": "approve", "run_at": "2026-10-02T00:00:00Z", "note": "ok" }
```
→ `{ "ok": true, "content_id": "6f1c…", "decision": "approve", "jobs": 1 }`
`decision` ∈ approve · reject · reschedule (needs `run_at`). A draft with a
blocking finding answers `409 conflict` with `findings`. The Desk message's
buttons are removed after any decision.
From Telegram the function is called by `tg-webhook` with the service token +
`x-twinos-internal` (derived webhook secret) + `telegram.user_id`, re-checked
against `settings.jack_telegram_user_id`.

## publish  (cron)
`POST /publish` `{ "limit": 10 }` → `{ "ran": 2, "results": [{ "job_id": "…", "ok": true, "kind": "success" }, …] }`.
Failure kinds: `throttled` (retry with backoff 30 s → 15 min), `permanent`
(job failed + alert), `unknown` (retry). Max 4 attempts. Phase 1 provider: Telegram only.

## signals-ingest  (ezyai key)
One signal or `{ "signals": [ … ] }` (≤50). Merge on `external_id`; absent fields keep their values.
```json
{ "signals": [
  { "external_id": "auto-8842", "symbol": "XAUUSD", "direction": "buy", "status": "running",
    "entry_low": 4590.2, "entry_high": 4593.0, "stop_price": 4585.0, "tp1": 4604.0, "tp2": 4612.0,
    "rr": 2.4, "setup": "London continuation", "timeframe": "M15", "quality": "live" },
  { "external_id": "auto-8841", "status": "tp1", "result_r": 1.2, "result_pips": 70 },
  { "status": "sl" } ] }
```
→ `207`
```json
{ "accepted": 2, "results": [
  { "ok": true, "external_id": "auto-8842", "id": "…", "created": false, "status_changed": { "from": "pending", "to": "running" } },
  { "ok": true, "external_id": "auto-8841", "id": "…", "created": false, "status_changed": { "from": "running", "to": "tp1" } },
  { "ok": false, "error": "external_id is required" } ] }
```
`200` all ok · `207` mixed · `400` none ok. `status` ∈ pending · running · tp · tp1 · tp2 · be · sl · cancelled.
A status change to tp/tp1/tp2/be/sl on a `live` signal queues a `result_reply` job.
`GET /signals-ingest` → `{ "signals": [ …open board… ] }`; `?diagnose=1` → key fingerprint.

## tv-webhook  (TradingView)
`POST /tv-webhook?secret=<TWINOS_TV_SECRET>` with the alert JSON
```json
{ "id": "XAUUSD-1759300000", "symbol": "XAUUSD", "tf": "15", "side": "buy",
  "entry": 4591.5, "sl": 4585.0, "tp1": 4604.0, "tp2": 4612.0, "setup": "EzyMap break", "counter_trend": true }
```
→ `201 { "ok": true, "signal_id": "…", "content_id": "…", "desk": {…}, "counter_trend": true }`.
Replays of the same `id` return `200 { "replayed": true }`.

## links
`POST /links` `{ "source": "tt", "campaign": "live", "yymm": "2610", "creates_join_request": false, "member_limit": 500 }`
→ `201 { "ok": true, "link": { "name": "tt-live-2610", "link": "https://t.me/+…", … } }`.
Creates the Telegram invite link and stores it. `source` ∈ tt · ig · fb · yt · threads · x · swap · ad · referral · bio · bot; `name` is built as `source-campaign-yymm` (or sent as `name` and checked against the same shape). The same name on the same chat returns the existing row with `"existing": true`. `GET /links?source=&campaign=&active=1` lists them.

## results
`POST /results` `{ "signal_id": "…" | "external_id": "auto-8841", "status": "tp1", "dry_run": false }`
→ `201 { "ok": true, "content_id": "…", "jobs": 1, "reply_to": 7712, "stats": { "wins": 7, "losses": 3, "be": 2, "win_rate": 0.7, "total_r": 8.4 } }`.
`409` if the signal card was never posted. `POST /results/stop-if` → `{ "ok": true, "missing": ["auto-8800"], "alerted": ["auto-8800"] }` and a Telegram alert to Jack. One open alert per signal (`dedupe_key = stop_if:<signal_id>`), so the 10-minute cron does not re-alert or re-message for the same stuck signal; `alerted` lists only the ones raised on this pass.
`POST /results/run` `{ "limit": 20 }` → `{ "ran": 2, "results": [ { "job_id": "…", "ok": true, "content_id": "…" } ] }`.
Cron calls it every minute: it drains queued `result_reply` jobs (queued by
`signals-ingest` when a live signal closes) so a result posts by itself. The job
claim is an atomic `UPDATE … WHERE status='queued'`, so two ticks never post the
same result twice. `cron` is the usual caller; `abdul`/`jack` may also drain.

## health
`POST /health` `{ "source": "pc_worker", "status": "ok", "detail": { "worker": "jack-pc" } }` → `{ "ok": true }`.
`GET /health` →
```json
{ "ok": false, "summary": "stale: ezyai; 1 open alert(s)",
  "beats": { "ezyai": { "status": "ok", "at": "…", "stale": true, "stale_after_min": 30 }, "scheduler": {…} },
  "open_alerts": [ { "kind": "stale_beat", "severity": "high", "message": "…" } ], "failed_jobs": 0 }
```
`POST /health/check` (cron) → `{ "ok": true, "stale": ["ezyai"] }`.

## friday
`GET /friday?week=2026-10-05` → `{ "week_start": "…", "scoreboard": { …v_friday_scoreboard row… }, "missing_inputs": ["vantage"] }`.
`POST /friday/manual` `{ "week_start": "2026-10-05", "source": "vantage", "metrics": { "ib_accounts_opened": 3, "first_time_depositors": 2, "active_funded_clients": 41, "rebates_usd": 180 } }` → `{ "ok": true, "missing_inputs": [] }`.
`POST /friday/request-inputs` (cron Fri 09:00 MYT) → asks in the Desk group.
`POST /friday/post` → scorecard draft to the Desk + `scorecard_image` job → `201 { "content_id": "…" }`.

## jobs  (PC worker)
`POST /jobs/claim` `{ "worker": "jack-pc", "kinds": ["drop_folder_watch","backup"] }` → `{ "job": { "id": "…", "kind": "backup", "payload": {}, "attempts": 1 } | null }`.
`POST /jobs/result` `{ "job_id": "…", "ok": true, "result": { "file": "twinos-20261002-1900.sql.gz" } }` → `{ "ok": true, "status": "done" }`.
`POST /jobs/upload-url` `{ "filename": "map-recap-1.mp4", "content_type": "video/mp4", "bytes": 18234567 }` → `{ "path": "2026-10-02/ab12cd34-map-recap-1.mp4", "signed_url": "…", "token": "…" }` (PUT the bytes to `signed_url`).
`POST /jobs/asset` `{ "path": "…", "kind": "video", "bytes": 18234567, "sha256": "…" }` → `201 { "asset_id": "…" }`.
`POST /jobs/telechurn` `{ "week_start": "2026-10-05", "rows": [{ "link_name": "tt-live-2610", "joins": 12, "leaves": 3, "retained": 9 }] }` → `{ "ok": true, "rows": 1 }`.
`POST /jobs/enqueue` `{ "kind": "clip", "payload": { "source": "~/EzyMap/lives/2026-10-01.mp4" } }` → `201 { "job_id": "…" }`.
`GET /jobs` → `{ "counts": { "backup": { "done": 6, "queued": 1 } } }`.

## tg-webhook  (Telegram)
Header `X-Telegram-Bot-Api-Secret-Token` = derived secret (see `bots/ops/README.md`). Always answers `{ "ok": true }`; duplicates (same `update_id`) are ignored via `tg_updates`.

---

## Schema contract these functions assume

Owned by `supabase/migrations`. Column names the functions touch, kept in step
by `0011_contract.sql`; `supabase/tests/smoke.sql` and the CI job assert the two
still agree. Where an earlier migration used a different name for the same
value, both exist and a trigger keeps them in step — the column the functions
read is the one listed here.

| Table | Columns the functions touch |
|---|---|
| `settings` | `key` pk, `value` jsonb |
| `api_keys` | `id`, `name`, `role`, `key_prefix`, `key_hash` unique, `last_used_at`, `revoked_at`; RPC `mint_api_key(name, role)` returns the plain key once |
| `idempotency_keys` | `scope`, `key` (pk together), `request_hash`, `status`, `response` jsonb, `created_at` |
| `action_log` | `actor`, `action`, `target_table`, `target_id`, `payload` jsonb, `created_at` |
| `templates` | `id`, `key` (= post type), `lang`, `body`, `fields` jsonb, `required_lines` text[], `char_limit`, `approval_rule`, `active`, `version` |
| `content_items` | `id` uuid, `post_type`, `lang`, `pillar`, `icp`, `title`, `status`, `template_id`, `source` jsonb, `signal_id`, `scheduled_at`, `created_by`, `created_at`, `updated_at`, `desk_chat_id`, `desk_message_id`, `desk_state`, `edit_note`, `approved_at`, `published_at`, `published_ref`, `last_error`, `reject_note`, `reply_to_message_id`, `target_chat_id`, `pin`, `result_status` |
| `content_variants` | `id`, `content_id` (= `item_id`), `platform`, `lang`, `body`, `media` jsonb, `buttons` jsonb, `claim_flags` text[], `needed_fields` text[], `compliance` jsonb, `status`, `approved_by`, `approved_at` |
| `compliance_checks` | `variant_id`, `ok`, `needs_approval`, `findings` jsonb |
| `approvals` | `content_id`, `decision`, `by_actor`, `by_subject`, `via`, `note`, `run_at`, `decided_by`, `decided_at` |
| `publish_jobs` | `id`, `content_id`, `variant_id` unique, `platform`, `run_at`, `status` (queued/claimed/done/failed), `attempts`, `claimed_at`, `done_at`, `last_error`, `created_by` |
| `tg_posts` | `chat_id`, `message_id`, `content_id`, `variant_id`, `post_type`, `posted_at` |
| `tg_updates` | `update_id` pk (webhook de-dupe) |
| `signals` | `id`, `external_id` unique, `source`, `symbol`, `direction`, `status`, `entry_low`, `entry_high`, `stop_price`, `tp1`, `tp2`, `rr`, `setup`, `timeframe`, `counter_trend`, `result_r`, `result_pips`, `quality`, `raw`, `opened_at`, `closed_at`, `updated_at` — each of these is bridged to its signal-bot-named twin (`pair`, `stop_loss`, `rr_target`, `r_multiple`, `data_source`, `signal_at`, `resolved_at`) by `trg_signal_bridge`, so the board views and the signal bot's own ingest keep their spelling |
| `signal_outcomes` | `signal_id`, `status_new` (= `status`), `result_r`, `result_pips`, `raw`, `at` |
| `signal_posts` | `signal_id`, `chat_id`, `message_id`, `content_id`, `kind` (signal/result/card), `status_posted` |
| `member_events` | `chat_id`, `user_id`, `username`, `event`, `old_status`, `new_status`, `invite_link`, `invite_link_name`, `via_join_request`, `at`; `kind` and `occurred_at` are derived so the membership fold still works |
| `mod_rules` / `moderation_events` | `kind`, `pattern`, `action`, `enabled` / `chat_id`, `user_id`, `message_id`, `hits` jsonb, `text_excerpt`, `at` |
| `post_snapshots` | `chat_id`, `message_id`, `kind`, `value`, `detail` jsonb, `at` |
| `health_checks` | `source`, `status` (ok/degraded/down), `detail` jsonb, `at` |
| `alerts` | `kind`, `severity` (info/medium/high/critical), `message`, `payload`, `at`, `resolved_at`, `dedupe_key` |
| `jobs` | `id`, `kind`, `payload`, `status`, `priority`, `run_at`, `claimed_by`, `claimed_at`, `attempts`, `result`, `last_error`, `done_at`, `created_by`, `created_at` |
| `assets` | `id`, `storage_path`, `bucket`, `kind`, `bytes`, `sha256` unique, `source`, `meta`, `created_by` |
| `telechurn_imports` | `week_start`, `link_name` (unique together), `joins`, `leaves`, `retained`, `raw`, `imported_by` |
| `manual_metrics` | `week_start`, `source` (unique together with a non-null `metrics`), `metrics` jsonb, `entered_by`, `entered_at`; a trigger explodes the bag into the long `(week_start, kind, metric, value)` rows the views read |
| `v_friday_scoreboard` | view with `week_start` + the §4.8 numbers |

Storage bucket: `assets` (private).

**Two vocabularies worth knowing.** `post_type` is one enum with the Posting Kit
names (`signal_card`, `result_reply`, `channel_audit`, `holiday`), because the
functions are what write it. `signal_posts.kind` and `signals` columns each keep
both spellings because the signal bot's ingest and the board views predate the functions;
`v_stop_if` and `v_friday_scoreboard` count `kind in ('card', 'signal')` so
neither writer under-reports.
