-- 20261005070000_social_feed_kinds.sql — two social sources that publish an
-- official API instead of a feed (research pass, 2026-10-05).
--
--   bluesky    public.api.bsky.app searchPosts: a keyword read over posts,
--              free, no key, no scraping (same class as a published feed)
--   mastodon   /api/v1/tags/<tag>/statuses on any instance: likewise public
--
-- `kind` already exists and already holds rss | atom | youtube_rss, so the
-- reader grows two more shapes rather than a second column to keep in step.
-- Nothing else changes: same table, same unique id, same 6-hourly cron.

alter table public.feeds drop constraint if exists feeds_kind_check;
alter table public.feeds add constraint feeds_kind_check
  check (kind in ('rss', 'atom', 'youtube_rss', 'bluesky', 'mastodon'));

comment on column public.feeds.kind is
  'rss | atom | youtube_rss are parsed as XML; bluesky and mastodon are parsed as JSON by parseJsonFeed';
