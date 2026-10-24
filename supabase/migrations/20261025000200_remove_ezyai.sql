-- 20261025000200_remove_ezyai.sql — EzyAI is no longer a signal source or a key
-- role. Signals arrive from TradingView (tv-webhook) or are entered by hand.
-- The "EzyAI PRO" products in the offers catalog are things we sell, not this
-- integration, and stay (products.product_group keeps its 'ezyai' value).
--
-- APPLY ONLY AFTER the EzyAI bot is switched off: this deletes its API key, so
-- a bot still running would start getting 401s.

-- 1. Signals: any leftover EzyAI rows become manual entries; the source list
--    and the default no longer name ezyai.
update public.signals set source = 'manual' where source = 'ezyai';
alter table public.signals drop constraint if exists signals_source_check;
alter table public.signals add constraint signals_source_check
  check (source in ('tradingview', 'manual'));
alter table public.signals alter column source set default 'manual';

-- 2. The batch-ingest functions only served the EzyAI bot.
drop function if exists public.ingest_signals(jsonb);
drop function if exists public.ingest_outcome(jsonb);

-- 3. Row-level-security policies of the removed role (ezyai_select/insert/update).
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and policyname like 'ezyai\_%'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

-- 4. API keys: remove the EzyAI key, then close the role off in the check
--    constraint and in mint_api_key's own allow-list.
delete from public.api_keys where role = 'ezyai';

alter table public.api_keys drop constraint if exists api_keys_role_check;
alter table public.api_keys add constraint api_keys_role_check
  check (role in ('abdul', 'pc_worker', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot', 'partner'));

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
  if p_role is null or p_role not in ('abdul', 'pc_worker', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot', 'partner') then
    raise exception 'mint_api_key: role must be abdul, pc_worker, ops_bot, cron, tradingview, viewer, sales_bot or partner';
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

  -- The only moment the plain key exists outside Jack's keyring (here: the
  -- dashboard's one-time reveal — it is never stored and never returned again).
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'role', p_role,
    'key', v_key, 'key_prefix', v_prefix,
    'note', 'Store this in the keyring now. It is not recoverable.'
  );
end;
$body$;

revoke execute on function public.mint_api_key(text, text) from public, anon, authenticated;

-- 5. Health: the ezyai heartbeat history and its stale-minutes setting go, so
--    an old last beat can never count as a stale source.
delete from public.health_checks where source = 'ezyai';
delete from public.settings where key = 'health_stale_ezyai';
