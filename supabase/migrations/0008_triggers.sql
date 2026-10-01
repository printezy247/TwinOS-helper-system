-- 0008_triggers.sql — action_log by trigger, updated_at, and the publish guards.
-- UPGRADE-PLAN §9.A.2, §9.C.16, §9.E.31, §9.N.108, §9.O, §12.

-- ---------------------------------------------------------------------------
-- action_log writer. SECURITY DEFINER so any role whose write succeeded gets
-- logged even though only jack/dashboard may read action_log.
-- ---------------------------------------------------------------------------
create or replace function public.trg_action_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_payload jsonb;
  v_target text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_payload := jsonb_build_object('new', v_new);
  elsif tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    -- only the changed fields, old and new
    select jsonb_build_object(
             'old', coalesce(jsonb_object_agg(o.key, o.value) filter (where o.value is distinct from (v_new -> o.key)), '{}'::jsonb),
             'new', coalesce(jsonb_object_agg(o.key, v_new -> o.key) filter (where o.value is distinct from (v_new -> o.key)), '{}'::jsonb))
      into v_payload
      from jsonb_each(v_old) o;
    if v_payload -> 'new' = '{"updated_at": null}'::jsonb - 'updated_at' then
      null;
    end if;
    -- skip no-op updates (only updated_at moved)
    if (v_payload -> 'new') - 'updated_at' = '{}'::jsonb then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
    v_payload := jsonb_build_object('old', v_old);
  end if;

  v_target := coalesce(
    coalesce(v_new, v_old) ->> 'id',
    coalesce(v_new, v_old) ->> 'key',
    coalesce(v_new, v_old) ->> 'sku'
  );

  insert into public.action_log (actor, action, target_table, target_id, payload)
  values (public.twinos_actor(), lower(tg_op), tg_table_name, v_target, v_payload);
  return null;
end;
$$;

revoke execute on function public.trg_action_log() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['content_variants', 'publish_jobs', 'approvals', 'invite_links', 'products', 'settings', 'mod_rules'] loop
    execute format('drop trigger if exists trg_action_log on public.%I', t);
    execute format('create trigger trg_action_log after insert or update or delete on public.%I for each row execute function public.trg_action_log()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at on every table that has the column
-- ---------------------------------------------------------------------------
create or replace function public.trg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.trg_set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- content_variants guards (§9.C.16, §9.E.31, §9.N.108, §9.O.111–112)
--  1. requires_approval forced on when claim_flags is non-empty or the post
--     type is one Jack must approve.
--  2. status → approved only when approved_by is the jack role (and the
--     writer is jack, or the service role acting for Jack's tap).
--  3. status → scheduled / publishing / published blocked for result and
--     scorecard posts without board_refs, for any unresolved [NEEDED] field,
--     and for anything that requires approval but has none.
-- ---------------------------------------------------------------------------
create or replace function public.trg_content_variant_guard()
returns trigger
language plpgsql
as $$
declare
  v_post_type public.post_type;
  v_actor text := public.twinos_actor();
  v_status_changed boolean;
begin
  select post_type into v_post_type from public.content_items where id = new.item_id;

  -- 1. approval required by claims or by post type
  if cardinality(new.claim_flags) > 0
     or v_post_type in ('gold_map', 'signal', 'result', 'scorecard', 'offer', 'member_result', 'outlook') then
    new.requires_approval := true;
  end if;

  v_status_changed := (tg_op = 'INSERT') or (old.status is distinct from new.status);

  if tg_op = 'UPDATE' and old.status = 'published' and new.status <> 'published' then
    raise exception 'content_variants %: a published variant cannot change status (edit in place instead)', new.id
      using errcode = 'check_violation';
  end if;

  -- 2. approval gate
  if new.status = 'approved' and v_status_changed then
    if new.approved_by is distinct from 'jack' then
      raise exception 'content_variants %: status approved requires approved_by = jack', new.id
        using errcode = 'insufficient_privilege';
    end if;
    if v_actor not in ('jack', 'service_role', 'system') then
      raise exception 'content_variants %: role % may not approve (only jack)', new.id, v_actor
        using errcode = 'insufficient_privilege';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  -- approved_by/approved_at must be unset while the variant is still a draft
  if new.status in ('draft', 'pending_approval') then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  -- 3. publish gate
  if new.status in ('scheduled', 'publishing', 'published') and v_status_changed then
    if tg_op = 'UPDATE' and old.status in ('draft', 'pending_approval') and new.status in ('publishing', 'published') then
      raise exception 'content_variants %: cannot jump from % to %', new.id, old.status, new.status
        using errcode = 'check_violation';
    end if;
    if v_post_type in ('result', 'scorecard') and cardinality(new.board_refs) = 0 then
      raise exception 'content_variants %: % posts need board_refs (every number comes from the board)', new.id, v_post_type
        using errcode = 'check_violation';
    end if;
    if cardinality(new.needed_fields) > 0 then
      raise exception 'content_variants %: unresolved [NEEDED] fields: %', new.id, array_to_string(new.needed_fields, ', ')
        using errcode = 'check_violation';
    end if;
    if new.requires_approval and (new.approved_by is distinct from 'jack' or new.approved_at is null) then
      raise exception 'content_variants %: requires Jack''s approval before %', new.id, new.status
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_content_variant_guard on public.content_variants;
create trigger trg_content_variant_guard
  before insert or update on public.content_variants
  for each row execute function public.trg_content_variant_guard();

-- ---------------------------------------------------------------------------
-- approvals: only the jack role decides (§9.C.14, §11 "jack only")
-- ---------------------------------------------------------------------------
create or replace function public.trg_approval_guard()
returns trigger
language plpgsql
as $$
declare
  v_actor text := public.twinos_actor();
begin
  if new.decision is not null and (tg_op = 'INSERT' or old.decision is distinct from new.decision) then
    if new.decided_by is distinct from 'jack' then
      raise exception 'approvals %: decided_by must be jack', new.id using errcode = 'insufficient_privilege';
    end if;
    if v_actor not in ('jack', 'service_role', 'system') then
      raise exception 'approvals %: role % may not decide', new.id, v_actor using errcode = 'insufficient_privilege';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_approval_guard on public.approvals;
create trigger trg_approval_guard
  before insert or update on public.approvals
  for each row execute function public.trg_approval_guard();

-- ---------------------------------------------------------------------------
-- member_events → memberships fold (§9.H.63)
-- ---------------------------------------------------------------------------
create or replace function public.trg_fold_member_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.invite_links%rowtype;
begin
  if new.kind in ('join', 'approved') then
    select * into v_link from public.invite_links l
     where l.name = new.invite_link_name and (l.chat_id = new.chat_id) limit 1;
    insert into public.memberships (chat_id, user_id, joined_at, invite_link_name, source, campaign, partner)
    values (new.chat_id, new.user_id, new.occurred_at, new.invite_link_name, v_link.source, v_link.campaign, v_link.partner)
    on conflict (chat_id, user_id, joined_at) do nothing;
  elsif new.kind in ('leave', 'kick', 'ban') then
    update public.memberships m
       set left_at = new.occurred_at,
           status = case new.kind when 'leave' then 'left' when 'kick' then 'kicked' else 'banned' end,
           updated_at = now()
     where m.chat_id = new.chat_id and m.user_id = new.user_id and m.left_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_fold_member_event() from public, anon, authenticated;

drop trigger if exists trg_fold_member_event on public.member_events;
create trigger trg_fold_member_event
  after insert on public.member_events
  for each row execute function public.trg_fold_member_event();
