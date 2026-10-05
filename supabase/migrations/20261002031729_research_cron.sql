-- 0024_research_cron.sql — the weekly research run and the Monday brief (Phase 5).
--
--   Sun 20:00 UTC (Mon 04:00 MYT)  research/expand  every persona's seed questions through autocomplete,
--                                                    scored into topic_clusters
--   Sun 23:00 UTC (Mon 07:00 MYT)  research/brief   next week's calendar slots with the best fitting topics,
--                                                    saved in briefs and sent to the Desk
--
-- pg_cron is absent on a vanilla Postgres (CI): the schedules degrade to a notice.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-research-expand') then
      perform cron.unschedule('twinos-research-expand');
    end if;
    if exists (select 1 from cron.job where jobname = 'twinos-monday-brief') then
      perform cron.unschedule('twinos-monday-brief');
    end if;
    perform cron.schedule('twinos-research-expand', '0 20 * * 0', $cron$select public.twinos_cron_call('research/expand')$cron$);
    perform cron.schedule('twinos-monday-brief', '0 23 * * 0', $cron$select public.twinos_cron_call('research/brief')$cron$);
    raise notice 'scheduled twinos-research-expand (Mon 04:00 MYT) and twinos-monday-brief (Mon 07:00 MYT)';
  else
    raise notice 'pg_cron not available here: schedule the research run and the Monday brief on Supabase';
  end if;
end $$;
