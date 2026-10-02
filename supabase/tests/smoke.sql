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
select set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', false);

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

-- clean slate, so the file can be re-run against a database that already has
-- the seed (and against one where a previous run was left half-applied)
delete from public.signals where external_id like 'smoke-%';
delete from public.content_items where title like 'smoke %';
delete from public.settings where key = 'smoke_test';
delete from public.member_events where user_id in (42, 777);
delete from public.memberships where user_id in (42, 777);
delete from public.invite_links where name = 'tt-live-2610';
delete from public.api_keys where name like 'smoke%';

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
--    Each check is its own block so a failure names itself.
-- ---------------------------------------------------------------------------

-- 3a. requires_approval is forced by a claim, and by the post type
do $$
declare
  v_lesson uuid;
  v_signal uuid;
  v_result uuid;
  v_req boolean;
begin
  insert into public.content_items (post_type, title) values ('lesson', 'smoke lesson') returning id into v_lesson;
  insert into public.content_items (post_type, title) values ('signal_card', 'smoke signal') returning id into v_signal;
  insert into public.content_items (post_type, title) values ('result_reply', 'smoke result') returning id into v_result;

  insert into public.content_variants (item_id, body) values (v_lesson, 'Save this. #Lesson')
    returning requires_approval into v_req;
  assert v_req = false, 'a lesson without claims must not require approval';

  insert into public.content_variants (item_id, body) values (v_signal, 'BUY | XAUUSD')
    returning requires_approval into v_req;
  assert v_req = true, 'a signal_card must be forced to requires_approval';

  insert into public.content_variants (item_id, body, claim_flags) values (v_lesson, 'EzyMap Lite $49', '{price}'::text[])
    returning requires_approval into v_req;
  assert v_req = true, 'claim_flags must force requires_approval';
  raise notice 'ok: requires_approval forced by claims and post type';
end $$;

-- 3b. only Jack may approve, and a non-jack decision is refused
do $$
declare
  v_var uuid;
  v_caught boolean;
begin
  insert into public.content_variants (item_id, body, claim_flags)
    select id, 'BUY | XAUUSD', '{level,signal_card}'::text[] from public.content_items where title = 'smoke signal'
    returning id into v_var;

  perform set_config('request.jwt.claims', '{"twinos_role":"abdul","role":"authenticated"}', false);
  v_caught := false;
  begin
    update public.content_variants set status = 'approved', approved_by = 'jack' where id = v_var;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'abdul approving must be rejected';
  perform set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', false);

  v_caught := false;
  begin
    update public.content_variants set status = 'approved', approved_by = 'abdul' where id = v_var;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'approved_by must be jack';

  update public.content_variants set status = 'approved', approved_by = 'jack' where id = v_var;
  assert (select approved_at is not null from public.content_variants where id = v_var), 'approved_at set by the guard';
  raise notice 'ok: only jack approves';
end $$;

-- 3c. returning to pending_approval clears the decision
do $$
declare
  v_var uuid;
begin
  select id into v_var from public.content_variants where body = 'BUY | XAUUSD' limit 1;
  update public.content_variants set status = 'pending_approval' where id = v_var;
  assert (select approved_by is null and approved_at is null from public.content_variants where id = v_var),
    'returning to pending_approval must clear the recorded decision';
  update public.content_variants set status = 'approved', approved_by = 'jack' where id = v_var;
  assert (select status = 'approved' from public.content_variants where id = v_var), 're-approving from a clean state works';
  raise notice 'ok: approval is cleared on edit';
end $$;

-- 3d. the way the functions approve: an approvals row, then the item flips.
--     No approved_by is written on the variant by the functions.
do $$
declare
  v_jack uuid;
  v_jvar uuid;
begin
  insert into public.content_items (post_type, title, status) values ('signal_card', 'smoke jack approves', 'draft')
    returning id into v_jack;
  insert into public.content_variants (item_id, body, claim_flags)
    values (v_jack, 'BUY | XAUUSD 4590', '{level,signal_card}'::text[]) returning id into v_jvar;
  insert into public.approvals (content_id, decision, by_actor, via) values (v_jack, 'approve', 'jack', 'telegram');
  update public.content_items set status = 'approved' where id = v_jack;
  assert (select status = 'approved' from public.content_variants where id = v_jvar),
    'a jack approvals row must let the item and its variant reach approved';
  assert (select approved_by from public.content_variants where id = v_jvar) = 'jack',
    'the mirrored variant records who decided';
  raise notice 'ok: approval via the approvals row';
