-- 0007_views.sql — the reports (§4.8, §9.L, §10 "Views").
-- v_results_board is the only object anon may read (§9.A.1). It runs as its
-- owner (default), so it can read signals despite RLS; every other view is
-- security_invoker so the caller's own RLS applies.

create or replace function public.twinos_tz()
returns text
language sql
stable
as $$
  select coalesce(public.setting_text('timezone'), 'Asia/Kuala_Lumpur');
$$;

create or replace function public.local_week_start(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select date_trunc('week', p_at at time zone public.twinos_tz())::date;
$$;

grant execute on function public.twinos_tz() to anon, authenticated, service_role;
grant execute on function public.local_week_start(timestamptz) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- v_results_board: public, per-signal rows + rolling 28-day strict stats.
-- Only live, non-shadow signals. No chat ids, no confidence internals.
-- ---------------------------------------------------------------------------
create or replace view public.v_results_board as
with rolling as (
  select * from public.results_stats(now() - interval '28 days', now())
)
select
  s.id,
  s.external_id,
  s.source,
  s.pair,
  s.direction,
  s.timeframe,
  s.style,
  s.entry,
  s.entry_low,
  s.entry_high,
  s.stop_loss,
  s.tp1,
  s.tp2,
  s.rr_target,
  s.counter_trend,
  s.status,
  public.outcome_class(s.status, s.r_multiple) as outcome_class,
  s.r_multiple,
  s.exit_price,
  s.signal_at,
  s.resolved_at,
  exists (select 1 from public.signal_posts p where p.signal_id = s.id and p.kind = 'card') as posted_to_channel,
  exists (select 1 from public.signal_posts p where p.signal_id = s.id and p.kind = 'result') as result_posted,
  r.wins as wins_28d,
  r.losses as losses_28d,
  r.break_even as break_even_28d,
  r.strict_win_rate as strict_win_rate_28d,
  r.total_r as total_r_28d
from public.signals s
cross join rolling r
where s.data_source = 'live' and s.status <> 'shadow'
order by s.signal_at desc;
comment on view public.v_results_board is 'Public results board. Strict win rate = W / (W + L), break-even excluded. Demo/shadow rows never appear.';

-- Weekly strict stats for the Friday scorecard (template 7) — invoker's RLS applies.
create or replace view public.v_results_weekly
with (security_invoker = true) as
with base as (
  select s.*, public.local_week_start(s.signal_at) as week_start,
         public.outcome_class(s.status, s.r_multiple) as cls
  from public.signals s
  where s.data_source = 'live' and s.status <> 'shadow'
)
select
  b.week_start,
  count(*) as signals,
  count(*) filter (where b.cls = 'win') as wins,
  count(*) filter (where b.cls = 'loss') as losses,
  count(*) filter (where b.cls = 'be') as break_even,
  count(*) filter (where b.cls = 'open') as open_signals,
  public.strict_win_rate(count(*) filter (where b.cls = 'win'), count(*) filter (where b.cls = 'loss')) as strict_win_rate,
  round(coalesce(sum(b.r_multiple) filter (where b.cls in ('win', 'loss', 'be')), 0), 2) as total_r,
  (select jsonb_build_object('pair', x.pair, 'direction', x.direction, 'r', x.r_multiple, 'signal_at', x.signal_at)
     from base x where x.week_start = b.week_start and x.r_multiple is not null
    order by x.r_multiple desc limit 1) as best_trade,
  (select jsonb_build_object('pair', x.pair, 'direction', x.direction, 'r', x.r_multiple, 'signal_at', x.signal_at)
     from base x where x.week_start = b.week_start and x.r_multiple is not null
    order by x.r_multiple asc limit 1) as worst_trade
from base b
group by b.week_start
order by b.week_start desc;

-- ---------------------------------------------------------------------------
-- v_content_log: the Google Sheet columns, filled automatically (§9.L.96)
-- Date · Time · Post type · Language · Link · Views after 24h · Reactions · Bot /starts · Notes
-- ---------------------------------------------------------------------------
create or replace view public.v_content_log
with (security_invoker = true) as
select
  (p.posted_at at time zone public.twinos_tz())::date as post_date,
  (p.posted_at at time zone public.twinos_tz())::time as post_time,
  coalesce(p.post_type, i.post_type) as post_type,
  coalesce(p.lang, v.lang) as lang,
  'https://' || coalesce(public.setting_text('channel_handle'), 't.me/ezymap') || '/' || p.message_id as link,
  s24.views as views_24h,
  s24.reactions_total as reactions,
  (select count(*) from public.bot_start_tags t where p.bot_link_tag is not null and t.tag = p.bot_link_tag
     and t.started_at between p.posted_at and p.posted_at + interval '7 days') as bot_starts,
  i.title as notes,
  p.chat_id,
  p.message_id,
  v.id as variant_id,
  i.icp,
  i.pillar
from public.tg_posts p
left join public.content_variants v on v.id = p.variant_id
left join public.content_items i on i.id = v.item_id
left join public.post_snapshots s24 on s24.chat_id = p.chat_id and s24.message_id = p.message_id and s24.offset_label = '24h'
where p.deleted_at is null
order by p.posted_at desc;

-- ---------------------------------------------------------------------------
-- v_friday_scoreboard: the twelve Friday numbers, one row per week (§4.8, Growth Plan §14)
-- ---------------------------------------------------------------------------
create or replace view public.v_friday_scoreboard
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
  group by week_start, kind, metric
)
select
  w.week_start,
  -- Telegram
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
  -- TikTok (manual weekly entry or TikTok Studio export)
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'followers') as tiktok_followers,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'profile_views') as tiktok_profile_views,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'watch_time_s') as tiktok_watch_time_s,
  (select value from mm where mm.week_start = w.week_start and kind = 'tiktok' and metric = 'pct_watched_full') as tiktok_pct_watched_full,
  -- Bot /start by source tag
  (select coalesce(jsonb_object_agg(t.tag, t.n), '{}'::jsonb)
     from (select tag, count(*) as n from public.bot_start_tags
            where started_at >= w.week_from and started_at < w.week_to group by tag) t) as bot_starts_by_tag,
  -- Vantage portal (weekly two-minute form)
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'ib_accounts_opened') as ib_accounts_opened,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'first_time_depositors') as first_time_depositors,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'active_funded_clients') as active_funded_clients,
  (select value from mm where mm.week_start = w.week_start and kind = 'vantage' and metric = 'rebates_usd') as ib_rebates_usd,
  -- Products
  (select value from mm where mm.week_start = w.week_start and kind = 'revenue' and metric = 'product_revenue_usd') as product_revenue_usd,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'active_subscribers') as active_subscribers,
  (select value from mm where mm.week_start = w.week_start and kind = 'subscriptions' and metric = 'expiring_7d') as expiring_7d,
  -- Signals posted vs results posted (must be 100%)
  (select count(*) from public.signal_posts sp where sp.kind = 'card' and sp.posted_at >= w.week_from and sp.posted_at < w.week_to) as signals_posted,
  (select count(distinct sp.signal_id) from public.signal_posts sp
    where sp.kind = 'card' and sp.posted_at >= w.week_from and sp.posted_at < w.week_to
      and exists (select 1 from public.signal_posts r where r.signal_id = sp.signal_id and r.kind = 'result')) as results_posted,
  -- Strict win rate and total R over the 4 weeks ending this week
  (select strict_win_rate from public.results_stats(w.week_to - interval '28 days', w.week_to)) as strict_win_rate_4w,
  (select total_r from public.results_stats(w.week_to - interval '28 days', w.week_to)) as total_r_4w,
  -- Value-to-offer ratio (§9.E.41)
  (select count(*) from public.tg_posts p where p.post_type = 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as offer_posts,
  (select count(*) from public.tg_posts p where p.post_type is distinct from 'offer' and p.posted_at >= w.week_from and p.posted_at < w.week_to and p.deleted_at is null) as value_posts,
  -- Which ICP each week's content served (§4.2)
  (select coalesce(jsonb_object_agg(coalesce(i.icp::text, 'untagged'), i.n), '{}'::jsonb)
     from (select icp, count(*) as n from public.content_items
            where created_at >= w.week_from and created_at < w.week_to group by icp) i) as icp_served
from w
order by w.week_start desc;

-- ---------------------------------------------------------------------------
-- v_funnel: TikTok/ad → bot start → channel join → IB account / depositor (§9.H.68)
-- ---------------------------------------------------------------------------
create or replace view public.v_funnel
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
)
select
  w.week_start,
  (select coalesce(sum(m.views), 0) from public.post_metrics m
    where m.platform = 'tiktok' and m.captured_at >= w.week_from and m.captured_at < w.week_to) as tiktok_views,
  (select count(*) from public.bot_start_tags t where t.started_at >= w.week_from and t.started_at < w.week_to) as bot_starts,
  (select coalesce(jsonb_object_agg(t.tag, t.n), '{}'::jsonb)
     from (select tag, count(*) as n from public.bot_start_tags
            where started_at >= w.week_from and started_at < w.week_to group by tag) t) as bot_starts_by_tag,
  (select count(*) from public.member_events e where e.kind = 'join' and e.occurred_at >= w.week_from and e.occurred_at < w.week_to) as channel_joins,
  (select coalesce(jsonb_object_agg(coalesce(l.source, 'unknown'), j.n), '{}'::jsonb)
     from (select invite_link_name, count(*) as n from public.member_events
            where kind = 'join' and occurred_at >= w.week_from and occurred_at < w.week_to group by invite_link_name) j
     left join public.invite_links l on l.name = j.invite_link_name) as joins_by_source,
  (select count(*) from public.member_events e
    where e.kind = 'join' and e.occurred_at >= w.week_from and e.occurred_at < w.week_to
      and exists (select 1 from public.invite_links l where l.name = e.invite_link_name and l.source = 'swap')) as swap_joins,
  (select count(*) from public.memberships m
    where m.joined_at >= w.week_from and m.joined_at < w.week_to
      and (m.left_at is null or m.left_at >= m.joined_at + interval '7 days')
      and m.joined_at + interval '7 days' <= now()) as retained_7d,
  (select sum(value) from public.manual_metrics x where x.week_start = w.week_start and x.kind = 'vantage' and x.metric = 'ib_accounts_opened') as ib_accounts_opened,
  (select sum(value) from public.manual_metrics x where x.week_start = w.week_start and x.kind = 'vantage' and x.metric = 'first_time_depositors') as first_time_depositors,
  (select sum(value) from public.manual_metrics x where x.week_start = w.week_start and x.kind = 'ads' and x.metric = 'ad_spend_usd') as ad_spend_usd,
  (select round(sum(value) filter (where metric = 'ad_spend_usd') / nullif(sum(value) filter (where metric = 'first_time_depositors'), 0), 2)
     from public.manual_metrics x where x.week_start = w.week_start and x.kind in ('ads', 'vantage')) as cost_per_ftd_usd
