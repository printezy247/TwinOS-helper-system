-- 0004_telegram.sql — Telegram tracking with allowed methods + Telechurn (§5, §9.H, §9.I).
-- Bot API events, named invite links, daily counts, post view snapshots,
-- Telechurn imports, @EzyRegisterBot /start tags (read copy), moderation.

-- invite_links: created only through the ops bot, named `src-campaign-yymm` (§5)
create table if not exists public.invite_links (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  name text not null,                      -- tt-live-2610, swap-macronews-2611, ig-bio-2610
  link text,                               -- https://t.me/+... as returned by createChatInviteLink
  source text not null,                    -- tt | ig | fb | yt | threads | x | swap | ad | referral | bio | bot
  campaign text not null,
  partner text,                            -- swap partner channel (§9.H.69)
  cost_usd numeric(10, 2),                 -- paid placements / ad campaigns
  creates_join_request boolean not null default false,
  member_limit integer,
  expires_at timestamptz,
  created_by text not null default public.twinos_actor(),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, name),
  constraint invite_links_name_convention check (name ~ '^[a-z0-9]+-[a-z0-9]+-[0-9]{4}$')
);
create index if not exists idx_invite_links_source on public.invite_links (source, campaign);

-- member_events: raw chat_member / join request updates from the ops bot (§9.H.63)
create table if not exists public.member_events (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  user_id bigint not null,
  kind text not null check (kind in ('join', 'leave', 'join_request', 'approved', 'kick', 'ban', 'unban', 'restrict')),
  occurred_at timestamptz not null,
  invite_link_name text,
  invite_link text,
  via_join_request boolean not null default false,
  actor_user_id bigint,                    -- admin who kicked/banned, if any
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (chat_id, user_id, kind, occurred_at)
);
create index if not exists idx_member_events_chat on public.member_events (chat_id, occurred_at desc);
create index if not exists idx_member_events_link on public.member_events (invite_link_name, occurred_at desc);

-- memberships: events folded into stays (joined, left, source link)
create table if not exists public.memberships (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  user_id bigint not null,
  joined_at timestamptz not null,
  left_at timestamptz,
  invite_link_name text,
  source text,
  campaign text,
  partner text,
  status text not null default 'member' check (status in ('member', 'left', 'kicked', 'banned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, user_id, joined_at)
);
create index if not exists idx_memberships_open on public.memberships (chat_id, user_id) where left_at is null;
create index if not exists idx_memberships_link on public.memberships (invite_link_name, joined_at);

-- channel_daily: member count snapshot per day (§9.H.65); Telechurn as reference
create table if not exists public.channel_daily (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  day date not null,
  source text not null default 'bot_api' check (source in ('bot_api', 'telechurn', 'manual')),
  member_count integer,
  joins integer,
  leaves integer,
  net_joins integer generated always as (coalesce(joins, 0) - coalesce(leaves, 0)) stored,
  posts integer,
  created_at timestamptz not null default now(),
  unique (chat_id, day, source)
);

-- tg_posts: every message the ops bot published or saw in the channel
create table if not exists public.tg_posts (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  message_id bigint not null,
  variant_id uuid references public.content_variants (id) on delete set null,
  post_type public.post_type,
  lang text check (lang in ('en', 'ms')),
  posted_at timestamptz not null,
  reply_to_message_id bigint,
  is_pinned boolean not null default false,
  has_media boolean not null default false,
  bot_link_tag text,                       -- ?start=<tag> used in this post (§9.E.43)
  text_hash text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index if not exists idx_tg_posts_time on public.tg_posts (chat_id, posted_at desc);
create index if not exists idx_tg_posts_type on public.tg_posts (post_type, posted_at desc);

-- post_snapshots: views at +1h, 24h, 7d through the ops bot's own login (§9.H.66)
create table if not exists public.post_snapshots (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  message_id bigint not null,
  offset_label text not null check (offset_label in ('1h', '24h', '7d', 'adhoc')),
  taken_at timestamptz not null default now(),
  views integer,
  forwards integer,
  reactions jsonb not null default '{}'::jsonb,   -- {"👍": 12, ...}
  reactions_total integer,
  comments integer,
  created_at timestamptz not null default now(),
  unique (chat_id, message_id, offset_label)
);
create index if not exists idx_post_snapshots_msg on public.post_snapshots (chat_id, message_id);

-- telechurn_imports: weekly reference numbers (CSV when available, else typed in; §6)
create table if not exists public.telechurn_imports (
  id bigint generated always as identity primary key,
  imported_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  chat_id bigint,
  link_name text,                          -- NULL = whole channel
  joins integer,
  leaves integer,
  retained_7d integer,
  retention_pct numeric(5, 2),
  file_name text,
  raw jsonb,
  imported_by text not null default public.twinos_actor(),
  unique nulls not distinct (period_start, period_end, chat_id, link_name)
);

-- bot_start_tags: read copy of @EzyRegisterBot start_log (§9.H.67)
create table if not exists public.bot_start_tags (
  id bigint generated always as identity primary key,
  source_bot text not null default '@EzyRegisterBot',
  tag text not null,                       -- tt_live, ch_pin, per-post tags
  user_id bigint,
  started_at timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (source_bot, tag, user_id, started_at)
);
create index if not exists idx_bot_start_tags_tag on public.bot_start_tags (tag, started_at desc);

-- mod_rules: moderation in the ops bot (§9.I.72–74)
create table if not exists public.mod_rules (
  id bigint generated always as identity primary key,
  key text not null unique,
  kind text not null check (kind in ('keyword', 'link_block', 'flood', 'impersonation', 'cas', 'captcha', 'repeat_question')),
  lang text not null default 'both' check (lang in ('en', 'ms', 'both')),
  patterns text[] not null default '{}',   -- keywords / regexes
  params jsonb not null default '{}'::jsonb,       -- {"max_msgs":5,"window_s":10}, {"new_member_hours":24}
  action text not null default 'warn' check (action in ('flag', 'delete', 'warn', 'mute', 'ban', 'warn_mute_ban')),
  applies_to text not null default 'group' check (applies_to in ('group', 'channel_comments', 'both')),
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- moderation_events: what the bot did and why
create table if not exists public.moderation_events (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  user_id bigint,
  message_id bigint,
  rule_key text references public.mod_rules (key) on delete set null,
  action_taken text not null,              -- flagged | deleted | warned | muted | banned | cas_blocked
  detail text,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_moderation_events_chat on public.moderation_events (chat_id, occurred_at desc);
create index if not exists idx_moderation_events_user on public.moderation_events (user_id, occurred_at desc);
