-- 20261023000000_realtime_publication_wave8_phase1.sql
--
-- Wave 8 Phase 1 moves five dashboard screens onto the shared query layer and
-- subscribes the shell channel to the tables behind them: `invite_links`
-- (Links), `poll_results` (Polls), `template_variants` (Templates and Compose),
-- `clip_candidates` (Clips) and `inbox_items` (Messages). Without this those
-- subscriptions look wired and deliver nothing — the same silent failure
-- 0033 caused for seven tables and Wave 8 Phase 0 caused for two more.
--
-- Nothing new is exposed: Realtime applies each table's own RLS select policies
-- per subscriber, so adding a table grants no read a direct query lacks — and
-- the dashboard already reads all five tables directly.
--
-- Idempotent, and it no-ops on plain Postgres (CI) where the publication does
-- not exist — same guard as 0033, 20261018030000 and 20261022000000.

do $$
declare
  t text;
  missing text[] := array[
    'invite_links', 'poll_results', 'template_variants', 'clip_candidates', 'inbox_items'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array missing loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
