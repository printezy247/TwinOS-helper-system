-- supabase/tests/smoke.sql — a few asserts against a database that has the
-- migrations and seed applied. Everything runs in one transaction and is
-- rolled back, so it is safe on a real project.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
--   (local stack: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres ...)
--
-- A failing assert aborts with "ASSERT_FAILURE"; a clean run ends with the
-- NOTICE lines and ROLLBACK.

\set ON_ERROR_STOP on
begin;

-- act as Jack for the whole test
select set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- 1. strict win rate: W / (W + L), break-even excluded
-- ---------------------------------------------------------------------------
do $$
begin
  assert public.strict_win_rate(4, 2) = 66.7, 'strict_win_rate(4,2) must be 66.7 (4 of 6, BE excluded)';
  assert public.strict_win_rate(11, 6) = 64.7, 'strict_win_rate(11,6) must be 64.7';
  assert public.strict_win_rate(0, 0) is null, 'no decided trades gives null, not 0';
  assert public.outcome_class('tp1', 1.5) = 'win';
  assert public.outcome_class('tp2', 2.4) = 'win';
  assert public.outcome_class('sl', -1) = 'loss';
  assert public.outcome_class('be', 0.75) = 'be', 'break-even is never a win';
  assert public.outcome_class('expired', 0) = 'be';
  assert public.outcome_class('open', null) = 'open';
  raise notice 'ok: strict win rate functions';
end $$;

insert into public.signals (external_id, source, pair, style, mode, direction, entry, stop_loss, tp1, tp2, rr_target, confidence, status, r_multiple, data_source, signal_at) values
  ('smoke-w1', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'tp2', 2.4, 'live', now() - interval '3 days'),
  ('smoke-w2', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'tp1', 1.5, 'live', now() - interval '3 days'),
  ('smoke-w3', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'short', 4060, 4070, 4045, 4030, 1.5, 70, 'tp2', 2.0, 'live', now() - interval '2 days'),
  ('smoke-w4', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'short', 4060, 4070, 4045, 4030, 1.5, 70, 'expired', 0.4, 'live', now() - interval '2 days'),
  ('smoke-l1', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'sl', -1, 'live', now() - interval '2 days'),
  ('smoke-l2', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'sl', -1, 'live', now() - interval '1 day'),
  ('smoke-b1', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'be', 0.75, 'live', now() - interval '1 day'),
  ('smoke-b2', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'be', 0, 'live', now() - interval '1 day'),
  ('smoke-demo', 'ezyai', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'tp2', 2.4, 'demo', now() - interval '1 day'),
  ('smoke-shadow', 'ezyai', 'XAUUSD', 'scalp', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'shadow', null, 'shadow', now() - interval '1 day');

do $$
declare
  r record;
begin
  select * into r from public.results_stats(now() - interval '7 days', now() + interval '1 hour');
  assert r.wins = 4, format('wins: expected 4, got %s', r.wins);
  assert r.losses = 2, format('losses: expected 2, got %s', r.losses);
  assert r.break_even = 2, format('break_even: expected 2, got %s', r.break_even);
  assert r.strict_win_rate = 66.7, format('strict_win_rate: expected 66.7, got %s', r.strict_win_rate);
  assert r.signals = 8, format('demo and shadow rows must be excluded, got %s signals', r.signals);
  assert (select count(*) from public.v_results_board where external_id like 'smoke-%') = 8, 'v_results_board must hide demo/shadow rows';
  assert (select strict_win_rate_28d from public.v_results_board where external_id = 'smoke-w1') = 66.7, 'board rolling win rate';
  raise notice 'ok: results_stats and v_results_board (4W 2L 2BE -> 66.7%%)';
end $$;

-- ---------------------------------------------------------------------------
-- 2. action_log fires on insert / update / delete, with the actor from the claim
-- ---------------------------------------------------------------------------
do $$
declare
  n0 bigint;
  n1 bigint;