end $$;

-- 3e. an approvals row from anyone but Jack is refused outright
do $$
declare
  v_abd uuid;
  v_caught boolean;
begin
  insert into public.content_items (post_type, title, status) values ('signal_card', 'smoke abdul tries', 'draft')
    returning id into v_abd;
  v_caught := false;
  begin
    insert into public.approvals (content_id, decision, by_actor, via) values (v_abd, 'approve', 'abdul', 'dashboard');
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'an abdul approvals row must be refused';
  raise notice 'ok: non-jack approvals refused';
end $$;

-- 3f. the board_rule exception (plan 9.N.107): a result_reply with no price and
--     no offer may be approved by rule. Anything with money in it stays Jack's.
do $$
declare
  v_ok uuid;
  v_okv uuid;
  v_no uuid;
  v_nov uuid;
  v_caught boolean;
begin
  insert into public.content_items (post_type, title, status) values ('result_reply', 'smoke board rule', 'draft')
    returning id into v_ok;
  insert into public.content_variants (item_id, body) values (v_ok, 'TP1 hit: +1.5R') returning id into v_okv;
  insert into public.approvals (content_id, decision, by_actor, by_subject, via, note)
    values (v_ok, 'approve', 'abdul', 'abdul-key', 'board_rule', 'result tp1 from the board');
  update public.content_items set status = 'approved' where id = v_ok;
  assert (select status = 'approved' from public.content_variants where id = v_okv),
    'a board-sourced result reply may be approved by rule';

  -- the same exception must not carry an offer. The approvals insert itself is
  -- refused, because the guard sees the price claim on the variant.
  insert into public.content_items (post_type, title, status) values ('result_reply', 'smoke board rule with a price', 'draft')
    returning id into v_no;
  insert into public.content_variants (item_id, body, claim_flags)
    values (v_no, 'TP1 hit, EzyMap Pro $249', '{price,offer}'::text[]) returning id into v_nov;
  v_caught := false;
  begin
    insert into public.approvals (content_id, decision, by_actor, by_subject, via)
      values (v_no, 'approve', 'abdul', 'abdul-key', 'board_rule');
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'board_rule must not approve a post carrying a price or offer';
  raise notice 'ok: board_rule is narrow';
end $$;

-- 3g. an unapproved claim post cannot reach published
do $$
declare
  v_un uuid;
  v_caught boolean;
begin
  insert into public.content_items (post_type, title, status) values ('signal_card', 'smoke unapproved publish', 'draft')
    returning id into v_un;
  insert into public.content_variants (item_id, body, claim_flags)
    values (v_un, 'BUY | XAUUSD 4590', '{level,signal_card}'::text[]);
  v_caught := false;
  begin
    update public.content_items set status = 'published' where id = v_un;
  exception
    when insufficient_privilege then v_caught := true;
    when check_violation then v_caught := true;
  end;
  assert v_caught, 'an unapproved claim post must not reach published';
  raise notice 'ok: publishing needs approval';
end $$;

-- 3h. [NEEDED] placeholders block scheduling
do $$
declare
  v_var uuid;
  v_caught boolean;
begin
  select id into v_var from public.content_variants where body = 'BUY | XAUUSD' limit 1;
  update public.content_variants set approved_by = 'jack', approved_at = now() where id = v_var;
  v_caught := false;
  begin
    update public.content_variants
       set status = 'scheduled', needed_fields = '{TP2}', scheduled_for = now() + interval '1 hour'
     where id = v_var;
  exception when check_violation then
    v_caught := true;
  end;
  assert v_caught, 'needed_fields must block scheduling';
  update public.content_variants
     set status = 'scheduled', needed_fields = '{}', scheduled_for = now() + interval '1 hour'
   where id = v_var;
  raise notice 'ok: [NEEDED] blocks scheduling';
