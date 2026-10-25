-- 20261026000300_ai_usage.sql — every AI generation leaves a countable
-- fact (C4): which model ran, how many tokens it charged, or an explicit
-- "usage_unknown" row. Choosing a model stops being a guess when the week's
-- spend per model is one query away.
--
-- Why a new table instead of ai_eval_runs: that table is one row per golden
-- CASE per eval run (prompt_name/case_name/passed); production generations
-- have no case, and mixing them would make the eval report unreadable.
--
-- No USD column on purpose: a price is a number we would have to invent.
-- Token counts are what the provider actually returns; week-to-date spend by
-- model is computable from them the moment a price table is added.
-- usage_unknown rows carry null tokens and are counted, never estimated.
create table if not exists public.ai_usage (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  mode              text,                          -- draft_post, polish, ...
  model             text,
  prompt_tokens     bigint,
  completion_tokens bigint,
  usage_unknown     boolean not null default false -- provider gave no usage
);

-- Closed like request_stats: only service_role (the functions) writes and
-- reads it; the dashboard sees it through GET /health/ai-usage.
alter table public.ai_usage enable row level security;

create index if not exists idx_ai_usage_ts on public.ai_usage (ts);
