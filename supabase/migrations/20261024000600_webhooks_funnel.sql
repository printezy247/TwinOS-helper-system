-- 20261024000600_webhooks_funnel.sql — Phase 7 (UPGRADE-PHASES): the webhook
-- registry + delivery queue, and the referral funnel view.
--
-- Webhooks. Decision 6: 3 retries after the first attempt, at +1m, +5m, +15m.
--   webhooks           one row per registered endpoint: url, the events it
--                      wants, an HMAC secret (returned once, at register),
--                      active on/off.
--   webhook_deliveries the queue: one row per (webhook, event, payload),
--                      pending -> delivering -> delivered | failed. The edge
--                      function `webhooks/dispatch` (pg_cron, every minute,
--                      through the existing twinos_cron_call helper) does the
--                      actual POSTs. A delivery failure never touches the
--                      event that produced it: emitting is one insert, the
--                      network happens later, in this queue.
--   Events: post.published, signal.result, alert.fired, friday.done.
--
-- v_referral_funnel — clicks -> joins -> deposits -> IB, one row per invite
-- link. Joins/leaves come from member_events attributed by Telegram
-- (invite_link_name, recorded by the tg webhook since day one); the campaign
-- numbers (link_clicks, deposits, FTDs, IB accounts, commissions, payouts)
-- come from manual_metrics joined through invite_links.campaign. Telegram
-- exposes no invite-link click count, so clicks are whatever was entered as
-- metric='link_clicks'. Unmeasured stages are null — never a zero that looks
-- like a measurement.

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  name text,
  url text not null,
  events text[] not null default '{}',
  secret text not null,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_delivery_at timestamptz,
  last_status text
);

create table if not exists public.webhook_deliveries (
  id bigint generated always as identity primary key,
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',   -- pending | delivering | delivered | failed
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_webhook_deliveries_due
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';
create index if not exists idx_webhook_deliveries_hook
  on public.webhook_deliveries (webhook_id, created_at desc);

-- RLS: the registry carries signing secrets, so it is Jack's table alone —
-- no generic reader policy, unlike most tables here. The edge functions use
-- the service role (admin()), which bypasses RLS; dispatch runs as cron.
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
create policy jack_all on public.webhooks for all to authenticated
  using (public.twinos_role() = 'jack') with check (public.twinos_role() = 'jack');
create policy jack_all on public.webhook_deliveries for all to authenticated
  using (public.twinos_role() = 'jack') with check (public.twinos_role() = 'jack');

comment on table public.webhooks is 'Registered webhook endpoints (Phase 7). url + subscribed events + HMAC secret. Jack manages them; emitWebhook fans an event out into webhook_deliveries.';
comment on table public.webhook_deliveries is 'Delivery queue (Phase 7, Decision 6): pending -> delivering -> delivered | failed, 4 attempts total (1 + 3 retries at 1m/5m/15m). Dispatched every minute by webhooks/dispatch via pg_cron.';

-- --------------------------------------------------------------- funnel view
create or replace view public.v_referral_funnel
with (security_invoker = true) as
select l.id,
       l.name,
       l.source,
       l.campaign,
       l.partner,
       l.cost_usd,
       l.active,
       l.created_at,
       count(e.id) filter (where e.kind = 'join')  as joins,
       count(e.id) filter (where e.kind = 'leave') as leaves,
       count(e.id) filter (where e.kind = 'join')
         - count(e.id) filter (where e.kind = 'leave') as net_members,
       m.link_clicks,
       m.deposits_usd,
       m.first_time_depositors,
       m.ib_accounts_opened,
       m.commissions_usd,
       m.payouts_usd,
       round(l.cost_usd / nullif(count(e.id) filter (where e.kind = 'join'), 0), 2)
         as cost_per_join_usd
  from public.invite_links l
  left join public.member_events e
         on e.invite_link_name = l.name
        and e.kind in ('join', 'leave')
  left join lateral (
         select sum(mm.value) filter (where mm.metric = 'link_clicks')          as link_clicks,
                sum(mm.value) filter (where mm.metric = 'deposits_usd')          as deposits_usd,
                sum(mm.value) filter (where mm.metric = 'first_time_depositors') as first_time_depositors,
                sum(mm.value) filter (where mm.metric = 'ib_accounts_opened')    as ib_accounts_opened,
                sum(mm.value) filter (where mm.metric = 'commissions_usd')       as commissions_usd,
                sum(mm.value) filter (where mm.metric = 'payouts_usd')           as payouts_usd
           from public.manual_metrics mm
          where mm.campaign = l.campaign
        ) m on true
 group by l.id, m.link_clicks, m.deposits_usd, m.first_time_depositors,
          m.ib_accounts_opened, m.commissions_usd, m.payouts_usd;

comment on view public.v_referral_funnel is
  'Per invite link: joins/leaves from member_events (Telegram attribution), campaign clicks/deposits/FTDs/IB/commissions/payouts from manual_metrics via invite_links.campaign. Null = not measured.';

grant select on public.v_referral_funnel to authenticated;

-- ------------------------------------------------------------------ dispatch
-- Every minute = "external systems see TwinOS events within 60s" (Phase 7).
-- pg_cron is absent on vanilla Postgres (CI): degrades to a notice, same
-- pattern as 20261024000200_threshold_alerts.sql. twinos_cron_call posts to
-- settings.edge_base_url/webhooks/dispatch with the Vault bearer secret.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-webhook-dispatch') then
      perform cron.unschedule('twinos-webhook-dispatch');
    end if;
    perform cron.schedule(
      'twinos-webhook-dispatch',
      '* * * * *',
      $cron$select public.twinos_cron_call('webhooks/dispatch')$cron$
    );
    raise notice 'scheduled twinos-webhook-dispatch (every minute)';
  else
    raise notice 'pg_cron not available here: schedule twinos-webhook-dispatch on Supabase';
  end if;
end $$;
