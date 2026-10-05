-- 0030: clip candidates for the upgraded clip pipeline (plan §17 Wave 4 item 3).
-- Moments are proposed by the PC worker (scene splits + transcript bursts)
-- and wait here for Jack: use cuts the window, drop discards it. Nothing
-- reaches CapCut or a draft before his tap.
create table if not exists public.clip_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete set null,
  source_path text not null,
  start_s numeric not null check (start_s >= 0),
  end_s numeric not null check (end_s > start_s),
  score numeric not null default 0,
  reason text not null default '',
  hook_text text,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'dropped')),
  content_id uuid references public.content_items (id) on delete set null,
  decided_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_clip_candidates_open on public.clip_candidates (created_at desc) where status = 'proposed';
alter table public.clip_candidates enable row level security;
