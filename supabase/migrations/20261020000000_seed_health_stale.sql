-- Health staleness thresholds, in minutes (health/index.ts multiplies by 60_000).
-- supabase/seed.sql already holds these rows, but `supabase db push` only runs
-- migrations, so an environment that never ran the seed had no rows for
-- set_setting to allowlist against. do nothing on conflict: a value Jack already
-- changed is never overwritten.
insert into public.settings (key, value, description, needs_confirm) values
  ('health_stale_scheduler', '5', 'Minutes before the scheduler counts as stale. Tightest of the set: a missed cycle here means posts did not go out.', false),
  ('health_stale_ezyai', '30', 'Minutes before EzyAI counts as stale.', false),
  ('health_stale_poller', '30', 'Minutes before the feed poller counts as stale.', false),
  ('health_stale_pc_worker', '20', 'Minutes before the PC worker counts as stale.', false),
  ('health_stale_ops_bot', '1440', 'Minutes before the ops bot counts as stale (24 h).', false),
  ('health_stale_abdul', '1440', 'Minutes before ABDUL counts as stale (24 h).', false),
  ('health_stale_sales_bot', '1440', 'Minutes before the sales bot counts as stale (24 h).', false)
on conflict (key) do nothing;
