-- 20261023000100_realtime_publication_wave8_phase3.sql
--
-- Wave 8 Phase 3 adds one subscription: `benchmarks`, the competitor channel
-- numbers behind the new Insights panel, which the two refresh buttons
-- (research/channels and metrics/benchmarks) rewrite. Without the publication
-- entry the subscription would look wired and never fire — the same silent
-- failure 0033, 20261018030000 and 20261023000000 each fixed for their tables.
--
-- Nothing new is exposed: Realtime applies the table's own RLS select policies
-- per subscriber (`readers_select` covers abdul/dashboard/cron, `jack_all`
-- covers Jack), so adding it grants no read a direct query lacks.
--
-- Idempotent, and it no-ops on plain Postgres (CI) where the publication does
-- not exist — same guard as every publication migration before it.

do $$
declare
  t text;
  missing text[] := array['benchmarks'];
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
