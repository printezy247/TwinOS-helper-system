-- 0001_core.sql — TwinOS "the mind", core tables.
-- UPGRADE-PLAN §9.A, §10. Postgres 15 / Supabase.
-- Conventions: snake_case, timestamptz everywhere, bigint for Telegram ids,
-- 'ms' for Malay. Idempotent where practical (IF NOT EXISTS).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Supabase creates anon / authenticated / service_role itself. On a plain
-- Postgres (the CI job, a local scratch database) they do not exist, and the
-- grants in 0001 and the RLS policies in 0009 would fail. Create them when they
-- are missing; on Supabase this block is a no-op. Needs a role that may
-- CREATE ROLE, which the Supabase `postgres` role has.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Role helpers. Roles come from the JWT claim `twinos_role` (§9.B item 9):
-- jack, abdul, ops_bot, dashboard, cron, ezyai, pc_worker. Service-role
-- connections carry role=service_role and bypass RLS as usual.
-- ---------------------------------------------------------------------------
create or replace function public.twinos_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function public.twinos_role()
returns text
language sql
stable
as $$
  select coalesce(
    public.twinos_claims() ->> 'twinos_role',
    case when public.twinos_claims() ->> 'role' = 'service_role' then 'service_role' end
  );
$$;

-- Actor written into action_log: the twinos_role claim, else the plain
-- Postgres `role` claim (service_role / anon / authenticated), else 'system'.
create or replace function public.twinos_actor()
returns text
language sql
stable
as $$
  select coalesce(
    public.twinos_claims() ->> 'twinos_role',
    public.twinos_claims() ->> 'role',
    'system'
  );
$$;

grant execute on function public.twinos_claims() to anon, authenticated, service_role;
grant execute on function public.twinos_role() to anon, authenticated, service_role;
grant execute on function public.twinos_actor() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- settings: business constants, one source instead of hardcoded copies (§9.A.3)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  needs_confirm boolean not null default false,  -- Jack must confirm before use
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.settings is 'Business constants (timezone, channel ids, posting times, IB numbers, trial days). needs_confirm=true rows are placeholders Jack must confirm.';

create or replace function public.setting(p_key text)
returns jsonb
language sql
stable
as $$
  select value from public.settings where key = p_key;
$$;

create or replace function public.setting_text(p_key text)
returns text
language sql
stable
as $$
  select value #>> '{}' from public.settings where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- brand_facts: promise, pledge, disclosure lines, quoted word for word (§4.1)
