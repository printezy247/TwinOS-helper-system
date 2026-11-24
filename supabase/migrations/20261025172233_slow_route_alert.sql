-- 20261026000200_slow_route_alert.sql — a slow route raises exactly one
-- open alert while it is slow and resolves itself when it recovers (C3).
--
-- Honest measure: request_stats keeps rolling (route, class) aggregates
-- pruned after 24 h, so a true 15-minute p95 is NOT computable from these
-- rows — that would need a latency histogram. What this rule can honestly
-- judge: routes with traffic in the last 15 minutes, by their rolling
-- average (ms_sum / count). The average is labelled as such in the alert
-- payload so nobody reads it as a percentile.
--
-- Dedupe follows the `thr:` pattern of 20261024000200_threshold_alerts:
-- one open alert per route (dedupe_key + open check + the unique partial
-- index on alerts), so the repeated tick fires once and never storms.

-- The threshold is a setting, not a constant, so Jack can retune without a
-- migration. 1500 ms is the plan's number.
insert into public.settings (key, value, description, needs_confirm)
select 'slow_route_alert_ms', '1500'::jsonb,
       'Rolling-average ms a route may exceed before a slow-route alert opens (C3).',
       false
where not exists (select 1 from public.settings where key = 'slow_route_alert_ms');

create or replace function public.twinos_slow_route_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ms       numeric;
  v_route    text;
  v_avg      numeric;
  v_count    bigint;
  v_max      bigint;
begin
  select coalesce((value #>> '{}')::numeric, 1500) into v_ms
    from settings where key = 'slow_route_alert_ms';

  -- Routes slow right now: traffic in the last 15 minutes, rolling average
  -- over the threshold. One row per route (classes summed).
  for v_route, v_avg, v_count, v_max in
    select route,
           sum(ms_sum)::numeric / nullif(sum(count), 0),
           sum(count),
           max(ms_max)
      from request_stats
     where updated_at > now() - interval '15 minutes'
     group by route
    having sum(ms_sum)::numeric / nullif(sum(count), 0) > v_ms
  loop
    if not exists (
      select 1 from alerts
       where dedupe_key = 'thr:slow_route:' || v_route and resolved_at is null
    ) then
      insert into alerts (kind, severity, message, payload, dedupe_key)
      values (
        'threshold', 'medium',
        format('route %s is slow: %s ms rolling average over %s requests',
               v_route, round(v_avg), v_count),
        jsonb_build_object(
          'route', v_route,
          'avg_ms', round(v_avg),
          'requests', v_count,
          'worst_ms', v_max,
          'threshold_ms', v_ms,
          -- Named exactly so a reader cannot mistake it for a percentile.
          'measure', 'rolling avg (24h aggregates, 15m traffic gate)'
        ),
        'thr:slow_route:' || v_route
      );
    end if;
  end loop;

  -- Everything that is no longer slow gets resolved automatically.
  update alerts
     set resolved_at = now()
   where dedupe_key like 'thr:slow_route:%'
     and resolved_at is null
     and replace(dedupe_key, 'thr:slow_route:', '') not in (
       select route
         from request_stats
        where updated_at > now() - interval '15 minutes'
        group by route
       having sum(ms_sum)::numeric / nullif(sum(count), 0) > v_ms
     );
end;
$$;

comment on function public.twinos_slow_route_alerts() is
  'C3: one open slow-route alert per route by rolling average; auto-resolves on recovery.';

revoke all on function public.twinos_slow_route_alerts() from public;
grant execute on function public.twinos_slow_route_alerts() to postgres;

-- Same guarded-cron pattern as 20261024000200: absent pg_cron (vanilla
-- Postgres in CI) degrades to a notice, never an error.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-slow-route-alerts') then
      perform cron.unschedule('twinos-slow-route-alerts');
    end if;
    perform cron.schedule(
      'twinos-slow-route-alerts',
      '*/5 * * * *',
      $cron$select public.twinos_slow_route_alerts()$cron$
    );
    raise notice 'scheduled twinos-slow-route-alerts (every 5 minutes)';
  else
    raise notice 'pg_cron not available here: schedule twinos-slow-route-alerts on Supabase';
  end if;
end $$;
