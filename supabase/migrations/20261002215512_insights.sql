-- 0032: research-driven upgrades (2026-10-02 research pass).
--
--   tg_updates.failures        poison-update guard: an update whose handler
--                              keeps crashing is dropped after the limit
--   content_variants.hook_id   which library hook opened the draft (A/B)
--   v_best_times               which posting hours earn the most views
--   v_post_engagement          views_24h over members per post
--   v_hook_performance         per hook: uses and average 1 h views
--   v_signal_ledger            every signal and its result, publicly honest
--   signal_deletion_guard      a posted signal card is never deleted
--
-- All views are security_invoker like the other reporting views.

-- ---------------------------------------------------------------------
-- Poison updates: Telegram re-sends on any non-200, so one handler fault
-- can replay for hours. The webhook counts failures per update_id and
-- drops the update once it passes UPDATE_FAIL_LIMIT (3).
-- ---------------------------------------------------------------------
alter table public.tg_updates add column if not exists failures integer not null default 0;

-- ---------------------------------------------------------------------
-- Hook A/B (research 2026-10-02: hook choice is one of two levers that
-- move reach). The draft records which library hook opened it; the
-- snapshot joins say which hooks earn views.
-- ---------------------------------------------------------------------
alter table public.content_variants add column if not exists hook_id bigint references public.hooks (id) on delete set null;
create index if not exists idx_content_variants_hook on public.content_variants (hook_id) where hook_id is not null;

-- Which posting hour earns the most 1 h views (MYT clock).
create or replace view public.v_best_times
with (security_invoker = true) as
select extract(hour from p.posted_at at time zone 'Asia/Kuala_Lumpur')::int as hour_my,
       count(*) as posts,
       round(avg(s.views)) as avg_views_1h
  from public.tg_posts p
  join public.post_snapshots s
    on s.chat_id = p.chat_id and s.message_id = p.message_id and s.offset_label = '1h'
 where s.views is not null
 group by 1
 order by avg_views_1h desc nulls last;

-- Views in 24 h as a percentage of members at post time.
create or replace view public.v_post_engagement
with (security_invoker = true) as
select p.posted_at,
       p.post_type,
       s.views as views_24h,
       d.member_count as members,
       case when d.member_count > 0
            then round(100.0 * s.views / d.member_count, 1) end as engagement_pct
  from public.tg_posts p
  join public.post_snapshots s
    on s.chat_id = p.chat_id and s.message_id = p.message_id and s.offset_label = '24h'
  left join lateral (
       select member_count from public.channel_daily c
        where c.chat_id = p.chat_id and c.member_count is not null and c.day <= p.posted_at::date
        order by c.day desc limit 1
  ) d on true
 where s.views is not null;

-- Per hook: how often it opened a draft and what its posts earned at 1 h.
create or replace view public.v_hook_performance
with (security_invoker = true) as
select v.hook_id,
       h.text as hook,
       h.lang,
       count(*) as uses,
       round(avg(s.views)) as avg_views_1h
  from public.content_variants v
  join public.hooks h on h.id = v.hook_id
  left join public.tg_posts p on p.variant_id = v.id
  left join public.post_snapshots s
    on s.chat_id = p.chat_id and s.message_id = p.message_id and s.offset_label = '1h'
 group by v.hook_id, h.text, h.lang;

-- The public ledger: every signal, its card and its result. Nothing here
-- can be hidden (the delete guard below makes that literal).
create or replace view public.v_signal_ledger
with (security_invoker = true) as
select s.id,
       s.pair,
       s.direction,
       s.entry,
       s.created_at,
       coalesce(bool_or(sp.kind = 'card'), false)   as card_posted,
       coalesce(bool_or(sp.kind = 'result'), false) as result_posted
  from public.signals s
  left join public.signal_posts sp on sp.signal_id = s.id
 group by s.id, s.pair, s.direction, s.entry, s.created_at;

-- ---------------------------------------------------------------------
-- Signal-deletion watchdog: a posted signal is never deleted (r/defi's
-- complaint is channels that delete losing trades; our ledger is the
-- opposite promise). Updates are fine; deletion is not.
-- ---------------------------------------------------------------------
create or replace function public.signal_deletion_guard() returns trigger as $$
begin
  raise exception 'a posted signal is never deleted (edit or annotate instead)';
end;
$$ language plpgsql;

drop trigger if exists trg_signal_posts_no_delete on public.signal_posts;
create trigger trg_signal_posts_no_delete
  before delete on public.signal_posts
  for each row execute function public.signal_deletion_guard();
