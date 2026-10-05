-- 0015 — rotate_api_key(name, role): retire every key with that name, mint a new one.
--
-- api_keys.name is unique, so a revoked row would block minting the same name
-- again. Retired rows keep their hash (an old key stays traceable in
-- action_log) and get renamed to '<name>@<timestamp>'. scripts/mint-keys.sh is
-- the only caller; it stores the returned key in Jack's keyring without
-- printing it. Like mint_api_key, nobody but the database owner may run it.

create or replace function public.rotate_api_key(p_name text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retired integer;
  v_result jsonb;
begin
  if p_name is null or p_name !~ '^[a-z0-9][a-z0-9-]{1,40}$' then
    raise exception 'rotate_api_key: name must be lowercase letters, digits and dashes';
  end if;

  update public.api_keys
     set revoked_at = coalesce(revoked_at, now()),
         revoke_note = coalesce(revoke_note, 'rotated'),
         name = name || '@' || to_char(clock_timestamp(), 'YYYYMMDD"T"HH24MISSMS')
   where name = p_name;
  get diagnostics v_retired = row_count;

  v_result := public.mint_api_key(p_name, p_role);
  return v_result || jsonb_build_object('retired', v_retired);
end;
$$;

revoke execute on function public.rotate_api_key(text, text) from public, anon, authenticated;
comment on function public.rotate_api_key(text, text) is 'Retires every api_keys row named p_name (revoked, renamed name@timestamp) and mints a new key. Returns the plain key once. Used by scripts/mint-keys.sh.';
