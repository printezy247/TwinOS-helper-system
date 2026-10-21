-- 20261022000000_realtime_publication_wave8.sql
--
-- 20261018030000 completed the publication for the tables the dashboard already
-- subscribed to. Wave 8 adds two more subscriptions: `feeds` (the Feeds screen
-- and the Research feed-name lookup) and `jobs` (the queue counts behind the
-- Jobs widget, invalidated through qk.jobs). Until they are in the publication
-- those subscriptions would look wired and be dead — the same silent failure
-- 0033 caused for seven tables.
--
-- Nothing new is exposed: Realtime applies each table's own RLS select policies
-- per subscriber, so adding a table grants no read a direct query lacks.
--
-- Idempotent, and it no-ops on plain Postgres (CI) where the publication does
-- not exist — same guard as 0033 and 20261018030000.

do $$
declare
  t text;
  missing text[] := array['feeds', 'jobs'];
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
