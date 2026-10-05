-- 0025_campaign_cost.sql — cost per first-time depositor per campaign (Phase 6, plan §9.H.69).
--
-- Campaign rows are manual_metrics rows of kind 'campaign' (one per metric, the
-- campaign name in `campaign`). A separate kind keeps them out of the weekly
-- totals v_funnel and v_friday_scoreboard sum, so entering a campaign never
-- double-counts the week. v_campaign_cost is one row per week and campaign.
-- A campaign with spend but no depositor yet has no cost per depositor (null),
-- never a division error.

alter table public.manual_metrics drop constraint if exists manual_metrics_kind_check;
alter table public.manual_metrics add constraint manual_metrics_kind_check
  check (kind = any (array['tiktok', 'vantage', 'telechurn', 'revenue', 'subscriptions', 'ads', 'support', 'campaign']));

create or replace view public.v_campaign_cost
with (security_invoker = true) as
select week_start,
       campaign,
       sum(value) filter (where metric = 'ad_spend_usd') as ad_spend_usd,
       sum(value) filter (where metric = 'first_time_depositors') as first_time_depositors,
       sum(value) filter (where metric = 'ib_accounts_opened') as ib_accounts_opened,
       round(
         sum(value) filter (where metric = 'ad_spend_usd')
         / nullif(sum(value) filter (where metric = 'first_time_depositors'), 0), 2
       ) as cost_per_ftd_usd
  from public.manual_metrics
 where kind = 'campaign' and campaign is not null
 group by week_start, campaign;

comment on view public.v_campaign_cost is 'Per week and campaign: ad spend, accounts opened, first-time depositors and cost per depositor (null until there is a depositor).';
