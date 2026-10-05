-- 20261005000001_review_fixes.sql — October 2026 code-review fixes (fix round 1).
--
-- 1. Demo/shadow signals leaked onto the public board: data_source carries a
--    column default ('live'), and PostgreSQL fills defaults BEFORE a BEFORE
--    trigger runs, so the quality → data_source copy in trg_signal_bridge
--    never fired on INSERT and every function-ingested demo signal was stored
--    as data_source='live' — visible to anon on 0013's public board.
-- 2. Result replies could post twice: dedupe keyed on signal_posts.status_posted,
--    which nothing wrote. The functions now claim (signal_id, status_posted)
--    with a null message_id before drafting; that needs nullable chat_id /
--    message_id and a unique partial index, plus a carve-out in the
--    signal-deletion guard for unposted claim rows (posted rows stay
--    undeletable — the ledger promise stands).
-- 3. 'cancelled' becomes the retraction path: a wrong signal can be pulled
--    from the public board by editing its status (deletion stays impossible).
-- 4. member_events: kicked/banned members were folded as 'join'.
-- 5. api_keys mint/rotate/revoke now writes action_log (last_used_at beats
--    are heartbeats, not events).
-- 6. RLS/grant hygiene: jack can read the three zero-policy tables, the
--    reporting views are granted to authenticated, over-broad DML grants are
--    revoked, and the anon ledger gains created_at (v_signal_ledger needs it).
-- 7. Safety-critical cron schedules from 0010's commented examples, with the
--    correct routes (stop-if lives on results, not metrics; member-count has
--    no route and is not scheduled). twinos_cron_call no-ops until
--    settings.edge_base_url + the Vault secret exist, so scheduling early is
--    safe.

-- ===========================================================================
-- 1. Demo/shadow leak: no default, explicit copies, repair the stored rows
-- ===========================================================================
alter table public.signals alter column data_source drop default;

-- Repair: any non-live quality that was flattened to 'live' goes back.
update public.signals set data_source = quality
 where quality in ('demo', 'shadow', 'synthetic') and data_source = 'live';

-- The bridge now copies quality → data_source even when the column arrived
-- pre-filled by the (now removed) default, and keeps NOT NULL satisfiable
-- when a writer sends neither column.
create or replace function public.trg_signal_bridge()
returns trigger
language plpgsql
as $$
begin
  -- function side → EzyAi side
  if new.pair is null and new.symbol is not null then new.pair := upper(new.symbol); end if;
  if new.stop_loss is null and new.stop_price is not null then new.stop_loss := new.stop_price; end if;
  if new.rr_target is null and new.rr is not null then new.rr_target := new.rr; end if;
  if new.r_multiple is null and new.result_r is not null then new.r_multiple := new.result_r; end if;
  if new.signal_at is null and new.opened_at is not null then new.signal_at := new.opened_at; end if;
  if new.resolved_at is null and new.closed_at is not null then new.resolved_at := new.closed_at; end if;
  -- quality is the authority for live-ness: a non-null quality always wins.
  if new.data_source is null and new.quality is not null then new.data_source := new.quality; end if;
  if new.data_source is null then new.data_source := 'live'; end if;
  -- EzyAi side → function side
  if new.symbol is null and new.pair is not null then new.symbol := new.pair; end if;
  if new.stop_price is null and new.stop_loss is not null then new.stop_price := new.stop_loss; end if;
  if new.rr is null and new.rr_target is not null then new.rr := new.rr_target; end if;
  if new.result_r is null and new.r_multiple is not null then new.result_r := new.r_multiple; end if;
  if new.opened_at is null and new.signal_at is not null then new.opened_at := new.signal_at; end if;
  if new.closed_at is null and new.resolved_at is not null then new.closed_at := new.resolved_at; end if;
  if new.quality is null and new.data_source is not null then new.quality := new.data_source; end if;
  return new;
end;
$$;

-- ===========================================================================
-- 2. Result-reply claims: nullable message coordinates + the unique gate
-- ===========================================================================
alter table public.signal_posts alter column chat_id drop not null;
alter table public.signal_posts alter column message_id drop not null;

