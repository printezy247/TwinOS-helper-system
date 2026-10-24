-- 20261024000400_ai_pipeline.sql — Phase 5 (UPGRADE-PHASES): versioned
-- prompt library, agent memory, eval run history.
--
--   prompts       versioned system-prompt rows. /ai/generate prefers the
--                 active row for its mode (mode='*' is the global default)
--                 over the hard-coded template in _shared/openrouter.ts, so a
--                 prompt can be edited, versioned and promoted without a
--                 function deploy. The dashboard picker pins a (name, version)
--                 per request; the prompt_version setting pins globally.
--   ai_memory     mem0-shaped lines the generator prepends: preferences, hooks
--                 that worked, compliance corrections. Written by Jack's
--                 route, read inside /ai/generate.
--   ai_eval_runs  one row per golden case per run of the ai-eval function.
--
-- All three are RLS-on with no policies: nothing reads them through
-- PostgREST. Every access runs in edge functions under the service key —
-- the same shape as jobs/api_keys.

create table if not exists public.prompts (
  id bigint generated always as identity primary key,
  name text not null,
  version int not null check (version >= 1),
  mode text not null default '*',           -- a draft mode, or '*' (any mode)
  platform text,                            -- null = any platform
  pillar text,                              -- null = any pillar
  lang text not null default 'en' check (lang in ('en', 'ms')),
  body text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null default 'jack',
  unique (name, version)
);

alter table public.prompts enable row level security;

-- One active row per (mode, platform, pillar, lang) bucket.
create unique index if not exists prompts_active_uniq
  on public.prompts (mode, coalesce(platform, ''), coalesce(pillar, ''), lang)
  where active;

-- Seed the library with what the code already ships, so the picker and the
-- generator have something real on day one: the system persona from
-- _shared/openrouter.ts becomes an editable, versioned row.
insert into public.prompts (name, version, mode, body, active)
select 'system-default', 1, '*',
       'You are the TwinOS AI Assistant for EzyMap, a premier gold & forex trading community. Write concise, engaging, high-converting, professional trading content. Strictly adhere to compliance: no guaranteed returns, include risk awareness, 1 call to action.',
       true
where not exists (select 1 from public.prompts where name = 'system-default');

create table if not exists public.ai_memory (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('preference', 'hook', 'correction')),
  content text not null,
  pillar text,
  platform text,
  lang text not null default 'en' check (lang in ('en', 'ms')),
  weight numeric not null default 1,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.ai_memory enable row level security;

create table if not exists public.ai_eval_runs (
  id bigint generated always as identity primary key,
  prompt_name text not null,
  prompt_version int not null,
  case_name text not null,
  passed boolean not null,
  findings jsonb not null default '[]'::jsonb,
  output text,
  error text,
  model text,
  created_at timestamptz not null default now()
);
alter table public.ai_eval_runs enable row level security;

-- Global pin the generator reads. seed.sql carries the same row for a fresh
-- database; the NOT EXISTS form needs no unique-constraint guesswork.
insert into public.settings (key, value, description, needs_confirm)
select 'prompt_version', '"1"',
       'Prompt library version /ai/generate pins to; null follows each row''s active flag.',
       false
where not exists (select 1 from public.settings where key = 'prompt_version');
