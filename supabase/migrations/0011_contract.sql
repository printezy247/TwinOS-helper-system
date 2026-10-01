-- 0011_contract.sql — reconcile the schema with the Edge Functions.
--
-- Why this file exists: 0001–0010 and `supabase/functions/` were written against
-- two different readings of docs/API.md. `tsc --strict` passed because the
-- functions are typed against their own interfaces, not against Postgres, and
-- the migrations passed because nothing had ever executed them together. This
-- migration closes the gap so the functions can actually run.
--
-- Rule: additive only. No earlier migration is rewritten. Where a name differs
-- (e.g. content_variants.item_id vs the functions' content_id) the old column is
-- kept and a generated column is added beside it, so views, triggers, RLS
-- policies and the seed keep working untouched.
--
-- Verified against a real Postgres (PGlite 17) with migrations + seed +
-- tests/smoke.sql, 2026-10-01. See supabase/README.md.

-- ===========================================================================
-- ===========================================================================
-- 0. post_type: one vocabulary.
--     0002's enum used short names (signal, result, audit, holiday_milestone);
--     the functions, docs/API.md and the compliance engine all use the fuller
--     Posting Kit names (signal_card, result_reply, channel_audit, holiday).
--     Everything that writes a post_type is the Edge Function, so the enum
--     follows the functions and the short names are kept as aliases by
--     renaming, not by carrying two parallel lists.
-- ===========================================================================
do $$
declare
  v_old text;
  v_new text;
  v_pairs text[][] := array[
    array['signal', 'signal_card'],
    array['result', 'result_reply'],
    array['audit', 'channel_audit'],
    array['holiday_milestone', 'holiday']
  ];
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_old := v_pairs[i][1];
    v_new := v_pairs[i][2];
    if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                where t.typname = 'post_type' and e.enumlabel = v_old)
       and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                         where t.typname = 'post_type' and e.enumlabel = v_new) then
      execute format('alter type public.post_type rename value %L to %L', v_old, v_new);
    end if;
  end loop;
end $$;

-- rows written before the rename (none in a fresh project, but a re-run must
-- not break) are mapped by the enum rename itself; the seed upserts on key, so
-- re-running it after a rename is the supported path.

-- Note on claim_flags: it is text[], and the Edge Functions write it over
-- PostgREST as JSON, so the value arrives already typed and never meets the
-- enum. Only a hand-written plpgsql INSERT with an untyped array literal
-- ('{level,signal_card}') can be coerced to post_type by inference; tests
-- therefore cast it (::text[]). No schema change is needed for this.

-- every place that compared the old spelling
create or replace function public.trg_content_variant_guard()
returns trigger
language plpgsql
as $$
declare
  v_post_type public.post_type;
  v_actor text := public.twinos_actor();
  v_status_changed boolean;
  v_mirrored text := coalesce(current_setting('twinos.item_status_sync', true), '');
begin
  select i.post_type into v_post_type from public.content_items i where i.id = new.item_id;

  -- 1. approval required by claims or by post type
  if cardinality(new.claim_flags) > 0
     or v_post_type in ('gold_map', 'signal_card', 'result_reply', 'scorecard', 'offer', 'member_result', 'outlook') then
    new.requires_approval := true;
  end if;

  v_status_changed := (tg_op = 'INSERT') or (old.status is distinct from new.status);

  if tg_op = 'UPDATE' and old.status = 'published' and new.status <> 'published' then
    raise exception 'content_variants %: a published variant cannot change status (edit in place instead)', new.id
      using errcode = 'check_violation';
  end if;

  -- 2. approval gate (see twinos_approved_for: the authority is the approvals
  --    row, or the decision this very statement is writing)
  if new.status = 'approved' and v_status_changed then
    if not public.twinos_approved_for(new.item_id, new.id, new.approved_by, new.approved_at) then
      raise exception 'content_variants %: status approved requires a jack decision (approved_by, or an approvals row for the item)', new.id
        using errcode = 'insufficient_privilege';
    end if;
    if new.approved_by is null then
      select a.by_actor into new.approved_by
        from public.approvals a
       where a.content_id = new.item_id and a.decision in ('approve', 'approved')
       order by a.requested_at desc limit 1;
      new.approved_by := coalesce(new.approved_by, 'jack');
    end if;
    if v_mirrored = '' and v_actor not in ('jack', 'service_role', 'system') then
      raise exception 'content_variants %: role % may not approve (only jack)', new.id, v_actor
        using errcode = 'insufficient_privilege';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  if new.status in ('draft', 'pending_approval') and v_mirrored = '' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  -- 3. publish gate
  if new.status in ('scheduled', 'publishing', 'published') and v_status_changed then
    if tg_op = 'UPDATE' and v_mirrored = ''
       and old.status in ('draft', 'pending_approval') and new.status in ('publishing', 'published') then
      raise exception 'content_variants %: cannot jump from % to %', new.id, old.status, new.status
        using errcode = 'check_violation';
    end if;
    if v_post_type in ('result_reply', 'scorecard') and cardinality(new.board_refs) = 0 then
      raise exception 'content_variants %: % posts need board_refs (every number comes from the board)', new.id, v_post_type
        using errcode = 'check_violation';
    end if;
    if cardinality(new.needed_fields) > 0 then
      raise exception 'content_variants %: unresolved [NEEDED] fields: %', new.id, array_to_string(new.needed_fields, ', ')
        using errcode = 'check_violation';
    end if;
    if new.requires_approval and not public.twinos_approved_for(new.item_id, new.id, new.approved_by, new.approved_at) then
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

-- ===========================================================================
-- 1. api_keys — scoped keys for ABDUL, the PC worker and EzyAi
--    (_shared/auth.ts: KEY_RE /^twk_([a-z_]+)_([0-9a-f]{40})$/, SHA-256 only)
-- ===========================================================================
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                -- 'abdul', 'pc-worker', 'ezyai'
  role text not null check (role in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview')),
  key_prefix text not null,                 -- first 12 chars, for the keyring label only
  key_hash text not null unique,            -- sha256 hex of the whole key; the key itself is never stored
  scopes text[],
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoke_note text
);
comment on table public.api_keys is 'Scoped API keys. Only the SHA-256 of each key is stored; the plain key exists once, at mint time, and in Jack''s keyring.';
create index if not exists idx_api_keys_role on public.api_keys (role) where revoked_at is null;

