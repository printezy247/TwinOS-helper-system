-- 0018_results_tick.sql — the clock that posts queued result replies.
--
-- signals-ingest queues a `result_reply` job when a live signal closes
-- (plan §9.D.23). Nothing consumed those jobs: `jobs/index.ts` says the kind is
-- "handled by cron, not the PC", and no cron route drained it, so a result
-- never posted by itself (Phase 1 exit, plan §13). `results/run` is that route;
-- this schedules it.
--
-- The claim inside results/run is an atomic UPDATE … WHERE status='queued', so
-- overlapping ticks can never post the same result twice.
--
-- pg_cron is absent on a vanilla Postgres (CI), so the schedule degrades to a
-- notice and the migration still applies.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-results') then
      perform cron.unschedule('twinos-results');
    end if;
    perform cron.schedule(
      'twinos-results',
      '* * * * *',
      $cron$select public.twinos_cron_call('results/run')$cron$
    );
    raise notice 'scheduled twinos-results: every minute -> results/run';
  else
    raise notice 'pg_cron not available here: schedule twinos-results on Supabase';
  end if;
end $$;
