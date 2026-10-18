-- 20261018030000_realtime_publication_complete.sql
--
-- 0033_realtime.sql put four tables into the supabase_realtime publication:
-- content_items, content_variants, publish_jobs and alerts. The dashboard
-- subscribes to eleven. Supabase accepts a subscription to a table that is not
-- in the publication and then sends nothing for it, so the other seven looked
-- wired and were dead: Signals, Feeds, Research, CSI captures, briefs, topic
-- clusters and platform accounts never updated live, with no error anywhere to
-- say so. The approval badge, the new-draft toast, publish state and alerts
-- worked, which is why it read as "realtime is on".
--
-- Nothing new is exposed: Realtime applies each table's own RLS select policies
-- per subscriber, so adding a table to the publication grants no read that a
-- direct query would not already grant.
--
-- Idempotent, and it no-ops on plain Postgres (CI) where the publication does
-- not exist — same guard as 0033, because dropping the guard would turn the CI
-- job red for a reason unrelated to the change.

do $$
declare
  t text;
  missing text[] := array[
    'signals', 'signal_posts', 'briefs', 'topic_clusters',
    'csi_captures', 'feed_items', 'platform_accounts'
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
