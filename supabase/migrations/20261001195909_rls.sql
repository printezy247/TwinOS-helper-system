-- 0009_rls.sql — row-level security on every table (§9.A.1, §9.B.9).
-- Roles come from the JWT claim `twinos_role`:
--   jack       full access
--   abdul      read all; insert/update content while draft/pending_approval;
--              insert jobs, queries, csi_captures, manual_metrics, approvals
--              (requests), compliance_checks, briefs, exemplars, time logs,
--              alerts and health beats
--   cron       like abdul, plus publish_jobs and channel_daily
--   ops_bot    insert member_events, moderation_events, post_snapshots, tg_posts,
--              signal_posts, invite_links, channel_daily; update publish_jobs and
--              tg_posts; reads only what it needs
--   ezyai      insert/upsert signals and signal_outcomes only
--   pc_worker  select/update jobs; insert assets, post_metrics, telechurn_imports,
--              queries, topic_clusters; reads only what it needs
--   dashboard  read all (writes go through RPC / Edge Functions)
--   anon       only v_results_board
-- The service role bypasses RLS as usual.

-- Helper used only inside this migration, dropped at the end.
create or replace function public.twinos_define_policy(
  p_table text, p_name text, p_cmd text, p_roles text[], p_using text, p_check text default null
)
returns void
language plpgsql
as $$
declare
  v_roles text := '(' || (select string_agg(quote_literal(r), ',') from unnest(p_roles) r) || ')';
  v_using text := replace(coalesce(p_using, 'true'), '$ROLES', v_roles);
  v_check text := replace(coalesce(p_check, p_using, 'true'), '$ROLES', v_roles);
  v_sql text;
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  v_sql := format('create policy %I on public.%I for %s to authenticated', p_name, p_table, p_cmd);
  if p_cmd in ('select', 'delete') then
    v_sql := v_sql || format(' using (%s)', v_using);
  elsif p_cmd = 'insert' then
    v_sql := v_sql || format(' with check (%s)', v_check);
  else
    v_sql := v_sql || format(' using (%s) with check (%s)', v_using, v_check);
  end if;
  execute v_sql;
end;
$$;

do $$
declare
  all_tables text[] := array[
    'settings', 'brand_facts', 'products', 'personas', 'action_log', 'approvals', 'health_checks', 'alerts',
    'jobs', 'baseline_hours', 'time_saved',
    'templates', 'style_guide', 'hooks', 'calendar_slots', 'live_runsheets', 'content_items', 'content_variants',
    'assets', 'publish_jobs', 'platform_accounts', 'compliance_checks',
    'signals', 'signal_outcomes', 'signal_posts',
    'invite_links', 'member_events', 'memberships', 'channel_daily', 'tg_posts', 'post_snapshots',
    'telechurn_imports', 'bot_start_tags', 'mod_rules', 'moderation_events',
    'post_metrics', 'manual_metrics', 'inbox_items',
    'queries', 'topic_clusters', 'briefs', 'csi_captures', 'benchmarks', 'exemplars'
  ];
  t text;
  r text := 'public.twinos_role()';
