-- 0002_content.sql — templates, voice, calendar, the publish queue.
-- UPGRADE-PLAN §4.5–4.7, §9.C, §9.E, §9.J, §10.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'post_type') then
    create type public.post_type as enum (
      'gold_map', 'macro_card', 'signal', 'result', 'lesson', 'audit', 'scorecard',
      'outlook', 'offer', 'poll', 'evening_wrap', 'news_alert', 'member_result',
      'holiday_milestone', 'start_here'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type public.content_status as enum (
      'draft', 'pending_approval', 'approved', 'scheduled', 'publishing', 'published', 'failed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'platform') then
    create type public.platform as enum (
      'telegram', 'tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'x', 'whatsapp'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- templates: the 15 post types from the Posting Kit (§4.5, §9.C.17)
-- ---------------------------------------------------------------------------
create table if not exists public.templates (
  key public.post_type primary key,
  kit_number smallint not null unique,     -- POST 1..15 in the kit
  name text not null,
  schedule text,                           -- "Daily 08:00", "Wednesday", ...
  prompt_text text not null,               -- the kit's "PROMPT TO COPY", verbatim
  fields jsonb not null default '[]'::jsonb,       -- {CURLY} placeholders the prompt needs
  examples jsonb not null default '[]'::jsonb,     -- [{label, lang, body}] example copy from the kit
  required_lines text[] not null default '{}',     -- risk | disclosure | past_performance | permission | education
  char_limit integer,
  hashtag text,
  approval_rule text not null,             -- plain-language rule from the kit / plan
  requires_approval boolean not null default false,
  default_platform public.platform not null default 'telegram',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.templates is 'One row per Posting Kit post type. prompt_text is quoted from the kit; required_lines and approval_rule feed the compliance engine (§12).';

-- ---------------------------------------------------------------------------
-- style_guide: master prompt, voice rules, banned words, emoji/format rules,
-- glossary, disclaimers, Jack's notes (§4.5, §4.10, §9.J)
-- ---------------------------------------------------------------------------
create table if not exists public.style_guide (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'master_prompt', 'voice_rule', 'rule', 'banned_word', 'emoji_rule', 'format_rule',
    'glossary', 'disclaimer', 'hashtag_index', 'trade_card_format', 'checklist',
    'caption_pattern', 'live_rule', 'jack_note', 'tiktok_rule'
  )),
  key text,                                -- stable handle, e.g. 'risk_line_short'
  lang text not null default 'en' check (lang in ('en', 'ms', 'both')),
  body text not null,
  extra jsonb,                             -- e.g. {"ms": "..."} for glossary pairs, {"pass_if": "..."} for checklist
  source text,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_style_guide_kind on public.style_guide (kind, sort_order) where active;
create unique index if not exists idx_style_guide_key on public.style_guide (kind, key) where key is not null;

-- ---------------------------------------------------------------------------
-- hooks: the 40-line hook bank (FYP §03)
-- ---------------------------------------------------------------------------
create table if not exists public.hooks (
  id bigint generated always as identity primary key,
  pair_no smallint not null,               -- 1..20, EN and BM of the same line share a pair_no
  lang text not null check (lang in ('en', 'ms')),
  text text not null,
  pillar text,                             -- optional hint: map_recap | channel_audit | lesson | start_safe | tool_demo | jacks_desk
  times_used integer not null default 0,
  last_used_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (pair_no, lang)
);

-- ---------------------------------------------------------------------------
-- calendar_slots: 28-day TikTok calendar + channel daily/weekly rhythm (§4.4, §4.6)
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_slots (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('tiktok_28day', 'channel_daily', 'channel_weekly', 'live')),
  week_no smallint,                        -- 1..4 for the TikTok cycle, NULL for channel rhythm
  dow smallint check (dow between 1 and 7),-- 1 = Monday .. 7 = Sunday; NULL = every day
  time_local time,                         -- Asia/Kuala_Lumpur; NULL = session-driven
  time_label text,                         -- "London/NY", "On hit", "Session"
  platform public.platform not null default 'tiktok',
  post_type public.post_type,
  pillar text,                             -- map_recap | channel_audit | lesson | start_safe | tool_demo | jacks_desk
  topic text,
  lang text check (lang in ('en', 'ms')),  -- NULL = per language test (§9.E.42)
  who text,                                -- jack | abdul | auto | jack+auto | ops_bot
  source text,                             -- which document the slot comes from
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_calendar_kind on public.calendar_slots (kind, week_no, dow) where active;

-- ---------------------------------------------------------------------------
-- live_runsheets: the three live formats (FYP §06)
-- ---------------------------------------------------------------------------
create table if not exists public.live_runsheets (
  key text primary key,                    -- ny_session | sunday_outlook | channel_audit_live
  name text not null,
  cadence text not null,                   -- "Mon, Wed, Thu" / "Sunday" / "once a month, replaces one NY live"
  start_time time,
  end_time time,
  segments jsonb not null,                 -- [{from_min, to_min, what, say}]
  rules jsonb not null default '[]'::jsonb,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- content_items → content_variants → publish_jobs (§9.E.30–31)
-- ---------------------------------------------------------------------------
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  post_type public.post_type not null references public.templates (key),
  pillar text,                             -- TikTok pillar when the item is a short
  icp smallint references public.personas (id),
  title text,
  brief text,                              -- Jack's raw lines / the one-line input
  inputs jsonb not null default '{}'::jsonb,       -- filled {FIELDS} for the template prompt
  signal_id uuid,                          -- set in 0003 (FK added there)
  calendar_slot_id bigint references public.calendar_slots (id) on delete set null,
  batch_week date,                         -- Wednesday batch this belongs to (week_start)
  batch_no smallint,                       -- numbered draft in the Desk group ("3: soften")
  planned_lang text check (planned_lang in ('en', 'ms')),
  planned_for timestamptz,
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_items_type on public.content_items (post_type, created_at desc);
create index if not exists idx_content_items_batch on public.content_items (batch_week, batch_no);

create table if not exists public.content_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items (id) on delete cascade,
  platform public.platform not null default 'telegram',
  lang text not null default 'en' check (lang in ('en', 'ms')),
  body text not null default '',
  media jsonb not null default '[]'::jsonb,        -- [{asset_id, kind, caption}]
  buttons jsonb not null default '[]'::jsonb,      -- [[{text, url|callback}]]
  claim_flags text[] not null default '{}',        -- price | level | result | percentage | offer | broker | testimonial
  board_refs uuid[] not null default '{}',         -- signals.id rows a result/scorecard quotes
  needed_fields text[] not null default '{}',      -- unresolved [NEEDED] placeholders block publishing
  status public.content_status not null default 'draft',
  requires_approval boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  scheduled_for timestamptz,
  published_at timestamptz,
  platform_post_id text,
  reply_to_message_id bigint,              -- result replies go under the original signal (§9.D.24)
  pin boolean not null default false,
  checks_passed boolean,
  version integer not null default 1,
  edited_by_jack boolean not null default false,   -- Jack's edits become exemplars (§9.J.81)
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_variants_item on public.content_variants (item_id);
create index if not exists idx_variants_status on public.content_variants (status, scheduled_for);
create index if not exists idx_variants_pending on public.content_variants (created_at desc) where status = 'pending_approval';

-- ---------------------------------------------------------------------------
-- assets: drop-folder exports, clips, captions, thumbnails (§9.F.44, §9.G)
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('video', 'video_clean', 'image', 'srt', 'transcript', 'thumbnail', 'scorecard_image', 'audio', 'other')),
  storage_bucket text not null default 'media',
  storage_path text not null,
  bytes bigint,
  duration_s numeric(8, 2),
  width integer,
  height integer,
  sha256 text,
  source text not null default 'upload',   -- drop_folder | studio | upload | render
  item_id uuid references public.content_items (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_assets_sha on public.assets (sha256) where sha256 is not null;
create unique index if not exists idx_assets_path on public.assets (storage_bucket, storage_path);
create index if not exists idx_assets_item on public.assets (item_id);

-- ---------------------------------------------------------------------------
-- publish_jobs: the scheduler's queue, idempotent, with backoff (§9.B.12, §9.E.32)
-- ---------------------------------------------------------------------------
create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.content_variants (id) on delete cascade,
  platform public.platform not null,
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  idempotency_key text not null unique,
  error_class text,                        -- rate_limit | auth | validation | network | platform | unknown
  error_message text,
  platform_post_id text,
  locked_by text,
  locked_at timestamptz,
  result jsonb,
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_publish_jobs_due on public.publish_jobs (run_at) where status in ('queued', 'running');
create index if not exists idx_publish_jobs_variant on public.publish_jobs (variant_id);

-- ---------------------------------------------------------------------------
-- platform_accounts: which account posts where. Tokens live in Vault (§9.A.6);
-- this table stores only the Vault secret NAME, never a token.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  platform public.platform not null,
  handle text,
  external_id text,                        -- page id / channel id / chat id as text
  vault_secret_name text,                  -- name in vault.secrets; the value is read only by Edge Functions
  scopes text[] not null default '{}',
  token_expires_at timestamptz,            -- watched by Health (§9.M.103)
  daily_limit integer,                     -- IG 100, FB 30, Threads 250 (§9.F)
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, handle)
);
comment on column public.platform_accounts.vault_secret_name is 'Name of the secret in Supabase Vault. Never store the token here.';

-- ---------------------------------------------------------------------------
-- compliance_checks: evidence trail per variant (§9.O.113, §12)
-- ---------------------------------------------------------------------------
create table if not exists public.compliance_checks (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.content_variants (id) on delete cascade,
  check_key text not null,                 -- numbers | words | risk_line | video_warning | ig_fb_cut | one_cta | disclosure | losses | results | member_results | format | language | tiktok_kit
  passed boolean not null,
  detail text,
  checked_by text not null default public.twinos_actor(),
  checked_at timestamptz not null default now()
);
create index if not exists idx_compliance_variant on public.compliance_checks (variant_id, checked_at desc);
