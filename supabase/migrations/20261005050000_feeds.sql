-- 20261005050000_feeds.sql — RSS/Atom research sources (UPGRADE-IDEAS #9,
-- Phase 5 "channel RSS": Search Console, Bing and the YouTube Data API need
-- Jack's accounts, a published feed needs nothing at all).
--
-- A feed is a list the publisher hands out, not a page scrape, so it stays
-- inside the method rules ("allowed methods only, no new paid subscriptions,
-- no scraping"). `queries.source` has carried `youtube_rss` since 0007 with no
-- reader; this is the reader.
--
-- Feed items are read, never posted: research/index.ts only fetches and stores.
-- Anything that turns one into a card still goes through the Desk and Jack.

create table if not exists public.feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  kind text not null default 'rss' check (kind in ('rss', 'atom', 'youtube_rss')),
  lang text not null default 'en' check (lang in ('en', 'ms', 'manglish')),
  -- What the feed is for: a pillar, or the post type it would feed a card from.
  purpose text,
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_status text not null default 'never'
    check (last_status in ('never', 'ok', 'http_error', 'parse_error', 'timeout', 'not_xml')),
  last_error text,
  items_seen integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text not null default public.twinos_actor()
);

create table if not exists public.feed_items (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.feeds (id) on delete cascade,
  -- guid / Atom id, falling back to the link: the same story must not be stored
  -- once per fetch, or the every-6-hours cron would duplicate the feed daily.
  external_id text not null,
  title text not null,
  summary text,
  link text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (feed_id, external_id)
);
create index if not exists idx_feed_items_published on public.feed_items (published_at desc);
create index if not exists idx_feed_items_feed on public.feed_items (feed_id, created_at desc);
create index if not exists idx_feeds_active on public.feeds (active) where active;

alter table public.feeds enable row level security;
alter table public.feed_items enable row level security;
drop policy if exists jack_all on public.feeds;
drop policy if exists readers_select on public.feeds;
create policy jack_all on public.feeds for all to authenticated using (public.twinos_role() = 'jack');
create policy readers_select on public.feeds for select to authenticated
  using (public.twinos_role() in ('abdul', 'dashboard', 'cron'));
drop policy if exists jack_all on public.feed_items;
drop policy if exists readers_select on public.feed_items;
create policy jack_all on public.feed_items for all to authenticated using (public.twinos_role() = 'jack');
create policy readers_select on public.feed_items for select to authenticated
  using (public.twinos_role() in ('abdul', 'dashboard', 'cron'));
grant select on public.feeds, public.feed_items to authenticated;

-- The fetch runs four times a day (feeds change a few times a day, not every
-- minute; a poller that often would spend more than the reads are worth).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-research-feeds') then
      perform cron.unschedule('twinos-research-feeds');
    end if;
    perform cron.schedule('twinos-research-feeds', '20 */6 * * *',
      $cron$select public.twinos_cron_call('research/feeds')$cron$);
    raise notice 'scheduled twinos-research-feeds (every 6 hours at :20)';
  else
    raise notice 'pg_cron not available here: schedule research/feeds on Supabase';
  end if;
end $$;