-- ---------------------------------------------------------------------------
create table if not exists public.brand_facts (
  key text primary key,
  lang text not null default 'en' check (lang in ('en', 'ms')),
  body text not null,
  locked boolean not null default true,   -- locked lines are pasted verbatim, never rewritten
  source text,                            -- which PDF / repo the line comes from
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.brand_facts is 'Promise, transparency pledge, IB disclosure, strict win-rate rule, hashtag index. Locked rows are quoted verbatim in posts.';

-- ---------------------------------------------------------------------------
-- products: the three ladders, billing monthly | lifetime | one_time (§4.3, decision 14)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  sku text primary key,
  product_group text not null check (product_group in ('package', 'tradingview', 'mt5', 'macro', 'ezyai', 'tier', 'free')),
  name text not null,
  description text,
  ladder text check (ladder in ('free', 'funded', 'paid')),
  step smallint check (step between 1 and 3),
  billing text not null check (billing in ('monthly', 'lifetime', 'one_time')),
  price_usd numeric(10, 2),               -- NULL = Jack must supply (open question §16.2)
  term_months smallint,                   -- prepaid term for one_time plans (1, 6, 12); NULL for lifetime
  min_deposit_usd numeric(10, 2),         -- funded ladder entry condition
  bullets jsonb not null default '[]'::jsonb,
  badge text,
  source text,                            -- 'catalog.ts' | 'growth_plan' | 'posting_kit'
  active boolean not null default true,
  sort_order integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.products is 'Price list. Offer posts may only quote prices from this table. price_usd NULL means Jack has not decided the price yet.';
create index if not exists idx_products_ladder on public.products (ladder, step) where active;

-- ---------------------------------------------------------------------------
-- personas: the six ICPs (§4.2, Growth Plan §05)
-- ---------------------------------------------------------------------------
create table if not exists public.personas (
  id smallint primary key,                -- ICP number 1..6
  key text not null unique,
  name text not null,
  who text not null,
  wants text not null,
  offer text not null,
  entry_point text not null,
  main_pillar text,
  ladder text check (ladder in ('free', 'funded', 'paid')),
  pain_points jsonb not null default '[]'::jsonb,
  seed_questions jsonb not null default '{}'::jsonb,  -- {"en":[],"ms":[],"manglish":[]}
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.personas is 'Six ideal customer profiles from the Growth Plan. Every content item carries an icp tag that references this table.';

-- ---------------------------------------------------------------------------
-- action_log: written by trigger, counts what TwinOS did instead of Jack (§1, §9.A.2)
-- ---------------------------------------------------------------------------
create table if not exists public.action_log (
  id bigint generated always as identity primary key,
  actor text not null,                    -- jack | abdul | ops_bot | dashboard | cron | ezyai | pc_worker | service_role | system
  action text not null,                   -- insert | update | delete | custom verbs
  target_table text not null,
  target_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_action_log_created on public.action_log (created_at desc);
create index if not exists idx_action_log_target on public.action_log (target_table, target_id);
create index if not exists idx_action_log_actor on public.action_log (actor, created_at desc);
comment on table public.action_log is 'Audit trail written by triggers on the tables that matter. Actor is the twinos_role JWT claim, else the role claim, else system.';

-- ---------------------------------------------------------------------------
-- approvals: Jack's taps (§9.C.14). Only the jack role may decide.
-- ---------------------------------------------------------------------------
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  target_table text not null,
  target_id uuid not null,
  requested_by text not null default public.twinos_actor(),
  requested_at timestamptz not null default now(),
  desk_chat_id bigint,                    -- Desk group where the Approve/Edit buttons were shown
  desk_message_id bigint,
  callback_id text,                       -- short id under Telegram's 64-byte limit (§9.C.21)
  decision text check (decision in ('approved', 'rejected', 'edit', 'reschedule')),
  decided_by text,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_approvals_target on public.approvals (target_table, target_id);
create index if not exists idx_approvals_open on public.approvals (requested_at desc) where decision is null;
create unique index if not exists idx_approvals_callback on public.approvals (callback_id) where callback_id is not null;

-- ---------------------------------------------------------------------------
-- health_checks: beats from EzyAi, ops bot, scheduler, PC worker, pollers (§9.M)
-- ---------------------------------------------------------------------------
create table if not exists public.health_checks (
  id bigint generated always as identity primary key,
  component text not null,                -- ezyai | ops_bot | scheduler | pc_worker | poller:<name> | sales_bot
  status text not null default 'ok' check (status in ('ok', 'warn', 'fail')),
  detail jsonb,
  beat_at timestamptz not null default now()
);
create index if not exists idx_health_component on public.health_checks (component, beat_at desc);

-- ---------------------------------------------------------------------------
-- alerts: stale beats, stop-if rules, publish failures (§1, §9.D.25)
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- stop_if | health | publish_failed | needs_approval | double_down | milestone
  severity text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  message text not null,
  payload jsonb,
  dedupe_key text,                        -- one open alert per key
  sent_at timestamptz,                    -- when the Telegram alert went out
  acknowledged_by text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_alerts_dedupe on public.alerts (dedupe_key) where dedupe_key is not null and acknowledged_at is null;
create index if not exists idx_alerts_open on public.alerts (created_at desc) where acknowledged_at is null;

-- ---------------------------------------------------------------------------
-- jobs: outbound-only work queue for the PC worker and ABDUL (§7)
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- clip | transcribe | thumbnail | research_batch | backup | telechurn_import | render_scorecard
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed', 'cancelled')),
  priority smallint not null default 5,
  run_after timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  result jsonb,
  error text,
  idempotency_key text,
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_queue on public.jobs (status, priority, run_after) where status in ('queued', 'claimed');
create unique index if not exists idx_jobs_idem on public.jobs (idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- baseline_hours: Week 1 time log (decision 6); time_saved: what TwinOS did instead
-- ---------------------------------------------------------------------------
create table if not exists public.baseline_hours (
  id bigint generated always as identity primary key,
  week_start date not null,
  day date not null,
  task text not null,                     -- map | approvals_dms | recording | tiktok_replies | rotating | ny_session | formatting | scheduling | logging | faq | other
  minutes integer not null check (minutes >= 0),
  note text,
  logged_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now()
);
create index if not exists idx_baseline_week on public.baseline_hours (week_start, task);

create table if not exists public.time_saved (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  action text not null,                   -- drafted | posted | logged | reposted | numbers_pulled | result_reply | moderated
  minutes_saved numeric(6, 1) not null check (minutes_saved >= 0),
  action_log_id bigint references public.action_log (id) on delete set null,
  note text
);
create index if not exists idx_time_saved_at on public.time_saved (occurred_at desc);
