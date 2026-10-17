-- 20261018000000_fix_view_metric_names.sql — two reporting views were reading
-- a value that never arrives.
--
--   B4  v_signal_ledger.card_posted counted kind = 'card', but 0011 widened the
--       vocabulary and the only live writer inserts 'signal' (and 'result' for
--       the reply). Every other reader of signal_posts was corrected; this view
--       was created after that fix and never was, so the public trust ledger
--       said a card had never been posted for any signal.
--
--   B5  v_friday_scoreboard read metric = 'watch_time_s'. The form that writes
--       it (friday/manual, MANUAL_FIELDS.tiktok) writes 'watch_time_min', which
--       is the number TikTok shows Jack. So tiktok_watch_time_s was permanently
--       null. The view follows the input, not the other way round: Jack types
--       minutes, the column is named in minutes, and nothing multiplies by 60
--       behind his back.
--
-- Neither view is edited in place: they are applied to a live project, so both
-- are dropped and recreated here. Drop/create loses column grants, hence the
-- re-grant at the end — the same shape 20261005000001 had to repair.


drop view if exists public.v_signal_ledger;
create view public.v_signal_ledger
with (security_invoker = true) as
select s.id,
       s.pair,
       s.direction,
       s.entry,
       s.created_at,
       -- 'signal' is the card the publisher writes; 'card' is the old label kept
       -- by the enum. Counting only 'card' made every row say the card was
       -- never posted, and nothing in the codebase writes 'card' at all.
       coalesce(bool_or(sp.kind in ('card', 'signal')), false) as card_posted,
       coalesce(bool_or(sp.kind = 'result'), false)            as result_posted
  from public.signals s
  left join public.signal_posts sp on sp.signal_id = s.id
 group by s.id, s.pair, s.direction, s.entry, s.created_at;
comment on view public.v_signal_ledger is 'Every signal, its card and its result. Publicly honest: card_posted counts both signal_posts kinds.';

drop view if exists public.v_friday_scoreboard;
create view public.v_friday_scoreboard
with (security_invoker = true) as
with weeks as (
  select (public.local_week_start(now()) - (n * 7))::date as week_start
  from generate_series(0, 12) as n
),
w as (
  select week_start,
         (week_start::timestamp at time zone public.twinos_tz()) as week_from,
         ((week_start + 7)::timestamp at time zone public.twinos_tz()) as week_to
  from weeks
),
channel as (
  select (public.setting('channel_chat_id') #>> '{}')::bigint as chat_id
),
mm as (
  select week_start, kind, metric, sum(value) as value
  from public.manual_metrics
  where metric is distinct from '_summary'
  group by week_start, kind, metric
)
select
  w.week_start,
  (select d.member_count from public.channel_daily d, channel c
     where d.chat_id = c.chat_id and d.source = 'bot_api' and d.day < w.week_start + 7
     order by d.day desc limit 1) as channel_members,
  (select count(*) filter (where e.kind = 'join') - count(*) filter (where e.kind = 'leave')
     from public.member_events e, channel c
    where e.chat_id = c.chat_id and e.occurred_at >= w.week_from and e.occurred_at < w.week_to) as net_joins,
  (select round(100.0 * avg(s.views) / nullif(max(d.member_count), 0), 1)
     from public.tg_posts p
     join public.post_snapshots s on s.chat_id = p.chat_id and s.message_id = p.message_id and s.offset_label = '24h'
     left join public.channel_daily d on d.chat_id = p.chat_id and d.source = 'bot_api' and d.day = (p.posted_at at time zone public.twinos_tz())::date
    where p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as avg_views_pct_of_members,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'followers') as tiktok_followers,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'profile_views') as tiktok_profile_views,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'watch_time_min') as tiktok_watch_time_min,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'pct_watched_full') as tiktok_pct_watched_full,
  (select coalesce(jsonb_object_agg(t.tag, t.n), '{}'::jsonb)
     from (select tag, count(*) as n from public.bot_start_tags
            where started_at >= w.week_from and started_at < w.week_to group by tag) t) as bot_starts_by_tag,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'ib_accounts_opened') as ib_accounts_opened,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'first_time_depositors') as first_time_depositors,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'active_funded_clients') as active_funded_clients,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'rebates_usd') as ib_rebates_usd,
  (select value from mm where mm.week_start = w.week_start and kind = 'revenue' and metric = 'product_revenue_usd') as product_revenue_usd,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'active_subscribers') as active_subscribers,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'expiring_7d') as expiring_7d,
  (select count(*) from public.signal_posts sp where sp.kind in ('card', 'signal') and sp.posted_at >= w.week_from and sp.posted_at < w.week_to) as signals_posted,
  (select count(distinct sp.signal_id) from public.signal_posts sp
    where sp.kind in ('card', 'signal') and sp.posted_at >= w.week_from and sp.posted_at < w.week_to
      and exists (select 1 from public.signal_posts r where r.signal_id = sp.signal_id and r.kind = 'result')) as results_posted,
  (select strict_win_rate from public.results_stats(w.week_to - interval '28 days', w.week_to)) as strict_win_rate_4w,
  (select total_r from public.results_stats(w.week_to - interval '28 days', w.week_to)) as total_r_4w,
  (select count(*) from public.tg_posts p where p.post_type = 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as offer_posts,
  (select count(*) from public.tg_posts p where p.post_type is distinct from 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as value_posts,
  (select coalesce(jsonb_object_agg(coalesce(i.icp::text, 'untagged'), i.n), '{}'::jsonb)
     from (select icp, count(*) as n from public.content_items
            where created_at >= w.week_from and created_at < w.week_to group by icp) i) as icp_served
from w
order by w.week_start desc;
comment on view public.v_friday_scoreboard is 'The twelve Friday numbers per week (plan §4.8). TikTok, Vantage and Telechurn numbers are entered by hand; everything else is counted here.';

-- Drop/create loses grants. The dashboard JWT would get permission-denied
-- before RLS is consulted without these.
grant select on public.v_signal_ledger, public.v_friday_scoreboard to authenticated;
