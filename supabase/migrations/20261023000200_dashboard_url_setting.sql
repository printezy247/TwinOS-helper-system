-- 20261023000200_dashboard_url_setting.sql — the bots' "Open in dashboard"
-- button has nothing to open until a URL exists somewhere Jack can set it.
--
-- `set_setting` only allowlists keys that already have a row, so the key has to
-- exist before the dashboard's Settings page can write it (Wave 8 §3.2 step 3).
-- Same pattern as 20261020000000_seed_health_stale.sql: supabase/seed.sql holds
-- the row too, `supabase db push` only runs migrations, and a value Jack already
-- filled in is never overwritten.
insert into public.settings (key, value, description, needs_confirm) values
  ('dashboard_url', 'null', 'Wave 8 §3.2: dashboard URL the bots'' web_app buttons open as a Mini App (e.g. https://<site>/mini). Set it from the dashboard Settings page once the site is published.', true)
on conflict (key) do nothing;
