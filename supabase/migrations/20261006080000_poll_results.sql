-- 20261006080000_poll_results.sql — read the tally back (UPGRADE-IDEAS #26).
--
-- The poll template has promised since Phase 5 that results feed next week's
-- lesson topics. Native polls have been posting since 5 Oct; this stores what
-- members answered.
--
-- Telegram sends a tally as its own update with no chat and no message id —
-- only `poll.id`. The only way back to the post that asked is the id captured
-- when the poll went out, which is why tg_posts grows a column for it. A poll
-- sent before this migration still gets its row; it just cannot say which
-- post it came from.
--
-- Nothing here approves or posts: the webhook only writes.

create table if not exists public.poll_results (
  poll_id text primary key,                       -- Telegram's id, one row per poll
  chat_id bigint,
  message_id bigint,
  variant_id uuid references public.content_variants (id) on delete set null,
  question text not null default '',
  options jsonb not null default '[]'::jsonb,     -- [{text, votes}], in the order they were asked
  total_voters integer not null default 0,
  is_closed boolean not null default false,
  captured_at timestamptz not null default now(),  -- last tally seen, not first
  created_at timestamptz not null default now()
);

alter table public.tg_posts add column if not exists poll_id text;

create index if not exists idx_poll_results_captured on public.poll_results (captured_at desc);

comment on column public.poll_results.captured_at is
  'updated on every update.poll: a tally is a live number, so it overwrites';

drop policy if exists jack_all on public.poll_results;
drop policy if exists readers_select on public.poll_results;
create policy jack_all on public.poll_results for all to authenticated
  using (public.twinos_role() = 'jack');
create policy readers_select on public.poll_results for select to authenticated
  using (public.twinos_role() in ('abdul', 'dashboard', 'cron'));
grant select on public.poll_results to authenticated;
