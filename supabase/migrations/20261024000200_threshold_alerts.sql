-- 20261024000200_threshold_alerts.sql — the three alerting rules from
-- UPGRADE-PHASES Phase 4, evaluated every minute by pg_cron.
--
-- Why pg_cron and not Database Webhooks: webhooks fire per-row and live only
-- in the dashboard (not versionable, not reviewable). All three conditions are
-- thresholds over a window, which is a poll, and the repo already runs pg_cron
-- for snapshots/benchmarks. The rows land in `alerts`, which the dashboard
-- already renders with realtime delivery and Desk escalation.
--
-- Rules:
--   1. >5 publish_jobs failed within the last minute  → high
--   2. >10 alerts open at once                       → medium   (yes: an
--      alert about alert flood — deduped so it can never storm)
--   3. >3 health beat sources stale                  → medium
--
-- Every rule auto-resolves its alert when the condition clears, and while a
-- condition is tripped the row stays single (dedupe_key + open check), so the
-- minute tick can never duplicate or storm.
create or replace function public.twinos_threshold_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  global_hours numeric;
  stale_n integer;
begin
  ------------------------------------------------------------ 1. failed burst
  select count(*) into n
    from publish_jobs
   where status = 'failed'
     and updated_at > now() - interval '1 minute';

  if n > 5 then
    if not exists (
      select 1 from alerts
       where dedupe_key = 'thr:failed_jobs_burst' and resolved_at is null
    ) then
      insert into alerts (kind, severity, message, payload, dedupe_key)
      values (
        'threshold', 'high',
        format('%s publish jobs failed in the last minute', n),
        jsonb_build_object('count', n, 'window', '1m'),
        'thr:failed_jobs_burst'
      );
    end if;
  else
    update alerts set resolved_at = now()
     where dedupe_key = 'thr:failed_jobs_burst' and resolved_at is null;
  end if;

  ------------------------------------------------------- 2. open alert flood
  select count(*) into n from alerts where resolved_at is null;

  if n > 10 then
    if not exists (
      select 1 from alerts
       where dedupe_key = 'thr:alerts_flood' and resolved_at is null
    ) then
      insert into alerts (kind, severity, message, payload, dedupe_key)
      values (
        'threshold', 'medium',
        format('%s alerts open at once — something is looping', n),
        jsonb_build_object('open', n),
        'thr:alerts_flood'
      );
    end if;
  else
    update alerts set resolved_at = now()
     where dedupe_key = 'thr:alerts_flood' and resolved_at is null;
  end if;

  ---------------------------------------------------------- 3. stale beats
  -- Same decision chain as health/index.ts latestBeats(): per-source minutes
  -- win; else the global hours setting; else that source's default. Sources
  -- that have never beaten ("never") are excluded, matching POST /health/check.
  select coalesce((s.value #>> '{}')::numeric, 0) into global_hours
    from settings s where s.key = 'health_stale_threshold_hours';

  with latest as (
    select distinct on (source) source, at
      from health_checks
     where source in ('ezyai', 'ops_bot', 'scheduler', 'pc_worker', 'poller', 'abdul', 'sales_bot')
     order by source, at desc
  ), evaluated as (
    select l.source,
           (extract(epoch from (now() - l.at)) / 60.0) >
             coalesce(
               (select (s2.value #>> '{}')::numeric
                  from settings s2 where s2.key = 'health_stale_' || l.source),
               case
                 when coalesce(global_hours, 0) > 0 then global_hours * 60
                 else case l.source
                   when 'ezyai' then 30
                   when 'scheduler' then 5
                   when 'pc_worker' then 20
                   when 'poller' then 30
                   else 1440
                 end
               end
             ) as is_stale
      from latest l
  )
  select count(*) into stale_n from evaluated where is_stale;

  if stale_n > 3 then
    if not exists (
      select 1 from alerts
       where dedupe_key = 'thr:stale_beats' and resolved_at is null
    ) then
      insert into alerts (kind, severity, message, payload, dedupe_key)
      values (
        'threshold', 'medium',
        format('%s health beat sources are stale', stale_n),
        jsonb_build_object('stale', stale_n),
        'thr:stale_beats'
      );
    end if;
  else
    update alerts set resolved_at = now()
     where dedupe_key = 'thr:stale_beats' and resolved_at is null;
  end if;
end;
$$;

revoke all on function public.twinos_threshold_alerts() from public;
grant execute on function public.twinos_threshold_alerts() to postgres;

-- Every minute = "alert fires within 60s of condition" from the plan.
-- cron.schedule with a fixed job name replaces on re-run.
select cron.schedule(
  'twinos-threshold-alerts',
  '* * * * *',
  $$select public.twinos_threshold_alerts()$$
);

-- GET /health/check verifies the realtime publication is intact. Edge
-- functions talk through the PostgREST client, which cannot run arbitrary
-- SQL, so the count is a function.
create or replace function public.twinos_realtime_publication_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from pg_publication_tables
   where pubname = 'supabase_realtime';
$$;

revoke all on function public.twinos_realtime_publication_count() from public;
grant execute on function public.twinos_realtime_publication_count() to service_role;
