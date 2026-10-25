-- E1 (v5 plan, Phase E): close the content loop. A topic cluster is joined to
-- the posts actually made from it: topic_clusters.used_in_item_id ->
-- content_variants -> tg_posts -> post_snapshots. The scorer reads this view
-- and moves a topic at most ±20 % of its raw score (applyFeedback in
-- _shared/research.ts); total_score itself is untouched, so history can nudge
-- but never rewrite demand × icp × compliance.
--
--   wins / losses  same 24 h engagement percentage as v_post_engagement
--                  (views as a share of members). A post at or above 5 % won;
--                  at or below 1 % lost; the middle is no news. The constants
--                  live here only, one place to correct.
--   hook_won       the topic's hook opened a post whose 1 h average beats the
--                  median hook in v_hook_performance.
create or replace view public.v_topic_feedback
with (security_invoker = true) as
with posted as (
  select tc.id as cluster_id,
         v.hook_id,
         case when dm.member_count > 0
              then 100.0 * s24.views / dm.member_count end as engagement_pct
  from public.topic_clusters tc
  join public.content_variants v on v.item_id = tc.used_in_item_id
  join public.tg_posts p on p.variant_id = v.id and p.deleted_at is null
  join public.post_snapshots s24
    on s24.chat_id = p.chat_id
   and s24.message_id = p.message_id
   and s24.offset_label = '24h'
  left join lateral (
    select cd.member_count
      from public.channel_daily cd
     where cd.chat_id = p.chat_id
       and cd.member_count is not null
       and cd.day <= p.posted_at::date
     order by cd.day desc
     limit 1
  ) dm on true
  where tc.used_in_item_id is not null
    and s24.views is not null
),
hook_median as (
  select percentile_cont(0.5) within group (order by avg_views_1h) as med
  from public.v_hook_performance
  where avg_views_1h is not null
)
select tc.id as cluster_id,
       tc.name as cluster,
       tc.pillar,
       coalesce(tc.compliance_risk, 0) as compliance_risk,
       tc.total_score,
       count(posted.engagement_pct) filter (where posted.engagement_pct >= 5.0) as wins,
       count(posted.engagement_pct) filter (where posted.engagement_pct <= 1.0) as losses,
       coalesce(bool_or(hp.avg_views_1h > hm.med), false) as hook_won
  from public.topic_clusters tc
  left join posted on posted.cluster_id = tc.id
  left join public.v_hook_performance hp on hp.hook_id = posted.hook_id
 cross join hook_median hm
 group by tc.id, hm.med;
