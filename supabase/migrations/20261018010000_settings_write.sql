-- 20261018010000_settings_write.sql — the dashboard could read settings and
-- never write one.
--
-- Every value Jack has to configure lives in `settings`, and until now the only
-- way to change one was to run SQL against the project. That is the single
-- largest piece of daily friction in the whole system: changing a chat id
-- should not require a database client.
--
-- One SECURITY DEFINER function, not an UPDATE policy. A policy would grant
-- jack UPDATE on the whole table, which means the dashboard decides what a
-- valid value looks like and the database accepts any of it. The function
-- keeps three rules server-side where the UI cannot skip them:
--
--   1. only Jack;
--   2. only keys the seed already defines — a typo must not create a row that
--      nothing reads and nothing cleans up;
--   3. `needs_confirm` clears on write, because setting the value is the
--      confirmation the row was waiting for.
--
-- It writes the change to action_log: settings decide what gets published, so
-- "who changed the posting time" is worth one row.
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.twinos_role() <> 'jack' then
    raise exception 'only Jack may change a setting';
  end if;
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'set_setting needs a key';
  end if;
  if p_value is null then
    raise exception 'set_setting needs a value (use a json null, not nothing)';
  end if;
  if not exists (select 1 from public.settings where key = p_key) then
    raise exception 'unknown setting: %', p_key;
  end if;

  update public.settings
     set value = p_value,
         needs_confirm = false,
         updated_by = public.twinos_actor(),
         updated_at = now()
   where key = p_key;

  insert into public.action_log (actor, action, target_table, target_id, payload)
  values (public.twinos_actor(), 'update', 'settings', p_key,
          jsonb_build_object('value', p_value));
end;
$$;

-- `settings.value` is jsonb, so a bare string is a syntax error at the call
-- site. This helper keeps the caller from inventing its own escaping.
create or replace function public.setting_text(p_key text, p_value text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.set_setting(p_key, to_jsonb(p_value));
$$;

revoke execute on function public.set_setting(text, jsonb) from anon;
revoke execute on function public.setting_text(text, text) from anon;
grant execute on function public.set_setting(text, jsonb) to authenticated;
grant execute on function public.setting_text(text, text) to authenticated;

comment on function public.set_setting(text, jsonb) is
  'Jack-only settings write. Refuses unknown keys, clears needs_confirm, logs the change to action_log.';

-- The guard is asserted in supabase/tests/smoke.sql, which runs after the seed
-- and can act as Jack, as ABDUL and as nobody. A migration runs before the
-- seed, so a settings row does not exist yet inside one.
