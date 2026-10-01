# TwinOS — Supabase (Phase 0, "the mind")

The database behind TwinOS: Postgres schema, triggers, row-level security, cron
hooks and the seed that encodes the three EzyMap documents (Growth Plan, Channel
Posting Kit, Jack's FYP Content Plan). Spec: `UPGRADE-PLAN.md` §4, §8–§12.

This is a **new** Supabase project in Jack's own account (decision 10). It never
writes to printezy's database.

## Layout

```
supabase/
  config.toml            minimal CLI config (project_id blank until linked)
  migrations/
    0001_core.sql        settings, brand_facts, products, personas, action_log, approvals,
                         health_checks, alerts, jobs, baseline_hours, time_saved, role helpers
    0002_content.sql     templates, style_guide, hooks, calendar_slots, live_runsheets,
                         content_items, content_variants, assets, publish_jobs,
                         platform_accounts, compliance_checks
    0003_signals.sql     signals, signal_outcomes, signal_posts, strict win rate, ingest RPCs
    0004_telegram.sql    invite_links, member_events, memberships, channel_daily, tg_posts,
                         post_snapshots, telechurn_imports, bot_start_tags, mod_rules,
                         moderation_events
    0005_cross_platform.sql  post_metrics, manual_metrics, inbox_items
    0006_research.sql    queries, topic_clusters, briefs, csi_captures, benchmarks, exemplars (pgvector)
    0007_views.sql       v_results_board, v_results_weekly, v_content_log, v_friday_scoreboard,
                         v_funnel, v_quarter_targets, v_stop_if
    0008_triggers.sql    action_log trigger, updated_at, approval/publish guards, membership fold
    0009_rls.sql         RLS on every table, policies per role, grants
    0010_cron.sql        pg_cron + pg_net, twinos_cron_call(), example schedules (commented)
  seed.sql               business inputs from the PDFs and printezy/EzyAi (idempotent)
  tests/smoke.sql        asserts: strict win rate, guards, action_log, stop-if, RLS
```

## Apply

Prerequisites: the [Supabase CLI](https://supabase.com/docs/guides/cli), a new
empty project created in the Supabase dashboard (§16.3 decides which account).

```bash
cd TwinOS-helper-system
supabase login
supabase link --project-ref <ref>        # writes project_id into config.toml
supabase db push                         # applies migrations/0001..0010 in order
psql "$(supabase db url)" -v ON_ERROR_STOP=1 -f supabase/seed.sql   # or: supabase db reset --linked (migrations + seed)
psql "$(supabase db url)" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
```

Local stack (needs Docker): `supabase start && supabase db reset` applies
migrations and `seed.sql`, then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/smoke.sql`.

Migrations are idempotent where practical (`if not exists`, `create or replace`,
`drop policy if exists`), so re-running `db push` after an edit is safe. The seed
upserts on natural keys; `calendar_slots` rows are re-created by source.

After the first push, three things are set by hand (never in files):

1. `settings.edge_base_url` — `https://<ref>.supabase.co/functions/v1` once the
   Edge Functions exist (Phase 1).
2. A Vault secret named `twinos_cron_secret` (`select vault.create_secret('<random>', 'twinos_cron_secret')`),
   the bearer token the cron functions expect.
3. The `cron.schedule(...)` calls at the bottom of `0010_cron.sql`, uncommented
   in the SQL editor once 1 and 2 exist.

Rows with `settings.needs_confirm = true` (IB numbers, trial days, chat ids,
bot name, signal expiry window) are placeholders Jack confirms before Phase 1.
`products.price_usd` is NULL where Jack has not set a price (monthly EzyMap Pro,
the funded tiers, the EzyAI founding price) — see UPGRADE-PLAN §16.2.

## Role model

Every connection is either the **service role** (Edge Functions, bypasses RLS)
or an **authenticated** JWT carrying a custom claim `twinos_role`. Scoped keys
for EzyAi, the ops bot, the PC worker, ABDUL and cron are JWTs signed with the
project's JWT secret with `role: "authenticated"` and the `twinos_role` claim;
Jack and the dashboard get the claim through a Supabase Auth hook
(`custom_access_token_hook`) that reads a `jack`/`dashboard` mapping.

| twinos_role | May |
|---|---|
| `jack` | everything |
| `abdul` | read all; insert/update `content_items` and `content_variants` while `draft`/`pending_approval`; insert `jobs`, `queries`, `csi_captures`, `manual_metrics`, `approvals` (requests), `compliance_checks`, `briefs`, `exemplars`, `baseline_hours`, `time_saved`, `alerts`, `health_checks` |
| `cron` | like `abdul`, plus `publish_jobs` and `channel_daily` |
| `ops_bot` | insert `member_events`, `moderation_events`, `post_snapshots`, `tg_posts`, `signal_posts`, `invite_links`, `channel_daily`; update `publish_jobs`, `tg_posts`; read `settings`, `mod_rules`, `invite_links`, `publish_jobs`, `content_variants/items`, `tg_posts`, `signal_posts`, `member_events`, `approvals`, `brand_facts`, `templates` |
| `ezyai` | insert / upsert `signals` and `signal_outcomes` only (plus health beats); use `ingest_signals(jsonb)` and `ingest_outcome(jsonb)` |
| `pc_worker` | select/update `jobs`; insert `assets`, `post_metrics`, `telechurn_imports`, `queries`, `topic_clusters`; read `settings`, `assets`, research tables, `content_*`, `personas`, `benchmarks`, `exemplars` |
| `dashboard` | read all; writes only through RPC / Edge Functions |
| `anon` | `select` on `v_results_board` only |

Guards that no role can bypass (triggers, 0008):

- `content_variants.requires_approval` is forced on when `claim_flags` is non-empty
  or the post type is gold_map, signal, result, scorecard, offer, member_result or outlook.
- `status → approved` only with `approved_by = 'jack'`, written by `jack` (or the
  service role acting on Jack's Telegram tap). Same for `approvals.decision`.
- `status → scheduled/publishing/published` is blocked for result and scorecard
  posts without `board_refs`, for any unresolved `[NEEDED]` field, and for anything
  that requires approval but has none.
- `action_log` is written for every insert/update/delete on `content_variants`,
  `publish_jobs`, `approvals`, `invite_links`, `products`, `settings`, `mod_rules`,
  with the actor taken from the JWT claim (`system` when there is none).

Tokens never live in tables: `platform_accounts.vault_secret_name` holds the name
of a Vault secret, Edge Functions read the value.

## Pointing Lovable at it

Schema first (§8): the schema here is the contract; Lovable generates screens
against it and must not redesign tables.

1. In the Lovable project, connect the Supabase integration to this project
   (Jack's account, same ref as `config.toml`).
2. Turn on GitHub sync to this repo so anything Lovable generates lands next to
   these migrations. Lovable-written migrations go after `0010_*` with the same
   numbering style and are reviewed before `db push`.
3. The UI reads through the views and tables its role allows (`dashboard` or
   `jack` claim). **No direct table writes from the UI**: every write goes through
   an RPC (`ingest_signals`, `ingest_outcome`, and the Phase 1 functions) or an
   Edge Function (`content`, `approve`, `publish`, `tg-webhook`, `tv-webhook`,
   `signals-ingest`, `metrics`, `research`, `jobs` — §11). The RLS and the guards
   make a direct write from the dashboard fail, which is intended.
4. The approve action exists only for Jack's Telegram tap and his own dashboard
   session; ABDUL and Lovable-generated screens never carry an approve button for
   other roles (§9.N.108).
5. `anon` sees only `v_results_board`; a public board page can be built on it
   without a login.

## Glossary (one line per table and view)

| Object | What it holds |
|---|---|
| `settings` | Business constants as jsonb: timezone, channel ids, posting times, IB numbers, trial days, quarter targets; `needs_confirm` flags placeholders |
| `brand_facts` | Promise, pledge, IB disclosure, strict win-rate rule, hashtag index — locked lines pasted verbatim |
| `products` | The price list: three ladders with `ladder`, `step`, `billing` (monthly/lifetime/one_time); offer posts may only quote from here |
| `personas` | The six ICPs with pain points and seed questions (EN/BM/Manglish) |
| `action_log` | Trigger-written audit trail: actor, action, target, payload |
| `approvals` | Jack's Approve/Edit/Reject/Reschedule decisions and the Desk message they came from |
| `health_checks` | Beats from EzyAi, ops bot, scheduler, PC worker, pollers |
| `alerts` | Stop-if, health, publish failures, double-down tasks; deduped while open |
| `jobs` | Outbound-only work queue the PC worker and ABDUL poll (clips, research, backups) |
| `baseline_hours` | Week 1 time log by task (decision 6) |
| `time_saved` | Minutes TwinOS saved per automated action, linked to `action_log` |
| `templates` | One row per Posting Kit post type: prompt, fields, examples, required lines, char limit, approval rule |
| `style_guide` | Master prompt, voice/emoji/format rules, banned words, glossary, disclaimers, checklist, Jack's notes |
| `hooks` | The 40 TikTok hook lines (20 EN/BM pairs) with usage counters |
| `calendar_slots` | 28-day TikTok calendar, channel daily rhythm, weekly extras, lives |
| `live_runsheets` | Minute-by-minute run sheets for the three live formats |
| `content_items` | One idea: post type, pillar, ICP, Jack's raw input, batch number |
| `content_variants` | One rendering per platform and language with status flow, claim flags, board refs, `[NEEDED]` fields |
| `assets` | Media: drop-folder exports, clips, captions, thumbnails, scorecard images |
| `publish_jobs` | Scheduler queue with idempotency key, attempts, error class, platform post id |
| `platform_accounts` | Which account posts where; Vault secret names only |
| `compliance_checks` | Evidence trail: which checks passed per variant, by whom, when |
| `signals` | Every signal pushed by EzyAi or TradingView (EzyAi field names), with status and R |
| `signal_outcomes` | Outcome events per signal (tp1, tp2, be, sl, expired), idempotent by `external_id` |
| `signal_posts` | Channel message ids of each signal card and its result replies |
| `invite_links` | Named invite links (`src-campaign-yymm`) with source, campaign, partner, cost |
| `member_events` | Raw join/leave/join-request events from the Bot API |
| `memberships` | Events folded into stays: joined, left, source link |
| `channel_daily` | Daily member count and joins/leaves per source (bot_api, telechurn, manual) |
| `tg_posts` | Every channel message the ops bot published or saw |
| `post_snapshots` | Views/forwards/reactions at +1h, 24h, 7d |
| `telechurn_imports` | Weekly Telechurn reference numbers per link |
| `bot_start_tags` | Read copy of @EzyRegisterBot `/start` tags |
| `mod_rules` | Moderation rules: scam keywords EN/BM, link block for new members, flood, impersonation, CAS, captcha |
| `moderation_events` | What the ops bot did and under which rule |
| `post_metrics` | Polled metrics per platform post (views, watch time, saves, followers gained) |
| `manual_metrics` | Weekly two-minute entries: TikTok, Vantage portal, Telechurn, revenue, subscriptions, ads |
| `inbox_items` | Comments and replies from IG/FB/YouTube/Threads with suggested replies |
| `queries` | Raw demand signals from free sources (autocomplete, Search Console, Bing, YouTube, CSI, polls) |
| `topic_clusters` | Scored topics (demand × ICP fit × low compliance risk) with a 384-dim embedding |
| `briefs` | The Monday brief proposing next week's 7 TikToks |
| `csi_captures` | Weekly TikTok Creator Search Insights capture form |
| `benchmarks` | The five reference channels (handles pending) and their public rhythm |
| `exemplars` | Jack's own best posts and edits as writing examples, with embeddings |
| `v_results_board` | Public per-signal board with rolling 28-day strict stats (live rows only) |
| `v_results_weekly` | Weekly wins/losses/BE, strict win rate, total R, best/worst trade |
| `v_content_log` | The Google Sheet columns, filled automatically |
| `v_friday_scoreboard` | The twelve Friday numbers per week |
| `v_funnel` | TikTok → bot start → channel join → IB account / depositor per week |
| `v_quarter_targets` | Growth Plan targets vs actuals |
| `v_stop_if` | Open stop-if alarms: signal past its window with no result reply, cost per FTD, refund rate |

## Not done here (by design)

Edge Functions, the ops bot, the Lovable screens and the MCP server are Phase 1+.
The migrations have not been run against a live Postgres on this machine (none
installed); run `tests/smoke.sql` on the first `db push` or local `supabase start`.