end $$;

-- 3i. a result post needs board_refs, and the writes are logged
do $$
declare
  v_result uuid;
  v_var uuid;
  v_caught boolean;
begin
  select id into v_result from public.content_items where title = 'smoke result';
  insert into public.content_variants (item_id, body, status, approved_by)
    values (v_result, 'TP1 hit: +1.5R', 'approved', 'jack') returning id into v_var;
  v_caught := false;
  begin
    update public.content_variants set status = 'scheduled' where id = v_var;
  exception when check_violation then
    v_caught := true;
  end;
  assert v_caught, 'result without board_refs must be blocked';
  update public.content_variants
     set board_refs = array[(select id from public.signals where external_id = 'smoke-w2')],
         status = 'scheduled'
   where id = v_var;
  assert (select status from public.content_variants where id = v_var) = 'scheduled';
  assert (select count(*) from public.action_log where target_table = 'content_variants') >= 8,
    'content_variants changes are logged';
  raise notice 'ok: result needs board_refs, and the audit trail is written';
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
  perform set_config('request.jwt.claims', '{"twinos_role":"ezyai","role":"authenticated"}', false);
  begin
    insert into public.content_items (post_type, title) values ('lesson', 'ezyai must not write content');
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'ezyai inserting content_items must be denied by RLS';
  assert (select count(*) from public.settings) = 0, 'ezyai must not read settings';
  perform set_config('request.jwt.claims', '{"twinos_role":"abdul","role":"authenticated"}', false);
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
  perform set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', false);
  raise notice 'ok: RLS sanity';
end $$;

-- ---------------------------------------------------------------------------
-- 12. anon reads the public board and nothing behind it (0013)
-- ---------------------------------------------------------------------------
do $$
declare
  v_caught boolean;
  v_live integer := (select count(*) from public.signals
                      where external_id like 'smoke-%' and data_source = 'live' and status <> 'shadow');
  v_stats integer := (select signals from public.results_stats(now() - interval '30 days', now() + interval '1 hour'));
begin
  assert v_live > 0, 'the smoke fixtures must include live signals';
  begin
    execute 'set local role anon';
  exception when undefined_object or invalid_parameter_value then
    raise notice 'skip: role anon not present (not a Supabase database)';
    return;
  end;
  assert (select count(*) from public.v_results_board where external_id like 'smoke-%') = v_live, 'anon sees every live board row';
  assert (select count(*) from public.signals where external_id in ('smoke-demo', 'smoke-shadow')) = 0, 'anon must not see demo or shadow signals';
  assert (select signals from public.results_stats(now() - interval '30 days', now() + interval '1 hour')) = v_stats, 'anon gets the same board numbers from results_stats';
  v_caught := false;
  begin
    perform raw from public.signals limit 1;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'anon must not read signals.raw';
  v_caught := false;
  begin
    perform chat_id from public.signal_posts limit 1;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'anon must not read signal_posts.chat_id';
  v_caught := false;
  begin
    perform 1 from public.settings limit 1;
  exception when insufficient_privilege then
    v_caught := true;
  end;
  assert v_caught, 'anon must not read settings';
  execute 'reset role';
  raise notice 'ok: anon reads the public board only';
end $$;

-- 14. a reject reaches the variant (0017): the item status is mirrored onto the
--     content_status enum, which must know 'rejected'
do $$
declare
  v_item uuid;
  v_var uuid;
begin
  insert into public.content_items (post_type, title, status) values ('gold_map', 'smoke reject', 'pending_approval')
    returning id into v_item;
  insert into public.content_variants (item_id, body) values (v_item, 'GOLD MAP. Not financial advice.')
    returning id into v_var;
  update public.content_items set status = 'rejected', reject_note = 'smoke' where id = v_item;
  assert (select status::text = 'rejected' from public.content_variants where id = v_var),
    'a rejected item must mirror rejected onto its variant';
  raise notice 'ok: reject mirrors onto the variant';
end $$;

