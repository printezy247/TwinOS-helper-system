-- 20261026000500_slow_route_health_exempt.sql — the health deep probe is
-- slow on purpose, so the slow-route alert (C3) must ignore it.
--
-- Why: POST /health/check is the cron deep probe: it awaits live provider
-- calls (OpenRouter, Telegram, storage) with 4 s timeouts each, so a ~3 s
-- rolling average over hundreds of requests is the design, not a defect.
-- Alerting on it produced a permanent medium alert that could never
-- auto-resolve — noise that trains people to ignore alerts.
--
-- The exemption covers both methods of the probe (GET is the manual button,
-- POST the cron beat): any route ending in `/health/check`. Everything else,
-- including GET /health/today (fast DB reads), keeps alerting normally.
--
-- Side effect wanted: an alert opened before this exemption resolves on the
-- next tick, because the resolve step's slow-set excludes the route too.

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
  -- over the threshold. One row per route (classes summed). The health deep
  -- probe is exempt — slow by design (live provider calls).
  for v_route, v_avg, v_count, v_max in
    select route,
           sum(ms_sum)::numeric / nullif(sum(count), 0),
           sum(count),
           max(ms_max)
      from request_stats
     where updated_at > now() - interval '15 minutes'
       and route not like '%/health/check'
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

  -- Everything that is no longer slow — and the exempt health probe, which
  -- is never in the set below — gets resolved automatically.
  update alerts
     set resolved_at = now()
   where dedupe_key like 'thr:slow_route:%'
     and resolved_at is null
     and replace(dedupe_key, 'thr:slow_route:', '') not in (
       select route
         from request_stats
        where updated_at > now() - interval '15 minutes'
          and route not like '%/health/check'
        group by route
        having sum(ms_sum)::numeric / nullif(sum(count), 0) > v_ms
     );
end;
$$;

comment on function public.twinos_slow_route_alerts() is
  'C3: one open slow-route alert per route by rolling average; auto-resolves on recovery; /health/check exempt (slow by design).';

revoke all on function public.twinos_slow_route_alerts() from public;
grant execute on function public.twinos_slow_route_alerts() to postgres;