begin
  -- 1. RLS on, jack full, readers (abdul, dashboard, cron) select
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    perform public.twinos_define_policy(t, 'jack_all', 'all', array['jack'], r || ' = ''jack''');
    perform public.twinos_define_policy(t, 'readers_select', 'select', array['abdul', 'dashboard', 'cron'], r || ' in $ROLES');
  end loop;

  -- 2. health beats and alerts from every worker
  perform public.twinos_define_policy('health_checks', 'workers_insert', 'insert',
    array['abdul', 'ops_bot', 'cron', 'ezyai', 'pc_worker', 'dashboard'], r || ' in $ROLES');
  perform public.twinos_define_policy('alerts', 'workers_insert', 'insert',
    array['abdul', 'ops_bot', 'cron', 'pc_worker'], r || ' in $ROLES');

  -- 3. abdul + cron: content while draft / pending_approval
  perform public.twinos_define_policy('content_items', 'desk_insert', 'insert', array['abdul', 'cron'], r || ' in $ROLES');
  perform public.twinos_define_policy('content_items', 'desk_update', 'update', array['abdul', 'cron'],
    r || ' in $ROLES and not exists (select 1 from public.content_variants v where v.item_id = content_items.id and v.status not in (''draft'', ''pending_approval''))');
  perform public.twinos_define_policy('content_variants', 'desk_insert', 'insert', array['abdul', 'cron'],
    r || ' in $ROLES and status in (''draft'', ''pending_approval'')');
  perform public.twinos_define_policy('content_variants', 'desk_update', 'update', array['abdul', 'cron'],
    r || ' in $ROLES and status in (''draft'', ''pending_approval'')',
    r || ' in $ROLES and status in (''draft'', ''pending_approval'')');
  foreach t in array array['jobs', 'queries', 'csi_captures', 'manual_metrics', 'approvals', 'compliance_checks', 'briefs', 'exemplars', 'time_saved', 'baseline_hours'] loop
    perform public.twinos_define_policy(t, 'desk_insert', 'insert', array['abdul', 'cron'], r || ' in $ROLES');
  end loop;
  perform public.twinos_define_policy('briefs', 'desk_update', 'update', array['abdul', 'cron'], r || ' in $ROLES');
  perform public.twinos_define_policy('channel_daily', 'cron_insert', 'insert', array['cron', 'ops_bot'], r || ' in $ROLES');

  -- 4. cron: publish_jobs
  perform public.twinos_define_policy('publish_jobs', 'cron_insert', 'insert', array['cron'], r || ' = ''cron''');
  perform public.twinos_define_policy('publish_jobs', 'cron_update', 'update', array['cron'], r || ' = ''cron''');

  -- 5. ops_bot: Telegram events in, publish_jobs status back, reads it needs
  foreach t in array array['member_events', 'moderation_events', 'post_snapshots', 'tg_posts', 'signal_posts', 'invite_links'] loop
    perform public.twinos_define_policy(t, 'ops_bot_insert', 'insert', array['ops_bot'], r || ' = ''ops_bot''');
  end loop;
  perform public.twinos_define_policy('publish_jobs', 'ops_bot_update', 'update', array['ops_bot'], r || ' = ''ops_bot''');
  perform public.twinos_define_policy('tg_posts', 'ops_bot_update', 'update', array['ops_bot'], r || ' = ''ops_bot''');
  foreach t in array array['settings', 'mod_rules', 'invite_links', 'publish_jobs', 'content_variants', 'content_items', 'tg_posts', 'signal_posts', 'member_events', 'approvals', 'brand_facts', 'templates'] loop
    perform public.twinos_define_policy(t, 'ops_bot_select', 'select', array['ops_bot'], r || ' = ''ops_bot''');
  end loop;

  -- 6. ezyai: signals and outcomes only (upsert needs select + update on the conflict row)
  foreach t in array array['signals', 'signal_outcomes'] loop
    perform public.twinos_define_policy(t, 'ezyai_select', 'select', array['ezyai'], r || ' = ''ezyai''');
    perform public.twinos_define_policy(t, 'ezyai_insert', 'insert', array['ezyai'], r || ' = ''ezyai''');
    perform public.twinos_define_policy(t, 'ezyai_update', 'update', array['ezyai'], r || ' = ''ezyai''');
  end loop;

  -- 7. pc_worker: jobs in/out, assets, metrics, imports, research
  perform public.twinos_define_policy('jobs', 'pc_worker_select', 'select', array['pc_worker'], r || ' = ''pc_worker''');
  perform public.twinos_define_policy('jobs', 'pc_worker_update', 'update', array['pc_worker'],
    r || ' = ''pc_worker'' and status in (''queued'', ''claimed'')',
    r || ' = ''pc_worker''');
  foreach t in array array['assets', 'post_metrics', 'telechurn_imports', 'queries', 'topic_clusters'] loop
    perform public.twinos_define_policy(t, 'pc_worker_insert', 'insert', array['pc_worker'], r || ' = ''pc_worker''');
  end loop;
  perform public.twinos_define_policy('topic_clusters', 'pc_worker_update', 'update', array['pc_worker'],
    r || ' = ''pc_worker'' and created_by = ''pc_worker''');
  foreach t in array array['settings', 'assets', 'queries', 'topic_clusters', 'personas', 'benchmarks', 'exemplars', 'content_items', 'content_variants', 'post_metrics'] loop
    perform public.twinos_define_policy(t, 'pc_worker_select', 'select', array['pc_worker'], r || ' = ''pc_worker''');
  end loop;
end $$;

drop function if exists public.twinos_define_policy(text, text, text, text[], text, text);

-- ---------------------------------------------------------------------------
-- Grants. RLS decides row access; these decide who may even try.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- anon: the public board and the helpers it needs
grant select on public.v_results_board to anon;
grant execute on function public.twinos_claims() to anon;
grant execute on function public.twinos_role() to anon;
grant execute on function public.twinos_actor() to anon;
grant execute on function public.outcome_class(text, numeric) to anon;
grant execute on function public.strict_win_rate(bigint, bigint) to anon;
grant execute on function public.results_stats(timestamptz, timestamptz) to anon;  -- security definer, aggregates only

-- The security-definer trigger functions must never be callable directly.
revoke execute on function public.trg_action_log() from public, anon, authenticated;
revoke execute on function public.trg_fold_member_event() from public, anon, authenticated;