-- Two replies for the same outcome can never both exist, even when two cron
-- ticks drain duplicate jobs. (chat_id, message_id) unique allows the many
-- (null, null) claim rows — NULLs are distinct in a unique constraint.
create unique index if not exists uq_signal_posts_result_once
  on public.signal_posts (signal_id, status_posted)
  where kind = 'result' and status_posted is not null;

-- The ledger promise stays: a POSTED row (real message id) is never deleted.
-- A claim row (message_id still null) is bookkeeping, not history; the
-- results pipeline releases it when the run fails before the send.
create or replace function public.signal_deletion_guard() returns trigger as $$
begin
  if old.message_id is not null then
    raise exception 'a posted signal is never deleted (edit or annotate instead)';
  end if;
  return null;
end;
$$ language plpgsql;

-- ===========================================================================
-- 3. 'cancelled' leaves every public surface (the retraction path)
-- ===========================================================================
create or replace function public.results_stats(p_since timestamptz default now() - interval '28 days', p_until timestamptz default now())
returns table (
  signals bigint, wins bigint, losses bigint, break_even bigint, open_signals bigint,
  strict_win_rate numeric, total_r numeric, avg_r numeric
)
language sql
stable
set search_path = public
as $$
  with s as (
    select public.outcome_class(status, r_multiple) as cls, r_multiple
    from public.signals
    where signal_at >= p_since and signal_at < p_until
      and data_source = 'live' and status not in ('shadow', 'cancelled')
  )
  select
    count(*)::bigint,
    count(*) filter (where cls = 'win')::bigint,
    count(*) filter (where cls = 'loss')::bigint,
    count(*) filter (where cls = 'be')::bigint,
    count(*) filter (where cls = 'open')::bigint,
    public.strict_win_rate(count(*) filter (where cls = 'win'), count(*) filter (where cls = 'loss')),
    round(coalesce(sum(r_multiple) filter (where cls in ('win', 'loss', 'be')), 0), 2),
    round(avg(r_multiple) filter (where cls in ('win', 'loss', 'be')), 2)
  from s;
$$;

create or replace view public.v_results_board as
with rolling as (
  select * from public.results_stats(now() - interval '28 days', now())
)
select
  s.id, s.external_id, s.source, s.pair, s.direction, s.timeframe, s.style,
  s.entry, s.entry_low, s.entry_high, s.stop_loss, s.tp1, s.tp2, s.rr_target,
  s.counter_trend, s.status,
  public.outcome_class(s.status, s.r_multiple) as outcome_class,
  s.r_multiple, s.exit_price, s.signal_at, s.resolved_at,
  exists (select 1 from public.signal_posts p where p.signal_id = s.id and p.kind in ('signal', 'card')) as posted_to_channel,
  exists (select 1 from public.signal_posts p where p.signal_id = s.id and p.kind = 'result' and p.message_id is not null) as result_posted,
  r.wins as wins_28d, r.losses as losses_28d, r.break_even as break_even_28d,
  r.strict_win_rate as strict_win_rate_28d, r.total_r as total_r_28d
from public.signals s
cross join rolling r
where s.data_source = 'live' and s.status not in ('shadow', 'cancelled')
order by s.signal_at desc;

drop policy if exists anon_public_board on public.signals;
create policy anon_public_board on public.signals for select to anon
  using (data_source = 'live' and status not in ('shadow', 'cancelled'));

-- v_signal_ledger (0032) selects created_at; 0013's column grant omitted it.
grant select (
  id, external_id, source, pair, direction, timeframe, style,
  entry, entry_low, entry_high, stop_loss, tp1, tp2, rr_target,
  counter_trend, status, r_multiple, exit_price, signal_at, resolved_at, data_source, created_at
) on public.signals to anon;