-- 13. a real login carries the role under app_metadata (0016)
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"twinos_role":"jack"}}', true);
  assert public.twinos_role() = 'jack', 'app_metadata.twinos_role must be read';
  assert public.twinos_actor() = 'jack', 'actor must follow app_metadata.twinos_role';
  perform set_config('request.jwt.claims', '{"role":"authenticated","user_metadata":{"twinos_role":"jack"}}', true);
  assert public.twinos_role() is null, 'user_metadata is editable by the user and must never grant a role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  assert public.twinos_role() is null, 'anon has no twinos role';
  perform set_config('request.jwt.claims', '{"twinos_role":"jack","role":"authenticated"}', false);
  raise notice 'ok: login roles come from app_metadata only';
end $$;

-- 15. one post job per variant (plus at most one comment job): enqueuePublish()
--     upserts with onConflict=(variant_id,kind), ignoreDuplicates, so an approve
--     that is retried (or a cron tick that re-enqueues) cannot post the same
--     draft twice (P1.2); a first-comment job shares the variant (0029)
do $$
declare
  v_item uuid;
  v_var uuid;
begin
  insert into public.content_items (post_type, title, status)
    values ('gold_map', 'smoke publish idempotency', 'approved')
    returning id into v_item;
  insert into public.content_variants (item_id, body)
    values (v_item, 'GOLD MAP. Not financial advice.')
    returning id into v_var;

  insert into public.publish_jobs (content_id, variant_id, platform, run_at, status, attempts, created_by)
    values (v_item, v_var, 'telegram', now(), 'queued', 0, 'smoke');
  -- the retry: same upsert, must be a no-op
  insert into public.publish_jobs (content_id, variant_id, platform, run_at, status, attempts, created_by)
    values (v_item, v_var, 'telegram', now(), 'queued', 0, 'smoke')
    on conflict (variant_id, kind) do nothing;

  assert (select count(*) from public.publish_jobs where variant_id = v_var and kind = 'post') = 1,
    'enqueuePublish must keep one post job per variant, even when retried';
  -- the first comment shares the variant under its own kind
  insert into public.publish_jobs (content_id, variant_id, platform, kind, run_at, status, attempts, created_by, result)
    values (v_item, v_var, 'telegram', 'comment', now(), 'queued', 0, 'smoke', '{"first_comment": "hi"}')
    on conflict (variant_id, kind) do nothing;
  assert (select count(*) from public.publish_jobs where variant_id = v_var) = 2,
    'one post job plus one comment job per variant';
  raise notice 'ok: publish_jobs is idempotent per variant and kind';
end $$;

-- 16. a queued result_reply job is claimed by exactly one tick (P1.5)
--     results/run drains these; two cron ticks must never post the same result.
do $$
declare
  v_job uuid;
  v_claimed integer;
begin
  insert into public.jobs (kind, payload, status, run_at, created_by)
    values ('result_reply', '{"signal_id":"00000000-0000-0000-0000-000000000000","status":"tp1"}'::jsonb,
            'queued', now(), 'smoke')
    returning id into v_job;

  with first as (
    update public.jobs set status = 'claimed', claimed_at = now()
     where id = v_job and status = 'queued' returning id
  ) select count(*) into v_claimed from first;
  assert v_claimed = 1, 'the first tick claims the result_reply job';

  with second as (
    update public.jobs set status = 'claimed', claimed_at = now()
     where id = v_job and status = 'queued' returning id
  ) select count(*) into v_claimed from second;
  assert v_claimed = 0, 'a second tick must not claim an already-claimed job';
  raise notice 'ok: a result_reply job is claimed once';
end $$;

-- 17. a stop-if alert is raised once per signal while it is open (P1.6).
--     results/stop-if runs every 10 minutes; without dedupe_key it would insert
--     a new alert and message Jack again on every tick.
do $$
declare
  v_caught boolean := false;