from w
order by w.week_start desc;

-- ---------------------------------------------------------------------------
-- v_quarter_targets: Growth Plan §11 targets vs actuals (§9.L.99)
-- settings.quarter_targets = [{"quarter","ends_on","members","active_funded","revenue_per_day","stop_if"}]
-- ---------------------------------------------------------------------------
create or replace view public.v_quarter_targets
with (security_invoker = true) as
with t as (
  select q ->> 'quarter' as quarter,
         (q ->> 'ends_on')::date as ends_on,
         (q ->> 'members')::integer as target_members,
         (q ->> 'active_funded')::integer as target_active_funded,
         (q ->> 'revenue_per_day')::numeric as target_revenue_per_day,
         q ->> 'stop_if' as stop_if_rule
  from jsonb_array_elements(coalesce(public.setting('quarter_targets'), '[]'::jsonb)) q
),
actual as (
  select
    (select d.member_count from public.channel_daily d
      where d.source = 'bot_api' and d.chat_id = (public.setting('channel_chat_id') #>> '{}')::bigint
      order by d.day desc limit 1) as members,
    (select value from public.manual_metrics
      where kind = 'vantage' and metric = 'active_funded_clients' order by week_start desc limit 1) as active_funded,
    (select round((coalesce(sum(value) filter (where metric = 'product_revenue_usd'), 0)
                 + coalesce(sum(value) filter (where metric = 'rebates_usd'), 0)) / 7, 2)
       from public.manual_metrics
      where metric in ('product_revenue_usd', 'rebates_usd')
        and week_start = (select max(week_start) from public.manual_metrics where metric in ('product_revenue_usd', 'rebates_usd'))) as revenue_per_day
)
select
  t.quarter, t.ends_on, t.stop_if_rule,
  t.target_members, a.members as actual_members,
  round(100.0 * a.members / nullif(t.target_members, 0), 1) as members_pct,
  t.target_active_funded, a.active_funded as actual_active_funded,
  round(100.0 * a.active_funded / nullif(t.target_active_funded, 0), 1) as active_funded_pct,
  t.target_revenue_per_day, a.revenue_per_day as actual_revenue_per_day,
  round(100.0 * a.revenue_per_day / nullif(t.target_revenue_per_day, 0), 1) as revenue_pct,
  (t.ends_on - current_date) as days_left
from t cross join actual a
order by t.ends_on;

-- ---------------------------------------------------------------------------
-- v_stop_if: the stop-if alarms (§1). Rule 1 flags any posted signal past its
-- expiry window (or already resolved) with no result reply under it (§9.D.25).
-- ---------------------------------------------------------------------------
create or replace view public.v_stop_if
with (security_invoker = true) as
select
  'signal_without_result' as rule,
  'Q4 2026' as quarter,
  'critical' as severity,
  s.id as signal_id,
  jsonb_build_object(
    'external_id', s.external_id, 'pair', s.pair, 'direction', s.direction,
    'status', s.status, 'signal_at', s.signal_at,
    'expires_at', coalesce(s.expires_at, s.signal_at + make_interval(hours => coalesce((public.setting('signal_expiry_hours') #>> '{}')::integer, 24))),
    'card_chat_id', c.chat_id, 'card_message_id', c.message_id
  ) as detail,
  now() as flagged_at
from public.signals s
join public.signal_posts c on c.signal_id = s.id and c.kind = 'card'
where s.data_source = 'live'
  and s.status <> 'shadow'
  and not exists (select 1 from public.signal_posts r where r.signal_id = s.id and r.kind = 'result')
  and (
    s.status not in ('open')
    or coalesce(s.expires_at, s.signal_at + make_interval(hours => coalesce((public.setting('signal_expiry_hours') #>> '{}')::integer, 24))) < now()
  )
union all
select
  'cost_per_ftd_over_120_two_weeks', 'Q1 2027', 'critical', null,
  jsonb_build_object('weeks', jsonb_agg(jsonb_build_object('week_start', x.week_start, 'cost_per_ftd_usd', x.cost_per_ftd_usd) order by x.week_start)),
  now()
from (
  select week_start, cost_per_ftd_usd from public.v_funnel
  where cost_per_ftd_usd is not null order by week_start desc limit 2
) x
having count(*) = 2 and bool_and(x.cost_per_ftd_usd > 120)
union all
select
  'refund_or_complaint_rate_over_3pct', 'Q2 2027', 'critical', null,
  jsonb_build_object('week_start', m.week_start, 'rate_pct', m.value),
  now()
from public.manual_metrics m
where m.kind = 'support' and m.metric = 'refund_complaint_rate_pct' and m.value > 3
  and m.week_start = (select max(week_start) from public.manual_metrics where kind = 'support' and metric = 'refund_complaint_rate_pct');