-- ===========================================================================
-- 4. Kicks and bans are leaves, not joins
-- ===========================================================================
create or replace function public.trg_member_event_bridge()
returns trigger
language plpgsql
as $$
begin
  -- either spelling of the timestamp fills the other, so a writer that only
  -- knows one of them still satisfies both NOT NULLs
  if new.at is null and new.occurred_at is not null then new.at := new.occurred_at; end if;
  if new.occurred_at is null and new.at is not null then new.occurred_at := new.at; end if;
  if new.event is null and new.kind is not null then new.event := new.kind; end if;
  -- chat_member / my_chat_member / chat_join_request → the fold vocabulary.
  -- kicked (banned) is a departure: the old else-branch counted bans as joins.
  if new.kind is null then
    new.kind := case
      when new.event = 'chat_join_request' then 'join_request'
      when new.event in ('chat_member', 'my_chat_member')
        then case when new.new_status in ('left', 'kicked') then 'leave' else 'join' end
      when new.event = 'join' then 'join'
      when new.event = 'leave' then 'leave'
      else 'join'
    end;
  end if;
  -- derive the status columns when only the event was given
  if new.new_status is null then
    new.new_status := case
      when new.kind in ('join', 'approved', 'join_request') then 'member'
      when new.kind = 'leave' then 'left'
      else new.kind
    end;
  end if;
  if new.old_status is null then
    new.old_status := case when new.kind in ('join', 'join_request', 'approved') then 'left' else 'member' end;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 5. api_keys lifecycle lands in action_log (mint / rotate / revoke / delete)
-- ===========================================================================
create or replace function public.trg_api_keys_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_payload jsonb;
begin
  if tg_op = 'DELETE' then
    insert into public.action_log (actor, action, target_table, target_id, payload)
    values (public.twinos_actor(), 'delete', 'api_keys', old.id::text,
            jsonb_build_object('old', to_jsonb(old) - 'key_hash'));
    return null;
  end if;
  v_new := to_jsonb(new) - 'key_hash';
  if tg_op = 'UPDATE' then
    -- a last_used_at (and its updated_at companion) beat fires on every keyed
    -- request: that is a heartbeat, not an event. Log real changes only.
    if v_new - 'last_used_at' - 'updated_at' = (to_jsonb(old) - 'key_hash' - 'last_used_at' - 'updated_at') then
      return null;
    end if;
    select jsonb_build_object(
             'old', coalesce(jsonb_object_agg(o.key, o.value) filter (
                        where o.value is distinct from (v_new -> o.key)
                          and o.key not in ('last_used_at', 'updated_at')), '{}'::jsonb),
             'new', coalesce(jsonb_object_agg(o.key, v_new -> o.key) filter (
                        where o.value is distinct from (v_new -> o.key)
                          and o.key not in ('last_used_at', 'updated_at')), '{}'::jsonb))
      into v_payload
      from jsonb_each(to_jsonb(old) - 'key_hash') o;
  else
    v_payload := jsonb_build_object('new', v_new - 'last_used_at');
  end if;
  insert into public.action_log (actor, action, target_table, target_id, payload)
  values (public.twinos_actor(), lower(tg_op), 'api_keys', v_new ->> 'id', v_payload);
  return null;
end;
$$;
revoke execute on function public.trg_api_keys_audit() from public, anon, authenticated;

drop trigger if exists trg_api_keys_audit on public.api_keys;
create trigger trg_api_keys_audit
  after insert or update or delete on public.api_keys
  for each row execute function public.trg_api_keys_audit();