begin
  insert into public.alerts (kind, severity, message, dedupe_key)
    values ('stop_if_missing_result', 'critical', 'smoke stop-if', 'smoke-stopif-1');
  begin
    insert into public.alerts (kind, severity, message, dedupe_key)
      values ('stop_if_missing_result', 'critical', 'smoke stop-if again', 'smoke-stopif-1');
  exception when unique_violation then
    v_caught := true;
  end;
  assert v_caught, 'a second open alert with the same dedupe_key must be refused';

  update public.alerts set resolved_at = now() where dedupe_key = 'smoke-stopif-1';
  insert into public.alerts (kind, severity, message, dedupe_key)
    values ('stop_if_missing_result', 'critical', 'smoke stop-if after resolve', 'smoke-stopif-1');
  raise notice 'ok: stop-if alerts dedupe while open and can re-fire after resolve';
end $$;

-- 18. hours cut against the baseline week, and fan-out coverage (0021)
do $$
declare
  v_m uuid;
  v_m2 uuid;
  r record;
begin
  delete from public.baseline_hours;
  delete from public.time_saved;
  insert into public.baseline_hours (week_start, day, task, minutes) values
    ('2026-10-05', '2026-10-05', 'map', 300),
    ('2026-10-05', '2026-10-06', 'recording', 300),
    ('2026-10-12', '2026-10-12', 'map', 50);          -- a later week must not move the baseline
  insert into public.time_saved (occurred_at, action, minutes_saved) values
    ('2026-10-13 04:00+00', 'drafted', 300),
    ('2026-10-14 04:00+00', 'posted', 60.3);
  select * into r from public.v_hours_cut where week_start = '2026-10-12';
  assert r.baseline_min = 600, 'the baseline is the first logged week: ' || coalesce(r.baseline_min::text, 'null');
  assert r.saved_min = 360, 'saved minutes are summed per KL week: ' || coalesce(r.saved_min::text, 'null');
  assert r.cut_pct = 60.0, 'cut = saved / baseline: ' || coalesce(r.cut_pct::text, 'null');

  insert into public.content_items (post_type, title, status, created_at)
    values ('gold_map', 'smoke master', 'published', '2026-10-13 01:00+00') returning id into v_m;
  insert into public.content_items (post_type, title, status, source) values
    ('gold_map', 'ig', 'published', jsonb_build_object('via', 'fanout', 'parent', v_m::text, 'platform', 'instagram', 'kit', false)),
    ('gold_map', 'th', 'scheduled', jsonb_build_object('via', 'fanout', 'parent', v_m::text, 'platform', 'threads', 'kit', false)),
    ('gold_map', 'tt', 'draft',     jsonb_build_object('via', 'fanout', 'parent', v_m::text, 'platform', 'tiktok', 'kit', true));
  select * into r from public.v_fanout_week where master_id = v_m;
  assert r.providers = 2, 'kits are not providers: ' || coalesce(r.providers::text, 'null');
  assert r.published = 1, 'only published provider copies count: ' || coalesce(r.published::text, 'null');
  assert r.week_start = '2026-10-12', 'week of the master, KL time';

  insert into public.content_items (post_type, title, status, created_at)
    values ('gold_map', 'smoke master 2', 'published', '2026-10-14 01:00+00') returning id into v_m2;
  insert into public.content_items (post_type, title, status, source) values
    ('gold_map', 'ig2', 'published', jsonb_build_object('via', 'fanout', 'parent', v_m2::text, 'platform', 'instagram', 'kit', false));
  assert (select count(*) from public.v_fanout_week where week_start = '2026-10-12' and providers > 0 and providers = published) = 1,
    'exactly one master reached every provider platform';
  raise notice 'ok: hours cut and fan-out views';
end $$;

