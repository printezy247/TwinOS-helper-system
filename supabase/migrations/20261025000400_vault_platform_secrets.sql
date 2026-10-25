-- 20261025000400_vault_platform_secrets.sql — five platform tokens sat in
-- `settings` as plaintext (A3). settings is readable by the dashboard's reader
-- role and appears in every dump; a token does not belong there.
--
-- Two pieces, no data touched by this file:
--
--   get_secret(name)                 the only way a function can read Vault
--   twinos_move_tokens_to_vault()    the one-command move, dry-run by default
--
-- The reader in the functions (`_shared/secrets.ts`) tries Vault first and
-- falls back to the settings row, so this migration can land before the move
-- and nothing breaks in between. The move itself is Jack's to run:
--
--   select * from public.twinos_move_tokens_to_vault(false);   -- apply
--   select * from public.twinos_move_tokens_to_vault(true);    -- what it would do
--
-- It creates a Vault secret from the value already in the database (the value
-- never leaves the database and is never printed), then blanks the settings
-- row so the plaintext is gone. Idempotent: a second run moves nothing.
--
-- Guarded the way 20261001195926_cron.sql guards Vault: the schema may not
-- exist (CI's plain Postgres, a project without the extension), and a missing
-- Vault must read as "no secret", never as an error.

create or replace function public.get_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value text;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    return null;
  end if;
  -- Vault absent: null, not an exception. Callers fall back to settings.
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v_value using btrim(p_name);
  exception when others then
    return null;
  end;
  return nullif(v_value, '');
end;
$$;

comment on function public.get_secret(text) is
  'Service-role-only reader for one Vault secret by name. Null when Vault, the schema or the name is absent.';

-- The Vault value is a credential: only the service role (every edge function)
-- may read it. `public` is revoked too, because privileges are inherited
-- through PUBLIC by default and a mere `revoke ... from anon` leaves that path.
revoke all on function public.get_secret(text) from public;
revoke all on function public.get_secret(text) from anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- The move. One row per credential, dry-run unless asked otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.twinos_move_tokens_to_vault(p_dry_run boolean default true)
returns table (setting_key text, secret_name text, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_current text;
  v_exists text;
begin
  for r in
    select * from (values
      ('openrouter_api_key', 'twinos_openrouter_key'),
      ('meta_ig_token',      'meta_ig_token'),
      ('meta_page_token',    'meta_page_token'),
      ('threads_token',      'threads_token'),
      ('yt_api_key',         'yt_api_key')
    ) as t(key, name)
  loop
    setting_key := r.key;
    secret_name := r.name;

    -- value #>> '{}' is the text inside a jsonb string; a jsonb null is NULL.
    select s.value #>> '{}' into v_current
      from public.settings s where s.key = r.key;

    if to_regclass('vault.decrypted_secrets') is not null then
      begin
        execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
          into v_exists using r.name;
      exception when others then
        v_exists := null;
      end;
    else
      v_exists := null;
    end if;

    if v_exists is not null then
      if v_current is null then
        outcome := 'already in vault';
      elsif p_dry_run then
        outcome := 'would blank the settings row (vault already has it)';
      else
        update public.settings
           set value = 'null'::jsonb, updated_at = now(), updated_by = 'migration'
         where key = r.key;
        insert into public.action_log (actor, action, target_table, target_id, payload)
        values ('migration', 'update', 'settings', r.key,
                jsonb_build_object('vault_secret', r.name, 'reason', 'plaintext removed'));
        outcome := 'moved (vault already had it)';
      end if;
      return next;
      continue;
    end if;

    if v_current is null or length(v_current) = 0 then
      outcome := 'not set';
      return next;
      continue;
    end if;

    if p_dry_run then
      outcome := 'would move to vault';
      return next;
      continue;
    end if;

    begin
      perform vault.create_secret(v_current, r.name, 'TwinOS platform credential (moved from settings)');
    exception when others then
      outcome := 'vault refused the write: ' || sqlerrm;
      return next;
      continue;
    end;

    update public.settings
       set value = 'null'::jsonb, updated_at = now(), updated_by = 'migration'
     where key = r.key;
    insert into public.action_log (actor, action, target_table, target_id, payload)
    values ('migration', 'update', 'settings', r.key,
            jsonb_build_object('vault_secret', r.name, 'reason', 'plaintext moved to vault'));
    outcome := 'moved to vault';
    return next;
  end loop;
end;
$$;

comment on function public.twinos_move_tokens_to_vault(boolean) is
  'Moves the five platform tokens from settings into Vault and blanks the plaintext. Dry run by default; logs names only.';

revoke all on function public.twinos_move_tokens_to_vault(boolean) from public;
revoke all on function public.twinos_move_tokens_to_vault(boolean) from anon, authenticated;
grant execute on function public.twinos_move_tokens_to_vault(boolean) to service_role;
