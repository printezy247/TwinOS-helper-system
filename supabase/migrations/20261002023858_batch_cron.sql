-- 0020_batch_cron.sql — the Wednesday batch and the Thursday sweep (plan §9.C.18).
--
--   Wed 14:30 MYT  content/batch        next week's 7 lessons, audit, poll and offer as
--                                       numbered drafts, one numbered list in the Desk
--   Thu 09:00 MYT  content/batch-sweep  queue anything approved but unscheduled, nudge
--                                       the Desk about what still waits
--
-- pg_cron runs in UTC; MYT = UTC+8, so 14:30 MYT is 06:30 UTC and 09:00 MYT is 01:00 UTC.
-- Both routes are once-per-period (idempotency key = the Monday / the MYT day), so a
-- retried or doubled call changes nothing.
--
-- pg_cron is absent on a vanilla Postgres (CI): the schedules degrade to a notice.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-wednesday-batch') then
      perform cron.unschedule('twinos-wednesday-batch');
    end if;
    if exists (select 1 from cron.job where jobname = 'twinos-thursday-sweep') then
      perform cron.unschedule('twinos-thursday-sweep');
    end if;
    perform cron.schedule(
      'twinos-wednesday-batch',
      '30 6 * * 3',
      $cron$select public.twinos_cron_call('content/batch')$cron$
    );
    perform cron.schedule(
      'twinos-thursday-sweep',
      '0 1 * * 4',
      $cron$select public.twinos_cron_call('content/batch-sweep')$cron$
    );
    raise notice 'scheduled twinos-wednesday-batch (Wed 14:30 MYT) and twinos-thursday-sweep (Thu 09:00 MYT)';
  else
    raise notice 'pg_cron not available here: schedule the batch and the sweep on Supabase';
  end if;
end $$;
