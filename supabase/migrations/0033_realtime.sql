-- 0033_realtime.sql — plan §17 Wave 2 item 7.
--
-- The dashboard swaps its 60 s / 30 s polling for Supabase Realtime: a live
-- pending badge, a "new draft" toast and live publish/alert state. Realtime
-- only streams tables in the supabase_realtime publication, and it applies
-- each table's RLS select policies per subscriber, so nothing new is exposed.
-- Idempotent: a table already in the publication is skipped. Plain Postgres
-- (CI) has no supabase_realtime publication, so there it does nothing.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['content_items', 'content_variants', 'publish_jobs', 'alerts'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