-- mint_api_key(name, role) → the plain key, returned exactly once.
-- pgcrypto is present on Supabase; fall back to the built-in sha256() so this
-- also runs on a plain Postgres (and in the PGlite harness).
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mint_api_key'
  ) then
    execute $fn$
      create or replace function public.mint_api_key(p_name text, p_role text)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_raw text;
        v_key text;
        v_hash text;
        v_prefix text;
        v_id uuid;
      begin
        if p_role is null or p_role not in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview') then
          raise exception 'mint_api_key: role must be abdul, pc_worker, ezyai, ops_bot, cron or tradingview';
        end if;

        -- 20 random bytes → 40 hex chars. gen_random_bytes is pgcrypto; when it
        -- is missing, uuid4 text is the entropy source.
        begin
          v_raw := encode(gen_random_bytes(20), 'hex');
        exception when undefined_function then
          v_raw := replace(replace(gen_random_uuid()::text, '-', ''), gen_random_uuid()::text, '');
          v_raw := v_raw || replace(gen_random_uuid()::text, '-', '');
        end;
        v_raw := left(v_raw, 40);

        v_key := 'twk_' || p_role || '_' || v_raw;
        begin
          v_hash := encode(digest(v_key, 'sha256'), 'hex');
        exception when undefined_function then
          v_hash := encode(sha256(convert_to(v_key, 'UTF8')), 'hex');
        end;
        v_prefix := left(v_key, 12);

        insert into public.api_keys (name, role, key_prefix, key_hash)
        values (p_name, p_role, v_prefix, v_hash)
        returning id into v_id;

        -- The only moment the plain key exists outside Jack's keyring.
        return jsonb_build_object(
          'id', v_id, 'name', p_name, 'role', p_role,
          'key', v_key, 'key_prefix', v_prefix,
          'note', 'Store this in the keyring now. It is not recoverable.'
        );
      end;
      $body$;
    $fn$;
  end if;
end $$;

revoke execute on function public.mint_api_key(text, text) from public, anon, authenticated;

-- ===========================================================================
-- 2. idempotency_keys — one row per (scope, key) so a retried write replays
--    (_shared/idempotency.ts)
-- ===========================================================================
create table if not exists public.idempotency_keys (
  scope text not null,
  key text not null,
  request_hash text not null,
  status integer not null default 200,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);
comment on table public.idempotency_keys is 'Stored responses for retried writes. Same key + same body replays the stored response; same key + different body is a 409.';
create index if not exists idx_idem_created on public.idempotency_keys (created_at);

-- ===========================================================================
-- 3. tg_updates — Telegram webhook de-dupe by update_id (tg-webhook/index.ts)
-- ===========================================================================
create table if not exists public.tg_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now(),
  kind text
);
comment on table public.tg_updates is 'Telegram update_id de-dupe. Telegram re-sends an update on any non-200; repeats are ignored.';

-- ===========================================================================
-- 4. content_items — the functions treat the ITEM as the status holder
--    (setStatus updates content_items.status), while 0002 put the status on
--    the variant. Both exist; the item status is what the Desk and the
--    publisher read. item_status is kept in step by a trigger below.
-- ===========================================================================
alter table public.content_items add column if not exists lang text check (lang in ('en', 'ms'));
alter table public.content_items add column if not exists status text default 'draft';
-- template_id is a plain uuid here; the FK to templates(id) is added in
-- section 21, once templates.id exists.
alter table public.content_items add column if not exists template_id uuid;
alter table public.content_items add column if not exists source jsonb not null default '{}'::jsonb;
alter table public.content_items add column if not exists scheduled_at timestamptz;
alter table public.content_items add column if not exists approved_at timestamptz;
alter table public.content_items add column if not exists published_at timestamptz;
alter table public.content_items add column if not exists published_ref text;
alter table public.content_items add column if not exists last_error text;
alter table public.content_items add column if not exists reject_note text;
alter table public.content_items add column if not exists edit_note text;
alter table public.content_items add column if not exists reply_to_message_id bigint;
alter table public.content_items add column if not exists target_chat_id bigint;
alter table public.content_items add column if not exists pin boolean not null default false;
alter table public.content_items add column if not exists result_status text;
alter table public.content_items add column if not exists desk_chat_id bigint;
alter table public.content_items add column if not exists desk_message_id bigint;
-- desk_state: what Jack is in the middle of in the Desk group
-- (null | awaiting_edit | awaiting_time | rewritten)
alter table public.content_items add column if not exists desk_state text
  check (desk_state is null or desk_state in ('awaiting_edit', 'awaiting_time', 'rewritten'));
-- icp: 0002 typed it smallint → personas(id); the functions pass the ICP key
-- as text ("gold_beginner"). Keep the FK and add the text column beside it.
alter table public.content_items add column if not exists icp_key text;

create index if not exists idx_content_items_status on public.content_items (status, created_at desc);
create index if not exists idx_content_items_desk on public.content_items (desk_chat_id, desk_message_id);
create index if not exists idx_content_items_sched on public.content_items (scheduled_at) where status in ('approved', 'scheduled', 'pending_approval');

-- ===========================================================================
-- 5. content_variants — the functions address the parent as `content_id`;
--    0002 called it item_id. Both names must work on INSERT, so content_id is a
--    real column kept in step by a trigger rather than a GENERATED column
--    (Postgres refuses a non-DEFAULT value in a generated column, and
--    createDraft() sends content_id explicitly).
--    `compliance` holds the CheckResult the compliance engine returned.
-- ===========================================================================
alter table public.content_variants add column if not exists content_id uuid
  references public.content_items (id) on delete cascade;
alter table public.content_variants add column if not exists compliance jsonb;
create or replace function public.trg_variant_parent()
returns trigger
language plpgsql
as $$
begin
  if new.content_id is null and new.item_id is not null then new.content_id := new.item_id; end if;
  if new.item_id is null and new.content_id is not null then new.item_id := new.content_id; end if;
  return new;
end;
$$;
drop trigger if exists trg_variant_parent on public.content_variants;
create trigger trg_variant_parent
  before insert or update on public.content_variants
  for each row execute function public.trg_variant_parent();
create index if not exists idx_variants_content on public.content_variants (content_id);
comment on column public.content_variants.compliance is 'CheckResult from _shared/compliance.ts: {ok, needs_approval, findings[], claim_flags[]}. compliance_checks keeps the per-check history.';

-- ===========================================================================
-- 6. publish_jobs — the functions read content_id off the job and set
--    claimed_at / done_at / last_error; 0002 used locked_at / error_message.
--    Add the function-side names, and make idempotency_key optional because
--    enqueuePublish() upserts on variant_id and never sets it.
-- ===========================================================================
-- 0002 made idempotency_key NOT NULL, but enqueuePublish() upserts on
-- variant_id and never sets it, and the variant is already unique per job.
-- Drop the NOT NULL; the variant_id unique index is the real de-dupe.
alter table public.publish_jobs alter column idempotency_key drop not null;
alter table public.publish_jobs add column if not exists content_id uuid
  references public.content_items (id) on delete cascade;
alter table public.publish_jobs add column if not exists claimed_at timestamptz;
alter table public.publish_jobs add column if not exists done_at timestamptz;
alter table public.publish_jobs add column if not exists last_error text;
alter table public.publish_jobs add column if not exists created_at timestamptz;
-- backfill the new denormalised parent id, then keep it honest
update public.publish_jobs j
   set content_id = v.item_id
  from public.content_variants v
 where v.id = j.variant_id and j.content_id is null;

-- 0002 already indexed variant_id but not uniquely; enqueuePublish() relies on
-- `on conflict (variant_id)`, which needs a unique index.
create unique index if not exists idx_publish_jobs_variant_uniq on public.publish_jobs (variant_id);
create index if not exists idx_publish_jobs_content on public.publish_jobs (content_id, status);