begin
  select count(*) into n0 from public.action_log where target_table = 'settings';
  insert into public.settings (key, value, description) values ('smoke_test', '1', 'temporary');
  update public.settings set value = '2' where key = 'smoke_test';
  update public.settings set value = '2' where key = 'smoke_test';   -- no-op: not logged
  delete from public.settings where key = 'smoke_test';
  select count(*) into n1 from public.action_log where target_table = 'settings';
  assert n1 = n0 + 3, format('expected 3 new action_log rows for settings, got %s', n1 - n0);
  assert (select actor from public.action_log where target_table = 'settings' order by id desc limit 1) = 'jack', 'actor must come from the twinos_role claim';
  assert (select action from public.action_log where target_table = 'settings' order by id desc limit 1) = 'delete';
  assert (select payload -> 'new' ->> 'value' from public.action_log where target_table = 'settings' and action = 'update' order by id desc limit 1) = '2', 'update payload carries the changed field';
  raise notice 'ok: action_log trigger';
end $$;

-- ---------------------------------------------------------------------------
-- 3. content_variants guards
-- ---------------------------------------------------------------------------
do $$
declare
  v_lesson uuid;
  v_signal uuid;
  v_result uuid;
  v_var uuid;
  v_req boolean;
  v_caught boolean;
begin
  -- a lesson needs no approval; a signal is forced to requires_approval
  insert into public.content_items (post_type, title) values ('lesson', 'smoke lesson') returning id into v_lesson;
  insert into public.content_items (post_type, title) values ('signal', 'smoke signal') returning id into v_signal;
  insert into public.content_items (post_type, title) values ('result', 'smoke result') returning id into v_result;

  insert into public.content_variants (item_id, body) values (v_lesson, 'Save this. #Lesson') returning requires_approval into v_req;
  assert v_req = false, 'lesson without claims must not require approval';

  insert into public.content_variants (item_id, body) values (v_signal, 'BUY | XAUUSD') returning id, requires_approval into v_var, v_req;
  assert v_req = true, 'signal must be forced to requires_approval';

  -- a lesson with a price claim is forced too
  insert into public.content_variants (item_id, body, claim_flags) values (v_lesson, 'EzyMap Lite $49', '{price}') returning requires_approval into v_req;
  assert v_req = true, 'claim_flags must force requires_approval';

  -- abdul may not approve, even with approved_by = jack
  perform set_config('request.jwt.claims', '{"twinos_role":"abdul","role":"authenticated"}', true);
  v_caught := false;
  begin
    update public.content_variants set status = 'approved', approved_by = 'jack' where id = v_var;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'abdul approving must be rejected';
  perform set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', true);

  -- jack with the wrong approved_by is rejected; with approved_by = jack it passes
  v_caught := false;
  begin
    update public.content_variants set status = 'approved', approved_by = 'abdul' where id = v_var;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'approved_by must be jack';

  update public.content_variants set status = 'pending_approval' where id = v_var;
  update public.content_variants set status = 'approved', approved_by = 'jack' where id = v_var;
  assert (select approved_at is not null from public.content_variants where id = v_var), 'approved_at set by the guard';

  -- [NEEDED] placeholders block scheduling
  v_caught := false;
  begin
    update public.content_variants set status = 'scheduled', needed_fields = '{TP2}', scheduled_for = now() + interval '1 hour' where id = v_var;
  exception when check_violation then
    v_caught := true;
  end;
  assert v_caught, 'needed_fields must block scheduling';
  update public.content_variants set status = 'scheduled', scheduled_for = now() + interval '1 hour' where id = v_var;

  -- a result post cannot be scheduled without board_refs
  insert into public.content_variants (item_id, body, status, approved_by) values (v_result, 'TP1 hit: +1.5R', 'approved', 'jack') returning id into v_var;
  v_caught := false;
  begin
    update public.content_variants set status = 'scheduled' where id = v_var;
  exception when check_violation then
    v_caught := true;
  end;
  assert v_caught, 'result without board_refs must be blocked';
  update public.content_variants set board_refs = array[(select id from public.signals where external_id = 'smoke-w2')], status = 'scheduled' where id = v_var;
  assert (select status from public.content_variants where id = v_var) = 'scheduled';

  -- the variant writes were logged
  assert (select count(*) from public.action_log where target_table = 'content_variants') >= 8, 'content_variants changes are logged';
  raise notice 'ok: approval and publish guards';