-- ===========================================================================
-- 6. Grant/RLS hygiene
-- ===========================================================================
-- ctas / clip_candidates / flood_counters: RLS on, zero policies, no grants —
-- deny-all is safe but also unreadable by Jack's dashboard. Read for jack.
do $$
declare t text;
begin
  foreach t in array array['ctas', 'clip_candidates', 'flood_counters'] loop
    execute format('drop policy if exists jack_read on public.%I', t);
    execute format('create policy jack_read on public.%I for select to authenticated using (public.twinos_role() = ''jack'')', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- The reporting views are security_invoker; without a grant a dashboard JWT
-- gets permission-denied before RLS is even consulted.
grant select on
  public.v_best_times, public.v_campaign_cost, public.v_content_log, public.v_fanout_week,
  public.v_friday_scoreboard, public.v_funnel, public.v_hook_performance, public.v_hours_cut,
  public.v_post_engagement, public.v_quarter_targets, public.v_repeat_questions,
  public.v_results_weekly, public.v_signal_ledger, public.v_stop_if
to authenticated;

-- RLS is the gate; these grants could never be exercised and would go live
-- the moment someone added a permissive policy. api_keys keeps UPDATE (the
-- dashboard revokes a key by setting revoked_at); mint/delete go through the
-- SECURITY DEFINER RPCs with the owner role, never a user JWT.
revoke insert, delete on public.api_keys from authenticated;
revoke insert, update, delete on public.idempotency_keys from authenticated;
revoke insert on public.tg_updates from authenticated;

-- ===========================================================================
-- 7. Safety-critical cron (0010's examples, corrected routes)
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'twinos-publisher-tick') then
      perform cron.schedule('twinos-publisher-tick', '* * * * *',
        $cron$select public.twinos_cron_call('publish')$cron$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'twinos-stop-if') then
      perform cron.schedule('twinos-stop-if', '*/10 * * * *',
        $cron$select public.twinos_cron_call('results/stop-if')$cron$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'twinos-health') then
      perform cron.schedule('twinos-health', '*/5 * * * *',
        $cron$select public.twinos_cron_call('health')$cron$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'twinos-friday-numbers') then
      perform cron.schedule('twinos-friday-numbers', '0 1 * * 5',
        $cron$select public.twinos_cron_call('friday')$cron$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'twinos-keepalive') then
      perform cron.schedule('twinos-keepalive', '0 */6 * * *', $cron$select 1$cron$);
    end if;
    raise notice 'safety-critical cron ensured (publish, stop-if, health, friday, keepalive)';
  else
    raise notice 'pg_cron not available here: schedule the safety-critical jobs on Supabase';
  end if;
end $$;

-- ===========================================================================
-- 8. v_stop_if: an unposted result claim (message_id null until publish fills
--    it) must not silence the "signal without result" alarm
-- ===========================================================================
drop view if exists public.v_stop_if;
create view public.v_stop_if
with (security_invoker = true) as
select
  'signal_without_result' as rule,
  'Q4 2026' as quarter,
  'critical' as severity,
  s.id as signal_id,
  jsonb_build_object(
    'external_id', s.external_id, 'pair', s.pair, 'direction', s.direction,
    'status', s.status, 'signal_at', s.signal_at,
    'expires_at', coalesce(s.expires_at, s.signal_at + make_interval(hours => coalesce((public.setting('signal_expiry_hours') #>> '{}')::integer, 24))),
    'card_chat_id', c.chat_id, 'card_message_id', c.message_id
  ) as detail,
  now() as flagged_at
from public.signals s
join public.signal_posts c on c.signal_id = s.id and c.kind in ('card', 'signal')
where s.data_source = 'live'
  and s.status not in ('shadow', 'cancelled')
  and not exists (
    select 1 from public.signal_posts r
     where r.signal_id = s.id and r.kind = 'result' and r.message_id is not null
  )
  and (
    s.status not in ('open')
    or coalesce(s.expires_at, s.signal_at + make_interval(hours => coalesce((public.setting('signal_expiry_hours') #>> '{}')::integer, 24))) < now()
  )
union all
select
  'cost_per_ftd_over_120_two_weeks', 'Q1 2027', 'critical', null,
  jsonb_build_object('weeks', jsonb_agg(jsonb_build_object('week_start', x.week_start, 'cost_per_ftd_usd', x.cost_per_ftd_usd) order by x.week_start)),
  now()
from (
  select week_start, cost_per_ftd_usd from public.v_funnel
  where cost_per_ftd_usd is not null order by week_start desc limit 2
) x
having count(*) = 2 and bool_and(x.cost_per_ftd_usd > 120)
union all
select
  'refund_or_complaint_rate_over_3pct', 'Q2 2027', 'critical', null,
  jsonb_build_object('week_start', m.week_start, 'rate_pct', m.value),
  now()
from public.manual_metrics m
where m.kind = 'support' and m.metric = 'refund_complaint_rate_pct' and m.value > 3
  and m.week_start = (select max(week_start) from public.manual_metrics where kind = 'support' and metric = 'refund_complaint_rate_pct');
comment on view public.v_stop_if is 'Open stop-if alarms (plan §1). Rule 1 fires for any posted signal past its expiry window with no posted result reply under it.';

grant select on public.v_stop_if to authenticated;
