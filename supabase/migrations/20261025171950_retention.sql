-- 20261025000600_retention.sql — three tables grew without a ceiling
-- (action_log 52k rows, health_checks 40k, and request_stats accumulating), and
-- alerts kept every resolved row forever (A5).
--
-- One function, four windows, no constants:
--
--   action_log_days        90   the audit trail — long enough to answer "who
--                               changed this" for a quarter
--   health_checks_days     30   beats are a liveness signal, not a history
--   alerts_resolved_days   90   an open alert is never touched, however old
--   request_stats_days     30   a route with no traffic in a month is gone; a
--                               request recreates its row on the next upsert
--
-- A window of 0 means "keep forever" and is honoured: a project that wants the
-- whole audit trail sets 0 and nothing is deleted.
--
-- The delete is batched (5 000 rows per statement, looped) so a first run on a
-- big table never holds one long lock. It runs weekly rather than nightly
-- because the goal is a ceiling, not a real-time archive.
--
-- request_stats has one row per (route, class) with no time dimension — it is
-- an aggregate, not a log. Its window therefore means "this route has been
-- silent for longer than the window", which is the only reading that does not
-- throw away a counter that is still moving.

-- ---------------------------------------------------------------------------
-- The windows, as settings, so they are visible and changeable without a
-- migration. `on conflict do nothing` keeps a value Jack has already set.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, description, needs_confirm) values
  ('action_log_days', '90',
   'A5 retention: days of action_log to keep. 0 keeps everything. Pruned weekly by twinos_prune().', false),
  ('health_checks_days', '30',
   'A5 retention: days of health_checks beats to keep. 0 keeps everything.', false),
  ('alerts_resolved_days', '90',
   'A5 retention: days to keep an acknowledged alert. Open alerts are never pruned. 0 keeps everything.', false),
  ('request_stats_days', '30',
   'A5 retention: drop a request_stats row once its route has been silent this many days. 0 keeps everything.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A window is a number in a jsonb column. A value someone typed as "90 days"
-- must fall back to the default, not abort the whole weekly run with a cast
-- error, so the read is defensive and returns the default on anything else.
-- ---------------------------------------------------------------------------
create or replace function public.setting_days(p_key text, p_default int)
returns int
language sql
stable
as $$
  select case
           when t.v ~ '^\s*\d+\s*$' then btrim(t.v)::int
           else p_default
         end
    from (select coalesce(public.setting_text(p_key), '') as v) t;
$$;

comment on function public.setting_days(text, int) is
  'Reads a *_days retention window; a missing or non-numeric value reads as the default instead of aborting the prune.';

-- ---------------------------------------------------------------------------
-- twinos_prune(): idempotent, batched, and honest about what it did.
-- ---------------------------------------------------------------------------
create or replace function public.twinos_prune()
returns table (tbl text, deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch constant int := 5000;
  v_days int;
  v_cut timestamptz;
  v_n bigint;
  v_total bigint := 0;
begin
  -- action_log -----------------------------------------------------------------
  v_days := public.setting_days('action_log_days', 90);
  tbl := 'action_log';
  deleted := 0;
  if v_days > 0 then
    v_cut := now() - make_interval(days => v_days);
    loop
      delete from public.action_log
       where ctid = any (array (
         select ctid from public.action_log where created_at < v_cut limit v_batch));
      get diagnostics v_n = row_count;
      exit when v_n = 0;
      deleted := deleted + v_n;
    end loop;
  end if;
  v_total := v_total + deleted;
  return next;

  -- health_checks --------------------------------------------------------------
  v_days := public.setting_days('health_checks_days', 30);
  tbl := 'health_checks';
  deleted := 0;
  if v_days > 0 then
    v_cut := now() - make_interval(days => v_days);
    loop
      delete from public.health_checks
       where ctid = any (array (
         select ctid from public.health_checks where beat_at < v_cut limit v_batch));
      get diagnostics v_n = row_count;
      exit when v_n = 0;
      deleted := deleted + v_n;
    end loop;
  end if;
  v_total := v_total + deleted;
  return next;

  -- alerts: acknowledged only. An open alert of any age stays until someone
  -- deals with it, because a pruned open alert is a silent outage.
  v_days := public.setting_days('alerts_resolved_days', 90);
  tbl := 'alerts';
  deleted := 0;
  if v_days > 0 then
    v_cut := now() - make_interval(days => v_days);
    loop
      delete from public.alerts
       where ctid = any (array (
         select ctid from public.alerts
          where acknowledged_at is not null and acknowledged_at < v_cut
          limit v_batch));
      get diagnostics v_n = row_count;
      exit when v_n = 0;
      deleted := deleted + v_n;
    end loop;
  end if;
  v_total := v_total + deleted;
  return next;

  -- request_stats --------------------------------------------------------------
  v_days := public.setting_days('request_stats_days', 30);
  tbl := 'request_stats';
  deleted := 0;
  if v_days > 0 then
    v_cut := now() - make_interval(days => v_days);
    loop
      delete from public.request_stats
       where ctid = any (array (
         select ctid from public.request_stats where updated_at < v_cut limit v_batch));
      get diagnostics v_n = row_count;
      exit when v_n = 0;
      deleted := deleted + v_n;
    end loop;
  end if;
  v_total := v_total + deleted;
  return next;

  -- One audit row per run: how much the ceiling took, and nothing else.
  insert into public.action_log (actor, action, target_table, payload)
  values ('cron', 'retention.prune', 'action_log',
          jsonb_build_object('deleted_total', v_total, 'batch', v_batch));
end;
$$;

comment on function public.twinos_prune() is
  'Weekly retention: deletes past each *_days setting (0 = keep forever), batched so a first run never holds a long lock, and logs one action_log row per run.';

revoke all on function public.twinos_prune() from public;
revoke all on function public.twinos_prune() from anon, authenticated;
grant execute on function public.twinos_prune() to service_role;

-- ---------------------------------------------------------------------------
-- Schedule it weekly, through the same guarded pattern every other schedule
-- uses: no bare cron.schedule, no failure when pg_cron is absent (CI, vanilla
-- Postgres). Sunday 19:00 UTC = Monday 03:00 MYT, the quietest hour.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      if not exists (select 1 from cron.job where jobname = 'twinos-retention') then
        perform cron.schedule('twinos-retention', '0 19 * * 0', 'select public.twinos_prune()');
      end if;
    exception when others then
      raise notice 'could not schedule twinos-retention (%): run it by hand', sqlerrm;
    end;
  else
    raise notice 'pg_cron not installed here: schedule select public.twinos_prune() weekly on Supabase';
  end if;
end $$;
