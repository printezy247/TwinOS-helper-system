-- 20261024001000_partner_keys.sql — Phase 7: partner API keys + per-key rate limits.
--
-- "Public API keys | Scoped keys (read:health, write:posts, read:signals) +
-- rate limits per key; dashboard manages keys | Partners integrate without
-- Jack's credentials."
--
-- `partner` is one more key role — least privilege through the same table as
-- every other key: reports.read and research.read through ALL, plus
-- content.draft for write:posts (a draft still has to pass the approval gate;
-- approve stays Jack's alone). `rate_limit_per_min` gives a key its own
-- bucket: null keeps the old unlimited behaviour, which is what the internal
-- keys (abdul, pc_worker, ezyai, …) keep — partners are the ones being
-- protected from, not Jack's own machines.
--
-- Same edit 0034 (viewer) and 0035 (sales_bot) made: the role check
-- constraint and mint_api_key's own allow-list both grow by one name.
-- Apply BEFORE the functions deploy: _shared/auth.ts reads the new column.

alter table public.api_keys drop constraint if exists api_keys_role_check;
alter table public.api_keys add constraint api_keys_role_check
  check (role in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot', 'partner'));

alter table public.api_keys add column if not exists rate_limit_per_min integer
  check (rate_limit_per_min is null or rate_limit_per_min between 1 and 100000);

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
  if p_role is null or p_role not in ('abdul', 'pc_worker', 'ezyai', 'ops_bot', 'cron', 'tradingview', 'viewer', 'sales_bot', 'partner') then
    raise exception 'mint_api_key: role must be abdul, pc_worker, ezyai, ops_bot, cron, tradingview, viewer, sales_bot or partner';
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
