-- 20261018020000_wave6_backend.sql — the two schema changes the dashboard
-- could not build around.
--
--   template_variants  templates.key is post_type as its primary key, so one
--                      post type has exactly one template and no per-platform
--                      caption. Every per-platform copy control in Wave 6 waits
--                      on this.
--
--   feed_items columns  the table carries a title, a summary, a link and a
--                      published_at, and nothing to sort or filter by. Every
--                      research categorisation idea in the review waits on this.
--
-- Both are additive and backfill nothing: a database with no variant rows and
-- no tags behaves exactly as it does today.

-- ---------------------------------------------------------------------------
-- 1. template_variants — per-platform, per-language overrides
-- ---------------------------------------------------------------------------
-- An override table rather than a re-key of `templates`. Re-keying would move
-- the primary key from post_type to a three-column tuple, which means rewriting
-- the seed, every loadTemplate caller, check_templates.ts, the calendar slots
-- that reference post types, and the templates_dump.sql CI reads. An override
-- row is additive, needs no backfill, and the fallback is explicit: no row for
-- (post_type, platform, lang) means the base template.
--
-- Only the fields that actually differ per platform are overridable. The
-- approval_rule and requires_approval are deliberately not: a rule that
-- changes with the platform is a rule nobody can remember.
create table if not exists public.template_variants (
  post_type public.post_type not null,
  platform public.platform not null,
  lang text not null check (lang in ('en', 'ms')),
  body text,                                   -- null = inherit the base template
  fields_list text[],                          -- null = inherit
  char_limit integer,                          -- null = inherit
  hashtag text,                                -- null = inherit
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_type, platform, lang)
);

alter table public.template_variants enable row level security;
drop policy if exists jack_all on public.template_variants;
drop policy if exists readers_select on public.template_variants;
create policy jack_all on public.template_variants for all to authenticated
  using (public.twinos_role() = 'jack');
create policy readers_select on public.template_variants for select to authenticated
  using (public.twinos_role() in ('abdul', 'dashboard', 'cron', 'pc_worker'));
grant select on public.template_variants to authenticated;

comment on table public.template_variants is
  'Per-platform, per-language overrides of `templates`. A row replaces the named field; a null field inherits the base template.';

-- ---------------------------------------------------------------------------
-- 2. feed_items — something to sort and filter by
-- ---------------------------------------------------------------------------
alter table public.feed_items
  add column if not exists tags text[] not null default '{}',
  add column if not exists category text,
  add column if not exists lang text check (lang in ('en', 'ms', 'manglish')),
  add column if not exists match_score integer;  -- how many of a persona's own terms it matched

-- Filtering is the whole point of the columns, so the index is partial on the
-- rows that carry anything to filter by.
create index if not exists idx_feed_items_tags on public.feed_items using gin (tags) where tags <> '{}';
create index if not exists idx_feed_items_score on public.feed_items (match_score desc) where match_score is not null;

comment on column public.feed_items.tags is
  'Matched persona seed-question words and the pillar that matched them, set on ingest. Nothing here is posted.';
comment on column public.feed_items.category is
  'The pillar of the persona that matched this item (map_recap, lesson, ...).';
comment on column public.feed_items.match_score is
  'How many of the persona''s own terms this item matched — the same number pickIdeas ranks by, so the list and the tag agree. Null until it has been matched against anything.';
