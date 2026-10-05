-- 0023_metrics_cron.sql — channel snapshots and the weekly benchmark refresh (Phase 4).
--
--   every 15 min   metrics/snapshots   views of our posts about 1 h / 24 h / 7 d after they went out
--   Mon 03:00 MYT  metrics/benchmarks  reference channels: size, average views, view rate, rhythm
--
-- pg_cron runs in UTC; MYT = UTC+8, so Monday 03:00 MYT is Sunday 19:00 UTC.
-- pg_cron is absent on a vanilla Postgres (CI): the schedules degrade to a notice.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-snapshots') then
      perform cron.unschedule('twinos-snapshots');
    end if;
    if exists (select 1 from cron.job where jobname = 'twinos-benchmarks') then
      perform cron.unschedule('twinos-benchmarks');
    end if;
    perform cron.schedule('twinos-snapshots', '*/15 * * * *', $cron$select public.twinos_cron_call('metrics/snapshots')$cron$);
    perform cron.schedule('twinos-benchmarks', '0 19 * * 0', $cron$select public.twinos_cron_call('metrics/benchmarks')$cron$);
    raise notice 'scheduled twinos-snapshots (every 15 min) and twinos-benchmarks (Mon 03:00 MYT)';
  else
    raise notice 'pg_cron not available here: schedule the snapshots and the benchmark refresh on Supabase';
  end if;
end $$;