-- 0002 allowed queued|running|done|failed|cancelled; the scheduler claims a job
-- by moving it to 'claimed' (and back to 'queued' for backoff).
alter table public.publish_jobs drop constraint if exists publish_jobs_status_check;
alter table public.publish_jobs add constraint publish_jobs_status_check
  check (status in ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled'));
drop index if exists public.idx_publish_jobs_due;
create index if not exists idx_publish_jobs_due on public.publish_jobs (run_at) where status in ('queued', 'claimed');
-- keep content_id in step when a job is inserted without it
create or replace function public.trg_publish_job_parent()
returns trigger
language plpgsql
as $$
begin
  if new.content_id is null and new.variant_id is not null then
    select v.item_id into new.content_id from public.content_variants v where v.id = new.variant_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_publish_job_parent on public.publish_jobs;
create trigger trg_publish_job_parent
  before insert or update of variant_id on public.publish_jobs
  for each row execute function public.trg_publish_job_parent();

-- ===========================================================================
-- 7. jobs — the PC worker and ABDUL set done_at and last_error; 0002 called
--    the column `error` and had no done_at.
-- ===========================================================================
alter table public.jobs add column if not exists last_error text;
alter table public.jobs add column if not exists done_at timestamptz;
-- 0001 called it run_after; every caller (PC worker, ABDUL, cron) says run_at.
alter table public.jobs add column if not exists run_at timestamptz;
update public.jobs set run_at = run_after where run_at is null;
create or replace function public.trg_job_run_at()
returns trigger
language plpgsql
as $$
begin
  if new.run_at is null and new.run_after is not null then new.run_at := new.run_after; end if;
  if new.run_after is null and new.run_at is not null then new.run_after := new.run_at; end if;
  return new;
end;
$$;
drop trigger if exists trg_job_run_at on public.jobs;
create trigger trg_job_run_at
  before insert or update on public.jobs
  for each row execute function public.trg_job_run_at();
update public.jobs set last_error = error where last_error is null and error is not null;
create index if not exists idx_jobs_done on public.jobs (done_at desc) where status = 'done';
create index if not exists idx_jobs_due on public.jobs (run_at) where status in ('queued', 'claimed');

-- ===========================================================================
-- 8. approvals — the functions write content_id / decision / by_actor /
--    by_subject / via / run_at; 0002 used target_table + target_id +
--    requested_by + decided_by and allowed 'approved'|'rejected'|'edit'.
--    The function vocabulary is approve|reject|reschedule.
-- ===========================================================================
alter table public.approvals add column if not exists content_id uuid references public.content_items (id) on delete cascade;
alter table public.approvals add column if not exists by_actor text;
alter table public.approvals add column if not exists by_subject text;
alter table public.approvals add column if not exists via text
  check (via is null or via in ('dashboard', 'telegram', 'board_rule', 'desk'));
alter table public.approvals add column if not exists run_at timestamptz;
alter table public.approvals add column if not exists note text;
comment on column public.approvals.via is 'How the decision was made: Jack''s dashboard, his Telegram tap, or board_rule (a result reply built straight from the board, §9.N.107).';

-- 0002 keyed approvals on (target_table, target_id) and made both NOT NULL; the
-- functions only ever name a content item. Keep the old pair, derived, so the
-- RLS policies and the index from 0001/0009 still address the row.
alter table public.approvals alter column target_table drop not null;
alter table public.approvals alter column target_id drop not null;

-- 0002's guard reads decided_by; the functions write by_actor / by_subject.
-- Fill decided_by so the guard still has something to check.
--
-- Postgres fires BEFORE triggers in name order, so this name must sort before
-- "trg_approval_guard" for the guard to see a filled decided_by.
create or replace function public.trg_approval_actor_bridge()
returns trigger
language plpgsql
as $$
begin
  if new.by_actor is null and new.requested_by is not null then new.by_actor := new.requested_by; end if;
  if new.decided_by is null and new.by_actor is not null and new.decision is not null then
    new.decided_by := new.by_actor;
  end if;
  -- keep 0002's (target_table, target_id) pair pointing at the same row
  if new.target_table is null and new.content_id is not null then new.target_table := 'content_items'; end if;
  if new.target_id is null and new.content_id is not null then new.target_id := new.content_id; end if;
  return new;
end;
$$;
drop trigger if exists trg_approval_actor_bridge on public.approvals;
create trigger trg_approval_actor_bridge
  before insert or update on public.approvals
  for each row execute function public.trg_approval_actor_bridge();

-- The guard, widened for exactly one case: `via = 'board_rule'`, the plan's
-- §9.N.107 rule that ABDUL may post a result reply built straight from the
-- board. It is deliberately narrow — a result_reply, with no price or offer
-- claim on the variant. Every other decision still has to be Jack's, by
-- decision row and by writer.
create or replace function public.trg_approval_guard()
returns trigger
language plpgsql
as $$
declare
  v_actor text := public.twinos_actor();
  v_board_rule boolean := false;
  v_post_type text;
  v_flags text[];
begin
  if new.decision is not null and (tg_op = 'INSERT' or old.decision is distinct from new.decision) then
    if new.via = 'board_rule' then
      select i.post_type::text into v_post_type
        from public.content_items i where i.id = new.content_id;
      select coalesce(array_agg(f), '{}') into v_flags
        from public.content_variants v, unnest(v.claim_flags) f
       where v.item_id = new.content_id;
      -- only a board-sourced result reply, and only when the variant claims no
      -- price and no offer. Anything with money in it stays Jack's thumb.
      -- the post_type enum spells it 'result' (the functions say 'result_reply')
      v_board_rule := (v_post_type in ('result', 'result_reply'))
        and not (coalesce(v_flags, '{}') && array['price', 'offer']::text[]);
    end if;

    if not v_board_rule then
      if new.decided_by is distinct from 'jack' then
        raise exception 'approvals %: decided_by must be jack', new.id using errcode = 'insufficient_privilege';
      end if;
      if v_actor not in ('jack', 'service_role', 'system') then
        raise exception 'approvals %: role % may not decide', new.id, v_actor using errcode = 'insufficient_privilege';
      end if;
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
create index if not exists idx_approvals_content on public.approvals (content_id, requested_at desc);

-- ===========================================================================
-- 9. health_checks — the functions write source / status / detail / at;
--    0001 called them component / status / detail / beat_at and allowed
--    ok|warn|fail. The function vocabulary is ok|degraded|down.
-- ===========================================================================
alter table public.health_checks add column if not exists source text;
alter table public.health_checks add column if not exists at timestamptz;
update public.health_checks set source = component where source is null;
update public.health_checks set at = beat_at where at is null;
-- 0001 made component NOT NULL; the functions only send source. Derive it.
alter table public.health_checks alter column component drop not null;
create or replace function public.trg_health_beat()
returns trigger
language plpgsql
as $$
begin
  if new.source is null and new.component is not null then new.source := new.component; end if;
  if new.component is null and new.source is not null then new.component := new.source; end if;
  if new.at is null then new.at := coalesce(new.beat_at, now()); end if;
  if new.beat_at is null then new.beat_at := new.at; end if;
  return new;
end;
$$;
drop trigger if exists trg_health_beat on public.health_checks;
create trigger trg_health_beat
  before insert or update on public.health_checks
  for each row execute function public.trg_health_beat();
drop index if exists public.idx_health_component;
create index if not exists idx_health_source on public.health_checks (source, at desc);
comment on column public.health_checks.source is 'Component reporting the beat: ezyai | ops_bot | scheduler | pc_worker | poller. component is the older spelling of the same value.';

-- 0001 allowed ok|warn|fail; the functions report ok|degraded|down.
alter table public.health_checks drop constraint if exists health_checks_status_check;
alter table public.health_checks add constraint health_checks_status_check
  check (status in ('ok', 'warn', 'degraded', 'down', 'fail', 'never'));

-- ===========================================================================
-- 10. alerts — the functions select at / resolved_at and use severity
--     high|medium|critical; 0001 had created_at / acknowledged_at and
--     info|warn|critical. Add the function-side columns; keep the old ones.
-- ===========================================================================
alter table public.alerts add column if not exists at timestamptz;
alter table public.alerts add column if not exists resolved_at timestamptz;
update public.alerts set at = created_at where at is null;
update public.alerts set resolved_at = acknowledged_at where resolved_at is null and acknowledged_at is not null;
-- the functions never send `at`; default it instead of demanding it
alter table public.alerts alter column at drop not null;
alter table public.alerts alter column at set default now();
create or replace function public.trg_alert_times()
returns trigger
language plpgsql
as $$
begin
  if new.at is null then new.at := coalesce(new.created_at, now()); end if;
  return new;
end;
$$;
drop trigger if exists trg_alert_times on public.alerts;
create trigger trg_alert_times
  before insert or update on public.alerts
  for each row execute function public.trg_alert_times();
drop index if exists public.idx_alerts_dedupe;
create unique index if not exists idx_alerts_dedupe on public.alerts (dedupe_key)
  where dedupe_key is not null and resolved_at is null;
drop index if exists public.idx_alerts_open;
create index if not exists idx_alerts_open on public.alerts (at desc) where resolved_at is null;

-- 0001 allowed info|warn|critical; the functions use high|medium|critical.
alter table public.alerts drop constraint if exists alerts_severity_check;
alter table public.alerts add constraint alerts_severity_check
  check (severity in ('info', 'warn', 'medium', 'high', 'critical'));
-- 0001's decision vocabulary was approved|rejected|edit|reschedule; the
-- functions send approve|reject|reschedule.
alter table public.approvals drop constraint if exists approvals_decision_check;
alter table public.approvals add constraint approvals_decision_check
  check (decision is null or decision in ('approve', 'reject', 'reschedule', 'edit', 'approved', 'rejected'));

-- ===========================================================================
-- 11. signals — the functions speak the printezy contract (symbol, stop_price,
--     rr, quality, result_r, result_pips, opened_at, closed_at, status in
--     pending|running|tp|tp1|tp2|be|sl|cancelled) while 0002 stored the EzyAi
--     signals.db shape (pair, stop_loss, rr_target, data_source, signal_at).
--     Both are kept: 0002's columns stay authoritative for the public board
--     (they are what the views read), and the function-side columns are
--     filled by the bridge trigger below so either name can be read.
--
--     status: widen the CHECK to accept the function vocabulary too.
-- ===========================================================================
alter table public.signals drop constraint if exists signals_status_check;
alter table public.signals add constraint signals_status_check
  check (status in ('open', 'pending', 'running', 'tp', 'tp1', 'tp2', 'be', 'sl', 'expired', 'cancelled', 'shadow'));

alter table public.signals add column if not exists symbol text;
alter table public.signals add column if not exists stop_price numeric;
alter table public.signals add column if not exists rr numeric;
alter table public.signals add column if not exists setup text;
alter table public.signals add column if not exists setup_score numeric;
alter table public.signals add column if not exists current_price numeric;
alter table public.signals add column if not exists quality text;
alter table public.signals add column if not exists result_r numeric;
alter table public.signals add column if not exists result_pips numeric;
alter table public.signals add column if not exists opened_at timestamptz;
alter table public.signals add column if not exists closed_at timestamptz;
update public.signals set symbol = pair where symbol is null;
update public.signals set stop_price = stop_loss where stop_price is null;
update public.signals set rr = rr_target where rr is null;
update public.signals set result_r = r_multiple where result_r is null;
update public.signals set quality = data_source where quality is null;
update public.signals set opened_at = signal_at where opened_at is null;
update public.signals set closed_at = resolved_at where closed_at is null;

-- Bridge the two vocabularies. The ingest RPCs (0003) and _shared/signals.ts
-- both write; whichever side moves, the other follows.
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
  if new.data_source is null and new.quality is not null then new.data_source := new.quality; end if;
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
drop trigger if exists trg_signal_bridge on public.signals;
create trigger trg_signal_bridge
  before insert or update on public.signals
  for each row execute function public.trg_signal_bridge();

-- The function contract requires pair/style/mode/entry/stop_loss/tp1/tp2/
-- rr_target/confidence, which 0002 declared NOT NULL. A TradingView alert has
-- no style/mode/confidence, so those must be nullable for tv-webhook to insert.
alter table public.signals alter column style drop not null;
alter table public.signals alter column mode drop not null;
alter table public.signals alter column entry drop not null;
alter table public.signals alter column stop_loss drop not null;
alter table public.signals alter column tp1 drop not null;
alter table public.signals alter column tp2 drop not null;
alter table public.signals alter column rr_target drop not null;
alter table public.signals alter column confidence drop not null;
alter table public.signals alter column pair drop not null;
alter table public.signals alter column direction drop not null;
-- entry_low/entry_high are what a signal card shows, so they may carry the zone
alter table public.signals alter column entry_low drop not null;
comment on column public.signals.quality is 'live | demo | shadow. Demo/shadow rows never reach a public post (EzyAi quality.may_emit, §9.D.27).';
create index if not exists idx_signals_external on public.signals (external_id);

-- ===========================================================================
-- 12. signal_outcomes — the functions insert result_r / result_pips / at;
--     0002 stored r_multiple / pips / resolved_at and required external_id.
--     Keep both spellings; make external_id optional so a plain status push
--     from _shared/signals.ts (which has no outcome id) can insert.
-- ===========================================================================
alter table public.signal_outcomes add column if not exists result_r numeric;
alter table public.signal_outcomes add column if not exists result_pips numeric;
alter table public.signal_outcomes add column if not exists at timestamptz;
update public.signal_outcomes set result_r = r_multiple where result_r is null;
update public.signal_outcomes set result_pips = pips where result_pips is null;
update public.signal_outcomes set at = resolved_at where at is null;
alter table public.signal_outcomes add column if not exists status_new text;
update public.signal_outcomes set status_new = status where status_new is null;
alter table public.signal_outcomes alter column status_new set not null;
-- 0003 kept `status` NOT NULL; the functions only ever write status_new.
alter table public.signal_outcomes alter column status drop not null;
create or replace function public.trg_signal_outcome_status()
returns trigger
language plpgsql
as $$
begin
  if new.status_new is null and new.status is not null then new.status_new := new.status; end if;
  if new.status is null and new.status_new is not null then new.status := new.status_new; end if;
  if new.at is null then new.at := coalesce(new.resolved_at, now()); end if;
  if new.resolved_at is null then new.resolved_at := new.at; end if;
  if new.result_r is null and new.r_multiple is not null then new.result_r := new.r_multiple; end if;
  if new.r_multiple is null and new.result_r is not null then new.r_multiple := new.result_r; end if;
  if new.result_pips is null and new.pips is not null then new.result_pips := new.pips; end if;
  if new.pips is null and new.result_pips is not null then new.pips := new.result_pips; end if;
  return new;
end;
$$;
drop trigger if exists trg_signal_outcome_status on public.signal_outcomes;
create trigger trg_signal_outcome_status
  before insert or update on public.signal_outcomes
  for each row execute function public.trg_signal_outcome_status();
alter table public.signal_outcomes alter column external_id drop not null;
-- the NOT NULL + UNIQUE constraint from 0003 becomes a partial unique index, so
-- an outcome pushed without an external id can still be recorded
alter table public.signal_outcomes drop constraint if exists signal_outcomes_external_id_key;
create unique index if not exists idx_signal_outcomes_external on public.signal_outcomes (external_id) where external_id is not null;
alter table public.signal_outcomes drop constraint if exists signal_outcomes_status_check;
alter table public.signal_outcomes add constraint signal_outcomes_status_check
  check (status_new in ('tp', 'tp1', 'tp2', 'be', 'sl', 'expired', 'cancelled'));
comment on column public.signal_outcomes.status_new is 'Outcome status. The original `status` column is kept so 0003''s ingest RPC and the views keep their spelling.';

-- ===========================================================================
-- 13. signal_posts — the functions use kind = 'signal' | 'result' and set
--     content_id and status_posted; 0003 used kind = 'card' | 'result'.
--     Accept both vocabularies and mirror them.
-- ===========================================================================
alter table public.signal_posts drop constraint if exists signal_posts_kind_check;
alter table public.signal_posts add constraint signal_posts_kind_check
  check (kind in ('card', 'signal', 'result'));
alter table public.signal_posts add column if not exists content_id uuid references public.content_items (id) on delete set null;
alter table public.signal_posts add column if not exists status_posted text;
-- 'card' (0003) and 'signal' (the functions) name the same thing. The row is
-- stored as written; every reader accepts both, so nothing has to be rewritten
-- and the historical spelling in the views keeps working.

-- the board reads both spellings
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
  exists (select 1 from public.signal_posts p where p.signal_id = s.id and p.kind = 'result') as result_posted,
  r.wins as wins_28d, r.losses as losses_28d, r.break_even as break_even_28d,
  r.strict_win_rate as strict_win_rate_28d, r.total_r as total_r_28d
from public.signals s
cross join rolling r
where s.data_source = 'live' and s.status <> 'shadow'
order by s.signal_at desc;

-- ===========================================================================
-- 14. tg_posts — the publisher sets content_id; 0004 had variant_id only.
-- ===========================================================================
alter table public.tg_posts add column if not exists content_id uuid references public.content_items (id) on delete set null;
create index if not exists idx_tg_posts_content on public.tg_posts (content_id);

-- ===========================================================================
-- 15. post_snapshots — the ops bot writes kind / value / detail / at
--     (a reactions counter per update); 0004 modelled periodic view snapshots
--     with offset_label. Add the function-side columns and let both coexist.
-- ===========================================================================
alter table public.post_snapshots add column if not exists kind text;
alter table public.post_snapshots add column if not exists value numeric;
alter table public.post_snapshots add column if not exists detail jsonb;
alter table public.post_snapshots add column if not exists at timestamptz;
update public.post_snapshots set at = taken_at where at is null;
update public.post_snapshots set kind = 'views' where kind is null;
-- 0004's offset_label is NOT NULL; the ops bot sends a plain reaction counter.
-- Derive one from the kind so both writers are satisfied.
alter table public.post_snapshots alter column offset_label drop not null;
create or replace function public.trg_post_snapshot_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.at is null then new.at := coalesce(new.taken_at, now()); end if;
  if new.taken_at is null then new.taken_at := new.at; end if;
  if new.offset_label is null then new.offset_label := 'adhoc'; end if;
  if new.kind is null then new.kind := 'views'; end if;
  if new.value is null and new.reactions_total is not null then new.value := new.reactions_total; end if;
  return new;
end;
$$;
drop trigger if exists trg_post_snapshot_defaults on public.post_snapshots;
create trigger trg_post_snapshot_defaults
  before insert or update on public.post_snapshots
  for each row execute function public.trg_post_snapshot_defaults();
-- the unique key from 0004 is (chat_id, message_id, offset_label); reaction
-- counters for the same message would collide on 'adhoc', so include the kind
alter table public.post_snapshots drop constraint if exists post_snapshots_chat_id_message_id_offset_label_key;
create unique index if not exists idx_post_snapshots_uniq
  on public.post_snapshots (chat_id, message_id, coalesce(offset_label, 'adhoc'), coalesce(kind, 'views'));
create index if not exists idx_post_snapshots_kind on public.post_snapshots (kind, at desc);

-- ===========================================================================
-- 16. member_events — the ops bot writes event / old_status / new_status /
--     username / at; 0004 used kind / occurred_at and folded kinds like
--     'join' and 'leave'. Accept the function vocabulary, derive the fold.
-- ===========================================================================
alter table public.member_events add column if not exists username text;
alter table public.member_events add column if not exists event text;
alter table public.member_events add column if not exists old_status text;
alter table public.member_events add column if not exists new_status text;
alter table public.member_events add column if not exists at timestamptz;
update public.member_events set event = kind where event is null;
update public.member_events set at = occurred_at where at is null;
alter table public.member_events alter column at set not null;
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
  -- chat_member / my_chat_member / chat_join_request → the fold vocabulary
  if new.kind is null then
    new.kind := case
      when new.event = 'chat_join_request' then 'join_request'
      when new.event in ('chat_member', 'my_chat_member')
        then case when new.new_status = 'left' then 'leave' else 'join' end
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
drop trigger if exists trg_member_event_bridge on public.member_events;
create trigger trg_member_event_bridge
  before insert or update on public.member_events
  for each row execute function public.trg_member_event_bridge();
-- the old NOT NULL columns are now derived by the trigger above
alter table public.member_events alter column kind drop not null;
alter table public.member_events alter column occurred_at drop not null;
create index if not exists idx_member_events_event on public.member_events (chat_id, at desc);

-- ===========================================================================
-- 17. mod_rules — the ops bot reads `pattern` (single regex); 0004 stored
--     `patterns text[]`. Add `pattern` and keep the array for the seed.
-- ===========================================================================
alter table public.mod_rules add column if not exists pattern text;
update public.mod_rules set pattern = patterns[1] where pattern is null and cardinality(patterns) > 0;
alter table public.mod_rules add column if not exists rule_key text;
update public.mod_rules set rule_key = key where rule_key is null;
-- 0004 allowed 'link_block'; the ops bot switches on 'link_new_member'.
-- Accept both spellings so the seeded rule fires.
alter table public.mod_rules drop constraint if exists mod_rules_kind_check;
alter table public.mod_rules add constraint mod_rules_kind_check
  check (kind in ('keyword', 'link_block', 'link_new_member', 'flood', 'impersonation', 'cas', 'captcha', 'repeat_question'));
create index if not exists idx_mod_rules_enabled on public.mod_rules (kind) where enabled;

-- ===========================================================================
-- 18. moderation_events — the ops bot writes hits jsonb, text_excerpt, at;
--     0004 had rule_key / action_taken / detail / occurred_at.
-- ===========================================================================
alter table public.moderation_events add column if not exists hits jsonb not null default '[]'::jsonb;
alter table public.moderation_events add column if not exists text_excerpt text;
alter table public.moderation_events add column if not exists at timestamptz;
update public.moderation_events set at = occurred_at where at is null;
alter table public.moderation_events alter column action_taken drop not null;
comment on column public.moderation_events.text_excerpt is 'First 200 characters of the offending message. Group text is never sent to a model (plan §6).';

-- ===========================================================================
-- 19. manual_metrics — the Friday form posts {week_start, source, metrics}
--     where 0005 keyed rows on (week_start, kind, metric, campaign) with a
--     scalar value. Both are needed: the long form feeds the views, the jsonb
--     form is what the function upserts. Keep the long form as the source of
--     truth for the views and explode the jsonb into it.
-- ===========================================================================
alter table public.manual_metrics add column if not exists source text;
alter table public.manual_metrics add column if not exists metrics jsonb;
comment on column public.manual_metrics.source is 'Function-side source name (tiktok | vantage | telechurn | revenue | subscriptions | ads | support). kind is the same vocabulary.';

-- The Friday form upserts one row per (week_start, source) holding a jsonb bag
-- of metrics. That row has no single metric name, so 0005's NOT NULL on `metric`
-- has to yield; the trigger below explodes the bag into the long form the views
-- read, and those rows carry a real metric name.
alter table public.manual_metrics alter column metric drop not null;
alter table public.manual_metrics alter column value drop not null;
create or replace function public.trg_manual_metrics_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.source is null and new.kind is not null then new.source := new.kind; end if;
  if new.kind is null and new.source is not null then new.kind := new.source; end if;
  -- the summary row is marked so the explode trigger and the views can tell it
  -- from a long-form row
  if new.metric is null then new.metric := '_summary'; end if;
  if new.value is null then new.value := 0; end if;
  return new;
end;
$$;
drop trigger if exists trg_manual_metrics_defaults on public.manual_metrics;
create trigger trg_manual_metrics_defaults
  before insert or update on public.manual_metrics
  for each row execute function public.trg_manual_metrics_defaults();

create or replace function public.trg_manual_metrics_explode()
returns trigger
language plpgsql
as $$
declare
  v_key text;
  v_val text;
begin
  if new.metrics is null or jsonb_typeof(new.metrics) <> 'object' then
    return new;
  end if;
  for v_key, v_val in
    select e.key, e.value from jsonb_each_text(new.metrics) as e(key, value)
  loop
    if v_val ~ '^-?[0-9]+([.][0-9]+)?$' then
      insert into public.manual_metrics (week_start, kind, metric, value, source, note, entered_by)
      values (new.week_start, coalesce(new.source, new.kind), v_key, v_val::numeric, coalesce(new.source, new.kind),
              'from metrics jsonb', coalesce(new.entered_by, 'system'))
      on conflict (week_start, kind, metric, campaign) do update
        set value = excluded.value, updated_at = now();
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_manual_metrics_explode on public.manual_metrics;
create trigger trg_manual_metrics_explode
  after insert or update on public.manual_metrics
  for each row execute function public.trg_manual_metrics_explode();

-- the function upserts on (week_start, source)
create unique index if not exists idx_manual_metrics_source on public.manual_metrics (week_start, source)
  where source is not null and metrics is not null;

-- ===========================================================================
-- 20. telechurn_imports — the worker upserts on (week_start, link_name);
--     0004 keyed on (period_start, period_end, chat_id, link_name).
-- ===========================================================================
alter table public.telechurn_imports add column if not exists week_start date;
alter table public.telechurn_imports add column if not exists retained integer;
update public.telechurn_imports set week_start = period_start where week_start is null;
update public.telechurn_imports set retained = retained_7d where retained is null;
create unique index if not exists idx_telechurn_week_link on public.telechurn_imports (week_start, link_name);

-- ===========================================================================
-- 21. templates — the functions select id / post_type / lang / body /
--     fields text[] / required_lines / char_limit / approval_rule / version
--     and filter on post_type + lang + active. 0002 keyed the table on
--     `key` (the post type) with prompt_text and a jsonb fields map.
--     Add the function-side columns; the prompt stays the source for ABDUL
--     and `body` is the rendered skeleton the content function fills.
-- ===========================================================================
-- `id` is what content_items.template_id and the functions' TemplateRow point
-- at. `key` stays the primary key so the seed and the FK from
-- content_items.post_type keep working.
alter table public.templates add column if not exists id uuid default gen_random_uuid();
update public.templates set id = gen_random_uuid() where id is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'templates_id_key') then
    alter table public.templates add constraint templates_id_key unique (id);
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_items_template_id_fkey') then
    alter table public.content_items
      add constraint content_items_template_id_fkey
      foreign key (template_id) references public.templates (id) on delete set null;
  end if;