-- 19. repeat questions are counted per question for the FAQ sheet (0022)
do $$
declare r record;
begin
  insert into public.moderation_events (chat_id, user_id, rule_key, action_taken, detail, text_excerpt, occurred_at) values
    (-1001, 11, 'repeat_question', 'flagged', 'loss set stop', 'How do I set my stop loss?', now() - interval '3 days'),
    (-1001, 12, 'repeat_question', 'flagged', 'loss set stop', 'how to set stop-loss', now() - interval '1 day'),
    (-1001, 13, 'repeat_question', 'flagged', 'loss set stop', 'where do I set the stop loss', now()),
    (-1001, 14, 'repeat_question', 'flagged', 'plan price pro', 'price of the pro plan?', now()),
    (-1001, 15, 'repeat_question', 'flagged', 'old question', 'an old one', now() - interval '40 days'),
    (-1001, 16, 'scam_keywords_en', 'warned', 'x', 'not a question', now());
  select * into r from public.v_repeat_questions where detail = 'loss set stop';
  assert r.times_asked = 3, 'three askers of the same question: ' || coalesce(r.times_asked::text, 'null');
  assert r.askers = 3, 'three different members';
  assert not exists (select 1 from public.v_repeat_questions where detail = 'plan price pro'), 'asked once is not a repeat';
  assert not exists (select 1 from public.v_repeat_questions where detail = 'old question'), 'older than 14 days is outside the window';
  raise notice 'ok: v_repeat_questions';
end $$;

-- 20. cost per first-time depositor per campaign, kept apart from the weekly totals (0025)
do $$
declare r record;
begin
  delete from public.manual_metrics where week_start = '2026-10-12';
  insert into public.manual_metrics (week_start, kind, metric, value, source) values
    ('2026-10-12', 'campaign', 'ad_spend_usd', 150, 'campaign'),
    ('2026-10-12', 'campaign', 'first_time_depositors', 3, 'campaign'),
    ('2026-10-12', 'campaign', 'ib_accounts_opened', 9, 'campaign'),
    ('2026-10-12', 'vantage', 'first_time_depositors', 100, 'vantage');   -- a weekly total must not leak into a campaign
  update public.manual_metrics set campaign = 'tt-live-2610' where week_start = '2026-10-12' and kind = 'campaign';
  insert into public.manual_metrics (week_start, kind, metric, value, source, campaign) values
    ('2026-10-12', 'campaign', 'ad_spend_usd', 40, 'campaign', 'ig-bio-2610');
  select * into r from public.v_campaign_cost where week_start = '2026-10-12' and campaign = 'tt-live-2610';
  assert r.ad_spend_usd = 150, 'spend: ' || coalesce(r.ad_spend_usd::text, 'null');
  assert r.first_time_depositors = 3, 'depositors: ' || coalesce(r.first_time_depositors::text, 'null');
  assert r.ib_accounts_opened = 9, 'accounts';
  assert r.cost_per_ftd_usd = 50.00, 'cost per depositor: ' || coalesce(r.cost_per_ftd_usd::text, 'null');
  select * into r from public.v_campaign_cost where week_start = '2026-10-12' and campaign = 'ig-bio-2610';
  assert r.ad_spend_usd = 40 and r.cost_per_ftd_usd is null, 'spend with no depositor has no cost per depositor, not a division error';
  assert (select count(*) from public.v_campaign_cost where week_start = '2026-10-12') = 2, 'two campaigns that week';
  raise notice 'ok: v_campaign_cost';
end $$;

-- 21. CTA library seeded per platform x language with rotation columns (0027)
do $$
declare combos integer;
begin
  assert (select count(*) from public.hooks where active) >= 40, 'the hook bank stays seeded';
  select count(*) into combos from (
    select distinct platform, lang from public.ctas where active
  ) s;
  assert combos = 14, 'one CTA set per platform x language (7 x en/ms), got ' || combos;
  assert not exists (
    select 1 from public.ctas where active group by platform, lang having count(*) < 2
  ), 'every platform x language carries at least two CTA lines to rotate';
  assert not exists (
    select 1 from public.ctas where times_used is null or last_used_at is not null
  ), 'fresh CTA rows start unused with no last use';
  raise notice 'ok: cta library';
end $$;

-- 22. delayed first comment rides the publish queue without a second variant (0029)
do $$
begin
  assert (select count(*) from information_schema.columns
    where table_name = 'content_items' and column_name in ('first_comment', 'first_comment_delay_min')) = 2,
    'first_comment columns exist';
  assert exists (
    select 1 from pg_indexes where tablename = 'publish_jobs' and indexname = 'idx_publish_jobs_variant_kind_uniq'
  ), 'one post job and one comment job may share a variant';
  raise notice 'ok: first comment queue';
end $$;

select 'smoke tests passed; rolling back' as result;
rollback;
