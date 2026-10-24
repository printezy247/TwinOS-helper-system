-- 20261024000000_settings_guard_null_safe.sql — make the "only Jack" guard fail
-- closed.
--
-- Found by the 24 Oct acceptance run: `if public.twinos_role() <> 'jack'` is
-- NULL when the caller has no twinos_role claim (anon, and any verified login
-- whose app_metadata lacks the claim), and a NULL condition does not fire the
-- IF — so anon and a claim-less user both got 204 and changed `dashboard_url`
-- over the REST RPC. `coalesce(..., '')` turns the NULL into a value that is
-- never 'jack', so the raise always fires for anyone who is not Jack.
--
-- The other guards are already safe: RLS policies evaluate NULL as false, and
-- the trigger checks compare twinos_actor(), which coalesces to the JWT `role`
-- claim and is never NULL in a real session.
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.twinos_role(), '') <> 'jack' then
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
