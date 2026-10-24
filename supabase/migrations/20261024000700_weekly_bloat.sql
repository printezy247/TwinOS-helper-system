-- 20261024000700_weekly_bloat.sql — Quick Win 3: catch table bloat early.
--
-- The plan asked for `supabase inspect db bloat --linked` on a weekly cron.
-- That command is a CLI wrapper over pg_stat_user_tables, and putting a
-- weekly job in GitHub Actions would mean parking an account-wide Supabase
-- PAT in repo secrets just to print a table. So the same read runs where the
-- repo's other weekly work already runs — pg_cron, through the guarded
-- schedule pattern every other schedule here uses — and the answer lands in
-- `action_log` (one snapshot row per week, visible in Activity) plus an
-- `alerts` row when a table is actually in trouble.
--
-- Ad-hoc, from any terminal linked to the project:
--   supabase inspect db bloat --linked
--
-- Threshold: a table at ≥40% dead with ≥10k dead tuples should have been
-- caught by autovacuum; when it is not, that is worth a Dashboard alert.

create or replace function public.twinos_weekly_bloat()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top jsonb;
  v_bad text[];
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_top
    from (
      select relname,
             n_live_tup,
             n_dead_tup,
             round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 1) as dead_pct
        from pg_stat_user_tables
       where n_dead_tup >= 1000
       order by n_dead_tup desc
       limit 10
    ) x;

  -- The weekly snapshot itself: every week leaves one trace, bloat or not.
  insert into public.action_log (actor, action, target_table, payload)
  values ('cron', 'bloat.weekly', 'pg_stat_user_tables', jsonb_build_object('tables', v_top));

  select array_agg(x.relname) into v_bad
    from (
      select relname,
             n_dead_tup,
             round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 1) as dead_pct
        from pg_stat_user_tables
       where n_dead_tup >= 10000
         and 100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1) >= 40
    ) x;

  if v_bad is not null and not exists (
    select 1 from public.alerts
     where dedupe_key = 'thr:table_bloat' and resolved_at is null
  ) then
    insert into public.alerts (kind, severity, message, payload, dedupe_key)
    values (
      'threshold', 'medium',
      format('%s — tables ≥40%% dead; autovacuum is behind', array_to_string(v_bad, ', ')),
      jsonb_build_object('tables', to_jsonb(v_bad)),
      'thr:table_bloat'
    );
  end if;
end;
$$;

comment on function public.twinos_weekly_bloat() is
  'Quick Win 3: weekly bloat snapshot into action_log + an alert when a big table is >=40% dead. Manual equivalent: supabase inspect db bloat --linked.';

-- pg_cron is absent on a vanilla Postgres (CI): degrades to a notice, same
-- pattern as 20261024000200_threshold_alerts.sql. Sundays 02:00 UTC =
-- 10:00 MYT.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-weekly-bloat') then
      perform cron.unschedule('twinos-weekly-bloat');
    end if;
    perform cron.schedule(
      'twinos-weekly-bloat',
      '0 2 * * 0',
      $cron$select public.twinos_weekly_bloat()$cron$
    );
    raise notice 'scheduled twinos-weekly-bloat (Sundays 02:00 UTC)';
  else
    raise notice 'pg_cron not available here: schedule twinos-weekly-bloat on Supabase';
  end if;
end $$;
