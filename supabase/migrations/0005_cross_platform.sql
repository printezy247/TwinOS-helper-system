-- 0005_cross_platform.sql — metrics from every platform, manual weekly entries, unified inbox.
-- UPGRADE-PLAN §4.8, §9.F, §9.I.77, §9.L.

-- post_metrics: polled from official APIs or TikTok Studio export (§9.F, §9.L.98)
create table if not exists public.post_metrics (
  id bigint generated always as identity primary key,
  platform public.platform not null,
  platform_post_id text not null,
  variant_id uuid references public.content_variants (id) on delete set null,
  captured_at timestamptz not null default now(),
  views integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  watch_time_s numeric(10, 2),
  avg_watch_time_s numeric(8, 2),
  pct_watched_full numeric(5, 2),
  followers_gained integer,
  profile_views integer,
  source text not null default 'api',      -- api | export | manual
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (platform, platform_post_id, captured_at)
);
create index if not exists idx_post_metrics_variant on public.post_metrics (variant_id, captured_at desc);
create index if not exists idx_post_metrics_platform on public.post_metrics (platform, captured_at desc);

-- manual_metrics: the two-minute Friday forms — Vantage portal, TikTok analytics,
-- Telechurn report, revenue, subscriptions (§4.8, §6)
create table if not exists public.manual_metrics (
  id bigint generated always as identity primary key,
  week_start date not null,                -- Monday of the ISO week
  kind text not null check (kind in ('tiktok', 'vantage', 'telechurn', 'revenue', 'subscriptions', 'ads', 'support')),
  metric text not null,                    -- followers | profile_views | watch_time_s | pct_watched_full | ib_accounts_opened | first_time_depositors | active_funded_clients | rebates_usd | product_revenue_usd | active_subscribers | expiring_7d | ad_spend_usd | cost_per_ftd_usd | refunds | complaints
  value numeric not null,
  campaign text,                           -- for ads: campaign name (§9.L.101)
  note text,
  entered_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, kind, metric, campaign)
);
create index if not exists idx_manual_metrics_week on public.manual_metrics (week_start desc, kind);

-- inbox_items: IG/FB/YouTube comments and Threads replies, polled; Jack taps to send (§9.I.77)
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  platform public.platform not null,
  external_id text not null,
  kind text not null default 'comment' check (kind in ('comment', 'reply', 'dm', 'mention')),
  platform_post_id text,
  variant_id uuid references public.content_variants (id) on delete set null,
  author_handle text,
  author_external_id text,
  text text not null,
  received_at timestamptz not null,
  suggested_reply text,
  status text not null default 'new' check (status in ('new', 'suggested', 'replied', 'ignored', 'flagged')),
  replied_text text,
  replied_at timestamptz,
  replied_by text,
  is_repeat_question boolean not null default false,   -- proposed for Sarah's reply sheet (§9.I.75)
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index if not exists idx_inbox_open on public.inbox_items (received_at desc) where status in ('new', 'suggested');
