-- 0021_reporting_views.sql — two Friday numbers (Phase 3).
--
--   v_hours_cut    TwinOS's saved minutes per KL week against the baseline week
--                  (the first week anyone logged by hand in baseline_hours).
--                  Phase 3 exit: a cut of 60% or more.
--   v_fanout_week  per master post that was fanned out (content/fanout), how many
--                  provider copies there are and how many reached "published".
--                  TikTok, YouTube and X copies are kits (source.kit) and not counted.
--
-- Both are security_invoker, like the other reporting views: they read through
-- the caller's row-level security.

create or replace view public.v_hours_cut
with (security_invoker = true) as
with first_week as (
  select week_start, sum(minutes)::int as baseline_min
    from public.baseline_hours
   group by week_start
   order by week_start
   limit 1
), saved as (
  select (date_trunc('week', occurred_at at time zone 'Asia/Kuala_Lumpur'))::date as week_start,
         round(sum(minutes_saved))::int as saved_min
    from public.time_saved
   group by 1
)
select s.week_start,
       f.baseline_min,
       s.saved_min,
       case when f.baseline_min > 0 then round(100.0 * s.saved_min / f.baseline_min, 1) end as cut_pct
  from saved s
 cross join first_week f;

comment on view public.v_hours_cut is 'Saved minutes per KL week against the first baseline week (baseline_hours). cut_pct = saved / baseline.';

create or replace view public.v_fanout_week
with (security_invoker = true) as
select (date_trunc('week', m.created_at at time zone 'Asia/Kuala_Lumpur'))::date as week_start,
       m.id as master_id,
       count(c.id) filter (where not coalesce((c.source ->> 'kit')::boolean, false))::int as providers,
       count(c.id) filter (where not coalesce((c.source ->> 'kit')::boolean, false) and c.status = 'published')::int as published
  from public.content_items m
  join public.content_items c
    on c.source ->> 'via' = 'fanout' and c.source ->> 'parent' = m.id::text
 group by 1, 2;

comment on view public.v_fanout_week is 'One row per fanned-out master post: provider copies and how many are published. Kits excluded.';