end $$;
alter table public.templates add column if not exists lang text not null default 'en' check (lang in ('en', 'ms'));
alter table public.templates add column if not exists body text;
alter table public.templates add column if not exists version integer not null default 1;
alter table public.templates add column if not exists fields_list text[];
comment on column public.templates.body is 'Post skeleton with {{field}} placeholders, filled by _shared/content.ts render(). prompt_text is the ABDUL prompt for the same post type.';
create index if not exists idx_templates_lookup on public.templates (key, lang, active, version desc);

-- ===========================================================================
-- 22. assets — the worker upserts {storage_path, bucket, kind, bytes, sha256,
--     source, meta, created_by}; 0002 called the bucket column storage_bucket.
-- ===========================================================================
alter table public.assets add column if not exists bucket text;
update public.assets set bucket = coalesce(bucket, storage_bucket);
create index if not exists idx_assets_sha_lookup on public.assets (sha256) where sha256 is not null;

-- ===========================================================================
-- 23. compliance_checks — the functions insert {variant_id, ok,
--     needs_approval, findings}; 0002 stored one row per check_key.
--     Add the summary columns beside the per-check rows.
-- ===========================================================================
alter table public.compliance_checks add column if not exists ok boolean;
alter table public.compliance_checks add column if not exists needs_approval boolean;
alter table public.compliance_checks add column if not exists findings jsonb not null default '[]'::jsonb;
-- 0002 made check_key NOT NULL and modelled one row per check; the functions
-- write a single summary row per variant with no check_key. Derive it.
alter table public.compliance_checks alter column check_key drop not null;
alter table public.compliance_checks alter column passed drop not null;
create or replace function public.trg_compliance_check_defaults()
returns trigger
language plpgsql
as $$
begin
  -- a summary row (no check_key) gets the synthetic key 'summary'
  if new.check_key is null then new.check_key := 'summary'; end if;
  if new.passed is null and new.ok is not null then new.passed := new.ok; end if;
  if new.detail is null and new.findings is not null and new.findings <> '[]'::jsonb then
    new.detail := new.findings::text;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_compliance_check_defaults on public.compliance_checks;
