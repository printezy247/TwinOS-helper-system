-- 0010_cron.sql — pg_cron + pg_net, with the schedules left as documented
-- placeholders. Schedules call Edge Function URLs that live in `settings`
-- (edge_base_url) with a bearer secret from Vault (cron_secret_name); nothing
-- is hardcoded here. UPGRADE-PLAN §7 (Scheduler: the clock), §9.E.32, §9.H.65–66.
--
-- Both extensions exist on Supabase. On a vanilla Postgres they may not, so
-- the migration degrades to a notice instead of failing.

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available here (%): schedules must be created on Supabase', sqlerrm;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise notice 'pg_net not available here (%): twinos_cron_call is a no-op stub', sqlerrm;
    end;
  end;
end $$;

-- Supabase: let the postgres role manage cron jobs from the SQL editor.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute 'grant usage on schema cron to postgres';
    execute 'grant all privileges on all tables in schema cron to postgres';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- twinos_cron_call(fn): POST {edge_base_url}/{fn} with Authorization: Bearer
-- <vault secret named by settings.cron_secret_name>. The function body is
-- created dynamically so this file loads even where pg_net/vault are absent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $fn$
      create or replace function public.twinos_cron_call(p_fn text, p_body jsonb default '{}'::jsonb)
      returns bigint
      language plpgsql
      security definer
      set search_path = public, extensions, net, vault
      as $body$
      declare
        v_base text := public.setting_text('edge_base_url');
        v_secret_name text := coalesce(public.setting_text('cron_secret_name'), 'twinos_cron_secret');
        v_secret text;
        v_request_id bigint;
      begin
        if v_base is null or v_base = '' then
          raise notice 'twinos_cron_call(%): settings.edge_base_url is not set; skipping', p_fn;
          return null;
        end if;
        select decrypted_secret into v_secret from vault.decrypted_secrets where name = v_secret_name limit 1;
        if v_secret is null then
          raise notice 'twinos_cron_call(%): vault secret % not found; skipping', p_fn, v_secret_name;
          return null;
        end if;
        select net.http_post(
          url := rtrim(v_base, '/') || '/' || ltrim(p_fn, '/'),
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
          body := coalesce(p_body, '{}'::jsonb) || jsonb_build_object('fn', p_fn, 'at', now()),
          timeout_milliseconds := 15000
        ) into v_request_id;
        return v_request_id;
      end;
      $body$;
    $fn$;
  else
    execute $fn$
      create or replace function public.twinos_cron_call(p_fn text, p_body jsonb default '{}'::jsonb)
      returns bigint
      language plpgsql
      as $body$
      begin
        raise notice 'twinos_cron_call(%) stub: pg_net or vault not installed in this database', p_fn;
        return null;
      end;
      $body$;
    $fn$;
  end if;
end $$;

revoke execute on function public.twinos_cron_call(text, jsonb) from public, anon, authenticated;
comment on function public.twinos_cron_call(text, jsonb) is 'Called by pg_cron. Posts to settings.edge_base_url/<fn> with the Vault secret named by settings.cron_secret_name. Never hardcode URLs or tokens in cron.schedule.';

-- ---------------------------------------------------------------------------
-- Example schedules. Run these on Supabase AFTER settings.edge_base_url is
-- set and the Vault secret exists (see supabase/README.md). pg_cron runs in
-- UTC; MYT = UTC+8, so 07:40 MYT is 23:40 UTC the previous day.
-- ---------------------------------------------------------------------------
-- select cron.schedule('twinos-publisher-tick',   '* * * * *',     $$select public.twinos_cron_call('publish')$$);               -- §9.E.32 every minute; pacing + backoff inside the function
-- select cron.schedule('twinos-snapshots',        '*/15 * * * *',  $$select public.twinos_cron_call('metrics/snapshots')$$);     -- §9.H.66 post views at +1h / 24h / 7d (function picks due posts)
-- select cron.schedule('twinos-member-count',     '5 16 * * *',    $$select public.twinos_cron_call('metrics/member-count')$$);  -- §9.H.65 daily member count, 00:05 MYT
-- select cron.schedule('twinos-stop-if',          '*/10 * * * *',  $$select public.twinos_cron_call('metrics/stop-if')$$);       -- §9.D.25 alert on v_stop_if rows
-- select cron.schedule('twinos-map-reminder',     '40 23 * * 0-4', $$select public.twinos_cron_call('desk/remind-map')$$);       -- §9.C.20 07:40 MYT if no map arrived
-- select cron.schedule('twinos-evening-reminder', '55 11 * * 1-5', $$select public.twinos_cron_call('desk/remind-evening')$$);   -- §9.C.20 19:55 MYT
-- select cron.schedule('twinos-wednesday-batch',  '30 6 * * 3',    $$select public.twinos_cron_call('content/batch')$$);         -- §9.C.18 Wed 14:30 MYT
-- select cron.schedule('twinos-friday-numbers',   '0 1 * * 5',     $$select public.twinos_cron_call('friday')$$);                -- §9.L.95 Fri 09:00 MYT: ask for the two manual inputs
-- select cron.schedule('twinos-health',           '*/5 * * * *',   $$select public.twinos_cron_call('health')$$);                -- §9.M.102 stale beats → alert
-- select cron.schedule('twinos-keepalive',        '0 */6 * * *',   $$select 1$$);                                                -- keeps a free-tier project from pausing (§8)
--
-- To remove one: select cron.unschedule('twinos-publisher-tick');
