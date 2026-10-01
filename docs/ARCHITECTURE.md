# Architecture (plan §7, short form)

```
Jack ── Telegram: EzyMap Desk group + approve buttons + publish kits ──┐
Jack ── TwinOS dashboard (Lovable, apps/dashboard) ─────────────────────┤
Jack ── voice/chat ─▶ ABDUL ── MCP (apps/mcp) ──────────────────────────┤ one API, one set of rules
                                                                        ▼
                         ┌─────────────────────────────────────────────────┐
                         │ TwinOS backend = Jack's own Supabase project     │
                         │  Postgres: the mind   (supabase/migrations)     │
                         │  Edge Functions: the rules (supabase/functions) │
                         │  pg_cron: the clock   Storage: media ≤45 MB     │
                         └──▲──────────▲───────────────▲──────────▲────────┘
          signals, outcomes │          │ webhooks       │ reads    │ jobs (outbound only)
                 ┌──────────┴──┐  ┌────┴─────────┐  ┌───┴──────┐ ┌─┴──────────────────┐
                 │ Signal bot  │  │ @EzyOps_bot   │  │ printezy │ │ PC worker          │
                 │ TradingView │  │ Desk group,  │  │ board,   │ │ workers/pc         │
                 │ alerts      │  │ channel,     │  │ ad clicks│ │ clips, local AI,   │
                 └─────────────┘  │ moderation   │  │ (read)   │ │ drop folder,       │
                                  └──────────────┘  └──────────┘ │ Telechurn CSV,     │
                                                                 │ nightly backup     │
                                                                 └────────────────────┘
```

## Where each job runs

| Job | Runs on | Why |
|---|---|---|
| Queue, scheduling, Telegram (IG/FB/Threads in Phase 3) publishing, approvals, Desk group, moderation, member events | Edge Functions + pg_cron | Always on, independent of Jack's PC |
| Signal computation | The signal bot (unchanged) | Already tested, already live |
| Clipping, transcription, local AI, thumbnails, research batches, backups | PC worker | Needs the GPU and the drop folder; can run late |
| Sales, payments, licences | The sales bot (unchanged until Phase 8) | Revenue core, highest risk |

The PC worker never opens a port: it asks `jobs/claim`, works, posts `jobs/result`.

## The ten functions

| Function | Trigger | Does |
|---|---|---|
| `content` | dashboard, ABDUL, cron | draft from template, request approval, schedule |
| `approve` | Jack (dashboard JWT) or tg-webhook (Jack's Telegram id) | the publish gate; writes `approvals`, flips status, enqueues publish jobs |
| `publish` | pg_cron every minute | claims due `publish_jobs`, sends, records `tg_posts`/`signal_posts`, backoff on failure |
| `tg-webhook` | Telegram | Desk input → draft; buttons; `chat_member`/`chat_join_request` → `member_events`; discussion moderation; reactions |
| `tv-webhook` | TradingView | alert → `signals` + signal-card draft in the Desk (COUNTER-TREND line kept) |
| `signals-ingest` | The signal bot | idempotent batch ≤50, per-row results, 200/207/400 |
| `results` | ABDUL, cron, the signal bot | result reply under the original signal; `stop-if` sweep |
| `health` | everyone (beats), cron (`check`) | beats, stale alerts, "anything broken?" |
| `friday` | cron, Jack, ABDUL | scoreboard read, manual inputs, scorecard draft + image job |
| `jobs` | PC worker | claim/result, enqueue, signed upload, asset register, Telechurn import |

Shared code in `supabase/functions/_shared/`: `auth` (JWT or hashed API key →
role), `roles` (the §11 table), `idempotency`, `log` (`action_log`), `tg` (Bot
API client with RetryAfter), `compliance` (the §12 checklist as pure
functions), `content` (template → draft → Desk), `signals` (merge on
`external_id`), `supabase` (admin client + `settings`), `http` (JSON errors).

## Status flow

`draft → pending_approval → approved → scheduled → publishing → published | failed` (+ `rejected`).
Every transition is a row in `action_log`; every decision a row in `approvals`;
every post a row in `tg_posts` and, for signals, `signal_posts` (so the result
can reply under the card).

## Trust boundaries

- Secrets: bot token, TradingView secret, platform tokens live in Supabase
  function secrets; keys for machines are hashed in `api_keys`; Jack's copies in
  his keyring. No secret in any file in this repo.
- Webhooks: Telegram checked by a secret derived from the bot token;
  TradingView by a query-string secret (it cannot set headers). Both constant-time.
- Approval: only the `jack` role (login claim) or Jack's Telegram id. ABDUL has no approve verb.
- AI: only on Jack's own inputs and consented replies; never on group text or
  other channels' posts (Telegram terms).
- Demo/shadow signals are stored but never published.