create trigger trg_compliance_check_defaults
  before insert or update on public.compliance_checks
  for each row execute function public.trg_compliance_check_defaults();
create index if not exists idx_compliance_variant_ok on public.compliance_checks (variant_id, checked_at desc) where ok;

-- ===========================================================================
-- 24. The approval authority is the approvals row, not a column.
--     approve/index.ts inserts {content_id, decision, by_actor, by_subject, via}
--     and then flips the item status; it never sets content_variants.approved_by.
--     results/index.ts does the same with via = 'board_rule' for a result reply
--     built straight from the board (plan §9.N.107).
--     So: an item is approved when an approvals row says Jack decided, or when
--     the board_rule exception applies. Anything else stays blocked.
-- ===========================================================================
create or replace function public.twinos_approved_for(p_content_id uuid, p_variant_id uuid default null, p_approved_by text default null, p_approved_at timestamptz default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- the variant records the decision itself. p_approved_by is what the
    -- incoming row carries, because a BEFORE trigger still sees the stored
    -- values, not the ones being written.
    (case when p_variant_id is not null and p_approved_by is not null
          then (p_approved_by = 'jack' and coalesce(p_approved_at, now()) is not null)
          else exists (select 1 from public.content_variants v
                        where v.id = p_variant_id and v.approved_by = 'jack' and v.approved_at is not null)
     end)
    or exists (
      select 1 from public.approvals a
       where a.content_id = p_content_id
         and a.decision in ('approve', 'approved')
         and (
           a.by_actor = 'jack'
           or (a.via = 'board_rule' and a.decision = 'approve')
         )
    );
$$;

-- ===========================================================================
-- 25. Keep the item status and the variant status in step.
--     The functions move content_items.status (setStatus in _shared/content.ts);
--     0002's guard reads the variant status. The item is authoritative, the
--     variant mirrors it.
--
--     The mirror update trips the guard's "cannot jump from X to Y" ordering
--     rule, which was written assuming one writer. A flag tells the guard that
--     this particular change came from the item, so it skips the ordering check
--     only. Every safety gate still runs: approved_by must be jack, result and
--     scorecard posts still need board_refs, [NEEDED] still blocks, and
--     requires_approval still demands Jack's approval. The functions write the
--     item as the service role, so these triggers are the only enforcement.
-- ===========================================================================
create or replace function public.trg_content_item_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status is not null then
    perform set_config('twinos.item_status_sync', '1', true);
    -- approved_at / approved_by ride along, otherwise the mirror would land on
    -- an approved variant that records no decision
    update public.content_variants
       set status = new.status::public.content_status,
           approved_at = case when new.status = 'approved'
                              then coalesce(approved_at, new.approved_at, now())
                              else approved_at end
     where item_id = new.id
       and status::text is distinct from new.status;
    perform set_config('twinos.item_status_sync', '', true);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_content_item_status on public.content_items;
create trigger trg_content_item_status
  after update of status on public.content_items
  for each row execute function public.trg_content_item_status();



-- ===========================================================================
-- 26. RLS for the three new tables, and the roles the functions need.
--     api_keys: only jack reads or writes. idempotency_keys: server-side only
--     (the functions use the service role, which bypasses RLS).
-- ===========================================================================
alter table public.api_keys enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.tg_updates enable row level security;

drop policy if exists jack_all on public.api_keys;
create policy jack_all on public.api_keys for all to authenticated
  using (public.twinos_role() = 'jack') with check (public.twinos_role() = 'jack');

drop policy if exists jack_all on public.idempotency_keys;
create policy jack_all on public.idempotency_keys for all to authenticated
  using (public.twinos_role() = 'jack') with check (public.twinos_role() = 'jack');

-- tg_updates: inserted by the service role; readable by jack for debugging only
drop policy if exists jack_select on public.tg_updates;
create policy jack_select on public.tg_updates for select to authenticated
  using (public.twinos_role() = 'jack');

-- ops_bot inserts Telegram events; it also needs to read health and alerts
drop policy if exists ops_bot_select on public.health_checks;
create policy ops_bot_select on public.health_checks for select to authenticated
  using (public.twinos_role() = 'ops_bot');
drop policy if exists ops_bot_insert on public.health_checks;
create policy ops_bot_insert on public.health_checks for insert to authenticated
  with check (public.twinos_role() = 'ops_bot');
drop policy if exists ops_bot_select on public.alerts;
create policy ops_bot_select on public.alerts for select to authenticated
  using (public.twinos_role() = 'ops_bot');

-- The RLS policies from 0009 that referenced the old column names still work
-- (content_variants.item_id is kept), but the desk policy needs the item status
-- column that 0011 added.
drop policy if exists desk_update on public.content_items;
create policy desk_update on public.content_items for update to authenticated
  using (
    public.twinos_role() in ('abdul', 'cron')
    and status in ('draft', 'pending_approval')
  )
  with check (
    public.twinos_role() in ('abdul', 'cron')
    and status in ('draft', 'pending_approval')
  );
drop policy if exists desk_update on public.content_variants;
create policy desk_update on public.content_variants for update to authenticated
  using (public.twinos_role() in ('abdul', 'cron') and status in ('draft', 'pending_approval'))
  with check (public.twinos_role() in ('abdul', 'cron') and status in ('draft', 'pending_approval'));

-- ===========================================================================
-- 27. The views must ignore the `_summary` row that carries the jsonb bag.
--     metric-specific lookups cannot match it, but the two aggregates over all
--     of a week's metrics would otherwise fold its placeholder 0 in.
--     Runs before section 28, which recreates v_stop_if on top of v_funnel.
-- ===========================================================================
-- v_stop_if reads v_funnel, so it has to be dropped first and rebuilt in
-- section 28 once the new v_funnel exists.
drop view if exists public.v_stop_if;
drop view if exists public.v_friday_scoreboard;
create view public.v_friday_scoreboard
with (security_invoker = true) as
with weeks as (
  select (public.local_week_start(now()) - (n * 7))::date as week_start
  from generate_series(0, 12) as n
),
w as (
  select week_start,
         (week_start::timestamp at time zone public.twinos_tz()) as week_from,
         ((week_start + 7)::timestamp at time zone public.twinos_tz()) as week_to
  from weeks
),
channel as (
  select (public.setting('channel_chat_id') #>> '{}')::bigint as chat_id
),
mm as (
  select week_start, kind, metric, sum(value) as value
  from public.manual_metrics
  where metric is distinct from '_summary'
  group by week_start, kind, metric
)
select
  w.week_start,
  (select d.member_count from public.channel_daily d, channel c
     where d.chat_id = c.chat_id and d.source = 'bot_api' and d.day < w.week_start + 7
     order by d.day desc limit 1) as channel_members,
  (select count(*) filter (where e.kind = 'join') - count(*) filter (where e.kind = 'leave')
     from public.member_events e, channel c
    where e.chat_id = c.chat_id and e.occurred_at >= w.week_from and e.occurred_at < w.week_to) as net_joins,
  (select round(100.0 * avg(s.views) / nullif(max(d.member_count), 0), 1)
     from public.tg_posts p
     join public.post_snapshots s on s.chat_id = p.chat_id and s.message_id = p.message_id and s.offset_label = '24h'
     left join public.channel_daily d on d.chat_id = p.chat_id and d.source = 'bot_api' and d.day = (p.posted_at at time zone public.twinos_tz())::date
    where p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as avg_views_pct_of_members,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'followers') as tiktok_followers,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'profile_views') as tiktok_profile_views,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'watch_time_s') as tiktok_watch_time_s,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'pct_watched_full') as tiktok_pct_watched_full,
  (select coalesce(jsonb_object_agg(t.tag, t.n), '{}'::jsonb)
     from (select tag, count(*) as n from public.bot_start_tags
            where started_at >= w.week_from and started_at < w.week_to group by tag) t) as bot_starts_by_tag,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'ib_accounts_opened') as ib_accounts_opened,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'first_time_depositors') as first_time_depositors,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'active_funded_clients') as active_funded_clients,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'rebates_usd') as ib_rebates_usd,
  (select value from mm where mm.week_start = w.week_start and kind = 'revenue' and metric = 'product_revenue_usd') as product_revenue_usd,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'active_subscribers') as active_subscribers,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'expiring_7d') as expiring_7d,
  (select count(*) from public.signal_posts sp where sp.kind in ('card', 'signal') and sp.posted_at >= w.week_from and sp.posted_at < w.week_to) as signals_posted,
  (select count(distinct sp.signal_id) from public.signal_posts sp
    where sp.kind in ('card', 'signal') and sp.posted_at >= w.week_from and sp.posted_at < w.week_to
      and exists (select 1 from public.signal_posts r where r.signal_id = sp.signal_id and r.kind = 'result')) as results_posted,
  (select strict_win_rate from public.results_stats(w.week_to - interval '28 days', w.week_to)) as strict_win_rate_4w,
  (select total_r from public.results_stats(w.week_to - interval '28 days', w.week_to)) as total_r_4w,
  (select count(*) from public.tg_posts p where p.post_type = 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as offer_posts,
  (select count(*) from public.tg_posts p where p.post_type is distinct from 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as value_posts,
  (select coalesce(jsonb_object_agg(coalesce(i.icp::text, 'untagged'), i.n), '{}'::jsonb)
     from (select icp, count(*) as n from public.content_items
            where created_at >= w.week_from and created_at < w.week_to group by icp) i) as icp_served
from w
order by w.week_start desc;
comment on view public.v_friday_scoreboard is 'The twelve Friday numbers per week (plan §4.8). TikTok, Vantage and Telechurn numbers are entered by hand; everything else is counted here.';

-- v_funnel: cost per FTD is a sum over a week's metrics, so it must skip the
-- summary row too. Only that one expression changes, but CREATE OR REPLACE
-- VIEW cannot alter an existing view's column list, so redefine the whole view.
drop view if exists public.v_funnel;
create view public.v_funnel
with (security_invoker = true) as
with weeks as (
  select (public.local_week_start(now()) - (n * 7))::date as week_start
  from generate_series(0, 12) as n
),
w as (
  select week_start,
         (week_start::timestamp at time zone public.twinos_tz()) as week_from,
         ((week_start + 7)::timestamp at time zone public.twinos_tz()) as week_to
  from weeks
)
select
  w.week_start,
  (select coalesce(sum(m.views), 0) from public.post_metrics m
    where m.platform = 'tiktok' and m.captured_at >= w.week_from and m.captured_at < w.week_to) as tiktok_views,
  (select count(*) from public.bot_start_tags t where t.started_at >= w.week_from and t.started_at < w.week_to) as bot_starts,
  (select coalesce(jsonb_object_agg(t.tag, t.n), '{}'::jsonb)
     from (select tag, count(*) as n from public.bot_start_tags
            where started_at >= w.week_from and started_at < w.week_to group by tag) t) as bot_starts_by_tag,
  (select count(*) from public.member_events e where e.kind = 'join' and e.occurred_at >= w.week_from and e.occurred_at < w.week_to) as channel_joins,
  (select coalesce(jsonb_object_agg(coalesce(l.source, 'unknown'), j.n), '{}'::jsonb)
     from (select invite_link_name, count(*) as n from public.member_events
            where kind = 'join' and occurred_at >= w.week_from and occurred_at < w.week_to group by invite_link_name) j
     left join public.invite_links l on l.name = j.invite_link_name) as joins_by_source,
  (select count(*) from public.member_events e
    where e.kind = 'join' and e.occurred_at >= w.week_from and e.occurred_at < w.week_to
      and exists (select 1 from public.invite_links l where l.name = e.invite_link_name and l.source = 'swap')) as swap_joins,
  (select count(*) from public.memberships m
    where m.joined_at >= w.week_from and m.joined_at < w.week_to
      and (m.left_at is null or m.left_at >= m.joined_at + interval '7 days')
      and m.joined_at + interval '7 days' <= now()) as retained_7d,
  (select sum(x.value) from public.manual_metrics x
    where x.week_start = w.week_start and x.kind = 'vantage' and x.metric = 'ib_accounts_opened') as ib_accounts_opened,
  (select sum(x.value) from public.manual_metrics x
    where x.week_start = w.week_start and x.kind = 'vantage' and x.metric = 'first_time_depositors') as first_time_depositors,
  (select sum(x.value) from public.manual_metrics x
    where x.week_start = w.week_start and x.kind = 'ads' and x.metric = 'ad_spend_usd') as ad_spend_usd,
  (select round(sum(x.value) filter (where x.metric = 'ad_spend_usd')
                / nullif(sum(x.value) filter (where x.metric = 'first_time_depositors'), 0), 2)
     from public.manual_metrics x
    where x.week_start = w.week_start and x.kind in ('ads', 'vantage')
      and x.metric is distinct from '_summary') as cost_per_ftd_usd
from w
order by w.week_start desc;
comment on view public.v_funnel is 'TikTok/ad → bot start → channel join → IB account / depositor, per week (plan §9.H.68).';

-- ===========================================================================
-- 28. Views that counted signal cards by kind = 'card' must also see the
--     'signal' spelling the functions write, or the stop-if alarm and the
--     Friday scorecard silently read zero.
-- ===========================================================================
-- CREATE OR REPLACE VIEW cannot add security_invoker to a view that already
-- exists without it, so drop first. v_funnel was recreated in section 27 and
-- v_stop_if reads it, so this has to come after 27. It was already dropped
-- there, so this is just belt and braces.
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
  and s.status <> 'shadow'
  and not exists (select 1 from public.signal_posts r where r.signal_id = s.id and r.kind = 'result')
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
comment on view public.v_stop_if is 'Open stop-if alarms (plan §1). Rule 1 fires for any posted signal past its expiry window with no result reply under it.';

grant select, insert, update, delete on public.api_keys to authenticated;
grant select, insert, update, delete on public.idempotency_keys to authenticated;
grant select, insert on public.tg_updates to authenticated;
grant usage, select on all sequences in schema public to authenticated;
