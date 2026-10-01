# TwinOS — Supabase (Phase 0, "the mind")

The database behind TwinOS: Postgres schema, triggers, row-level security, cron
hooks and the seed that encodes the three EzyMap documents (Growth Plan, Channel
Posting Kit, Jack's FYP Content Plan). Spec: `UPGRADE-PLAN.md` §4, §8–§12.

This is a **new** Supabase project in Jack's own account (decision 10). It never
writes to printezy's database.

## Layout

```
supabase/
  config.toml            minimal CLI config (project_id is the local name "twinos")
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
    0011_contract.sql    reconciles the schema with the Edge Functions: the three missing
                         tables (api_keys, idempotency_keys, tg_updates), the columns the
                         functions read and write, the post_type rename, the approval
                         authority, and the views that had to follow
  seed.sql               business inputs from the PDFs and printezy/EzyAi (idempotent)
  tests/smoke.sql        asserts: strict win rate, guards, action_log, stop-if, RLS
```

## Why 0011 exists

`0001`–`0010` and `supabase/functions/` were written against two different
readings of `docs/API.md`. `deno check` passed because the functions are typed
against their own interfaces rather than against Postgres, and the migrations
loaded because nothing had ever executed the two together. The first real
`db push` would have failed on every function call.

`0011_contract.sql` is additive: no earlier migration is rewritten, and every
column the earlier files use is still there. Where the two sides disagreed on a
name, the migration keeps its own column and adds the function-side one, with a
trigger or a generated view keeping them in step. It was verified on a real
Postgres 17 by loading `0001`–`0015` + `seed.sql` and running `tests/smoke.sql`,
which CI now does on every push.

Three decisions inside it are worth knowing:

- **`post_type` uses the Posting Kit names** (`signal_card`, `result_reply`,
  `channel_audit`, `holiday`). Everything that writes a post type is an Edge
  Function, so the enum follows the functions. The short names are gone, not
  aliased, so there is one vocabulary.
- **The approval authority is the `approvals` row**, not
  `content_variants.approved_by`. `approve/index.ts` writes
  `{content_id, decision, by_actor, by_subject, via}` and then flips the item
  status; it never sets `approved_by`. `twinos_approved_for()` is the single
  predicate both the variant guard and the function path go through.
- **`board_rule` is a narrow exception, not a hole.** A `via = 'board_rule'`
  approval (plan §9.N.107, ABDUL may post a result reply that comes straight from
  the board) is accepted only for a `result_reply` whose variant claims no
  `price` and no `offer`. Anything with money in it still needs Jack.

## Apply

Prerequisites: the [Supabase CLI](https://supabase.com/docs/guides/cli), a new
empty project created in the Supabase dashboard (§16.3 decides which account).

```bash
cd TwinOS-helper-system
supabase login
supabase link --project-ref <ref>        # remembers the project ref (supabase/.temp)
supabase db push                         # applies migrations/0001..0015 in order
psql "$(supabase db url)" -v ON_ERROR_STOP=1 -f supabase/seed.sql   # or: supabase db reset --linked (migrations + seed)
psql "$(supabase db url)" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
```

Local stack (needs Docker): `supabase start && supabase db reset` applies
migrations and `seed.sql`, then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/smoke.sql`.

A plain Postgres works too — `0001_core.sql` creates `anon`, `authenticated` and
`service_role` if they are missing, which is what the CI job relies on:

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/smoke.sql
```

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
| `anon` | the public board: `v_results_board`, backed by column grants and an RLS policy on live, non-shadow `signals` only (0013) |

Guards that no role can bypass (triggers, 0008 and 0011):

- `content_variants.requires_approval` is forced on when `claim_flags` is non-empty
  or the post type is gold_map, signal_card, result_reply, scorecard, offer,
  member_result or outlook.
- `status → approved` requires a Jack decision: either the variant itself records
  `approved_by = 'jack'`, or an `approvals` row exists for the item with
  `decision = 'approve'` and `by_actor = 'jack'`. `twinos_approved_for()` is the
  one predicate both paths go through. ABDUL, the dashboard and cron cannot
  supply one.
- `approvals.decision` is refused for any writer that is not `jack`, with one
  narrow exception: `via = 'board_rule'`, the plan's §9.N.107 rule that ABDUL may
  post a result reply built straight from the board. That exception applies only
  to a `result_reply` whose variant claims no `price` and no `offer`.
- `status → scheduled/publishing/published` is blocked for result_reply and
  scorecard posts without `board_refs`, for any unresolved `[NEEDED]` field, and
  for anything that requires approval but has none.
- `action_log` is written for every insert/update/delete on `content_variants`,
  `publish_jobs`, `approvals`, `invite_links`, `products`, `settings`, `mod_rules`,
  with the actor taken from the JWT claim (`system` when there is none).

`tests/smoke.sql` asserts each of these, including that a non-Jack `approvals`
row is refused and that `board_rule` cannot carry a price or an offer.

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
| `api_keys` | Scoped keys for ABDUL, the PC worker and EzyAi. Only the SHA-256 of each key is stored; `mint_api_key(name, role)` returns the plain key once |
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
| `idempotency_keys` | Stored responses for retried writes, so a repeat replays instead of double-posting |
| `tg_updates` | Telegram `update_id` de-dupe; Telegram re-sends an update on any non-200 |

## Not done here (by design)

The Edge Functions, the ops bot, the Lovable screens and the MCP server are
Phase 1+. The migrations, the seed and `tests/smoke.sql` have been run end to end
against a real Postgres 17 and pass; CI repeats that on every push. What has
**not** happened yet is a `db push` to Jack's own Supabase project, so nothing
has been verified against Supabase's own extensions (`pg_cron`, `pg_net`,
`pgvector`) or a real deployment.
