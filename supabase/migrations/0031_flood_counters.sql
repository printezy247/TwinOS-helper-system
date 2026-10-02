-- 0031: per-message counter for flood control (Phase 4 fix).
-- tg-webhook logs every discussion-group message here and counts the
-- sender's rows inside the flood window; rows older than a day are deleted
-- on write. Group text never leaves this table (plan §6: no AI on it).
create table if not exists public.flood_counters (
  chat_id bigint not null,
  user_id bigint not null,
  at timestamptz not null default now()
);
create index if not exists idx_flood_counters_user on public.flood_counters (chat_id, user_id, at desc);
alter table public.flood_counters enable row level security;
