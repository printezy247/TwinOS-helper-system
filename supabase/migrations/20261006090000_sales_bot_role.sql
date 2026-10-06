-- 20261006090000_sales_bot_role.sql — a key the sales bot can hold.
--
-- health/check watches a `sales_bot` source, and the board has shown it as
-- "Never reported" since the day it was written: there was no such role, so
-- nothing could call POST /health with one. The smallest honest fix is to add
-- the role and its beat permission — not to teach the board to stop looking.
--
-- Exactly one permission, like `viewer`: the bot may report that it is alive
-- and nothing else, until it has a job in this system. 0011's mint_api_key is
-- otherwise unchanged; this is the same edit 0034 made for `viewer`.

alter table public.api_keys drop constraint if exists api_keys_role_check;
alter table public.api_keys add constraint api_keys_role_check
  check (role in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot'));

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
  if p_role is null or p_role not in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot') then
    raise exception 'mint_api_key: role must be abdul, pc_worker, ezyai, ops_bot, cron, tradingview, viewer or sales_bot';
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

revoke execute on function public.mint_api_key(text, text) from public, anon, authenticated;
