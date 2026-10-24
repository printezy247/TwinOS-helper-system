-- 20261024000300_request_stats.sql — durable, global request metrics.
--
-- Isolate-local counters (the in-memory map in _shared/metrics.ts) looked
-- right in unit tests but were unscrapeable in production: consecutive
-- requests can land on different Edge Function isolates, so GET /health/metrics
-- almost always rendered from a map that had seen nothing. One row per
-- route+status-class, updated with a single atomic UPSERT from every request
-- (fire-and-forget from the function, never on the response's critical path),
-- makes the scrape global regardless of isolate.
--
-- Rows are pruned hourly after 24 h: this is a rolling operational view, not
-- history — the platform's function logs keep the durable record.
create table if not exists public.request_stats (
  route      text        not null,
  cls        text        not null check (cls in ('2xx', '3xx', '4xx', '5xx')),
  count      bigint      not null default 0,
  errors     bigint      not null default 0,
  ms_sum     bigint      not null default 0,
  ms_max     bigint      not null default 0,
  updated_at timestamptz not null default now(),
  primary key (route, cls)
);

-- No policies: the table is closed to anon/authenticated/JWT callers. Only
-- service_role reaches it, through the two functions below (SECURITY DEFINER)
-- and direct reads from the health function's service client.
alter table public.request_stats enable row level security;

create or replace function public.twinos_observe_request(p_route text, p_cls text, p_ms bigint)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.request_stats (route, cls, count, errors, ms_sum, ms_max, updated_at)
  values (
    p_route,
    p_cls,
    1,
    case when p_cls in ('4xx', '5xx') then 1 else 0 end,
    greatest(coalesce(p_ms, 0), 0),
    greatest(coalesce(p_ms, 0), 0),
    now()
  )
  on conflict (route, cls) do update set
    count      = public.request_stats.count + 1,
    errors     = public.request_stats.errors + excluded.errors,
    ms_sum     = public.request_stats.ms_sum + excluded.ms_sum,
    ms_max     = greatest(public.request_stats.ms_max, excluded.ms_max),
    updated_at = now();
$$;

revoke all on function public.twinos_observe_request(text, text, bigint) from public;
grant execute on function public.twinos_observe_request(text, text, bigint) to service_role;

-- Rolling window: keep the last 24 h only.
create or replace function public.twinos_prune_request_stats()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.request_stats where updated_at < now() - interval '24 hours';
$$;

revoke all on function public.twinos_prune_request_stats() from public;
grant execute on function public.twinos_prune_request_stats() to postgres;

-- Rolling window: keep the last 24 h only. pg_cron is absent on a vanilla
-- Postgres (CI): the schedule degrades to a notice — same pattern as
-- 0023_metrics_cron.sql.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-prune-request-stats') then
      perform cron.unschedule('twinos-prune-request-stats');
    end if;
    perform cron.schedule(
      'twinos-prune-request-stats',
      '15 * * * *',
      $cron$select public.twinos_prune_request_stats()$cron$
    );
    raise notice 'scheduled twinos-prune-request-stats (hourly)';
  else
    raise notice 'pg_cron not available here: schedule twinos-prune-request-stats on Supabase';
  end if;
end $$;
