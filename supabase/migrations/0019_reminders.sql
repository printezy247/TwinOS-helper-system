-- 0019_reminders.sql — the 07:40 and 19:55 MYT Desk nudges.
--
-- Both routes are once-per-day and only fire when nothing arrived that day
-- (content/remind-map, content/remind-wrap). pg_cron runs in UTC; MYT = UTC+8,
-- so 07:40 MYT Mon-Fri is 23:40 UTC Sun-Thu and 19:55 MYT Mon-Fri is 11:55 UTC
-- Mon-Fri.
--
-- pg_cron is absent on a vanilla Postgres (CI), so the schedules degrade to a
-- notice and the migration still applies.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-map-reminder') then
      perform cron.unschedule('twinos-map-reminder');
    end if;
    if exists (select 1 from cron.job where jobname = 'twinos-evening-reminder') then
      perform cron.unschedule('twinos-evening-reminder');
    end if;
    perform cron.schedule(
      'twinos-map-reminder',
      '40 23 * * 0-4',
      $cron$select public.twinos_cron_call('content/remind-map')$cron$
    );
    perform cron.schedule(
      'twinos-evening-reminder',
      '55 11 * * 1-5',
      $cron$select public.twinos_cron_call('content/remind-wrap')$cron$
    );
    raise notice 'scheduled twinos-map-reminder (07:40 MYT) and twinos-evening-reminder (19:55 MYT)';
  else
    raise notice 'pg_cron not available here: schedule the two reminders on Supabase';
  end if;
end $$;