end $$;

-- ---------------------------------------------------------------------------
-- 4. v_stop_if flags a posted signal past its window with no result reply
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig uuid;
begin
  insert into public.signals (external_id, source, pair, style, mode, direction, entry, stop_loss, tp1, tp2, rr_target, confidence, status, data_source, signal_at)
  values ('smoke-stopif', 'tradingview', 'XAUUSD', 'intraday', 'normal', 'long', 4015, 4006, 4030, 4046, 1.5, 70, 'open', 'live', now() - interval '2 days')
  returning id into v_sig;
  insert into public.signal_posts (signal_id, kind, chat_id, message_id, posted_at) values (v_sig, 'card', -1001, 501, now() - interval '2 days');
  assert exists (select 1 from public.v_stop_if where signal_id = v_sig and rule = 'signal_without_result'), 'posted signal past expiry with no result must be flagged';
  insert into public.signal_posts (signal_id, kind, chat_id, message_id, posted_at) values (v_sig, 'result', -1001, 502, now());
  assert not exists (select 1 from public.v_stop_if where signal_id = v_sig), 'flag clears once the result reply exists';
  raise notice 'ok: v_stop_if';
end $$;

-- ---------------------------------------------------------------------------
-- 5. invite link naming convention and member_events fold
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.invite_links (chat_id, name, source, campaign) values (-1001, 'TikTok Live Oct', 'tt', 'live');
  exception when check_violation then
    v_caught := true;
  end;
  assert v_caught, 'invite link names must follow src-campaign-yymm';
  insert into public.invite_links (chat_id, name, source, campaign) values (-1001, 'tt-live-2610', 'tt', 'live');
  insert into public.member_events (chat_id, user_id, kind, occurred_at, invite_link_name) values (-1001, 42, 'join', now() - interval '1 day', 'tt-live-2610');
  assert (select source from public.memberships where chat_id = -1001 and user_id = 42) = 'tt', 'join folds into memberships with the link source';
  insert into public.member_events (chat_id, user_id, kind, occurred_at) values (-1001, 42, 'leave', now());
  assert (select status from public.memberships where chat_id = -1001 and user_id = 42) = 'left';
  raise notice 'ok: invite links and memberships';
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS sanity (skipped when the `authenticated` role does not exist, i.e. outside Supabase)
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught boolean := false;
begin
  begin
    execute 'set local role authenticated';
  exception when undefined_object or invalid_parameter_value then
    raise notice 'skip: role authenticated not present (not a Supabase database)';
    return;
  end;
  perform set_config('request.jwt.claims', '{"twinos_role":"ezyai","role":"authenticated"}', true);
  begin
    insert into public.content_items (post_type, title) values ('lesson', 'ezyai must not write content');
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'ezyai inserting content_items must be denied by RLS';
  assert (select count(*) from public.settings) = 0, 'ezyai must not read settings';
  perform set_config('request.jwt.claims', '{"twinos_role":"abdul","role":"authenticated"}', true);
  assert (select count(*) from public.settings) > 0, 'abdul reads settings';
  v_caught := false;
  begin
    update public.content_variants set status = 'approved', approved_by = 'jack'
     where status = 'draft' and item_id = (select id from public.content_items where title = 'smoke lesson' limit 1);
  exception when insufficient_privilege then
    v_caught := true;
  end;
  -- the guard rejects abdul approving, and RLS would reject the new status anyway
  assert v_caught, 'abdul cannot approve through RLS either';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', true);
  raise notice 'ok: RLS sanity';
end $$;

select 'smoke tests passed; rolling back' as result;
rollback;
