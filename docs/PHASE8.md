# Phase 8 — the revenue core: what is known, what is not, what to decide

Written 2 Oct 2026 from a read of `~/printezy` (the website, read-only) and the TwinOS repo. Nothing in the
printezy repo was changed: it is a separate project (its own Lovable project and Supabase) and TwinOS never
writes to it.

## What the website's payment path does today (read, not run)

`src/routes/api/public/payments/webhook.ts` → `src/lib/bot/purchases.server.ts` (`recordSitePurchase`).

- Stripe Checkout, test and live separated by `?env=`; a sandbox event cannot fulfil a live order and the reverse.
- The purchase is recorded once per Stripe session: the `stripe_session_id` column is unique.
- An EzyAI PRO purchase is handed to the `ezyai_entitlements` bridge; other purchases grant access through the bot.

## Two findings in that path (not fixed here: not this repo)

1. **Check, then insert.** `recordSitePurchase` looks for an existing row, then inserts. Two deliveries of the
   same event that arrive together can both pass the check; the second insert then fails on the unique column,
   the function throws and the webhook answers `400`, so Stripe retries. No double purchase results (the unique
   column holds), only noise and a delayed second pass. Fix: insert with `on conflict (stripe_session_id) do
   nothing returning id`, and notify Sarah only when a row came back.
2. **`listUsers({ perPage: 1000 })`** in `provisionAccount` looks for a repeat buyer among the first 1,000 users
   only. Past 1,000 users a repeat buyer is not found, no account is linked to the purchase (the purchase still
   records). Fix: look the user up by email through the admin API's filter, or keep an `email → user_id` lookup.

## The Phase 8 items, one by one

| Item | Where it lives | State |
|---|---|---|
| Stars payment idempotency | the Telegram sales bot (EzyRegisterBot), not in `printezy` | needs that repo; no Telegram Stars code exists in the site |
| Larger Stripe de-dupe window | the site's webhook (finding 1) | the unique column is a permanent de-dupe, not a window; the real fix is finding 1 |
| Service-role key replaced by a narrow read | TwinOS reading the site | see "The narrow read" below |
| Sales bot migration with parallel running | the sales bot + TwinOS | needs the bot's repo; plan below |
| Hosting decision | Jack | criteria below |

## The narrow read (what TwinOS may ask the site, and nothing else)

TwinOS needs one thing from the site: how many visitors from a campaign became accounts, checkouts and purchases
(ad landing attribution, Phase 6). It must never hold the site's service-role key. The shape to ask Lovable to
build in the site's project:

```
GET https://<site>/api/public/twinos/attribution?week=YYYY-MM-DD
Authorization: Bearer <a read-only key made for TwinOS, stored in the site's secrets, hashed like TwinOS's own keys>
→ { "week_start": "2026-10-12",
    "campaigns": [ { "campaign": "tt-live-2610", "visits": 412, "accounts": 31, "checkouts": 6, "purchases": 3 } ] }
```

Counts per campaign tag only: no emails, no names, no amounts per person. TwinOS stores the answer in
`manual_metrics` (kind `campaign`, see migration 0025) so `v_campaign_cost` can show cost per depositor.

## Parallel running (when the sales bot moves)

1. Both bots receive the same events for two weeks; only the old one acts. The new one writes what it *would* do.
2. Each night a comparison lists every purchase, grant and refund the two disagree on. Zero differences for 14
   nights in a row is the exit criterion ("payments match the old bot for two weeks").
3. Cut over on a quiet weekday morning; keep the old bot running, acting on nothing, for another week.
4. Money paths never auto-retry a failed grant silently: a failed grant raises an alert and a Desk message.

## Hosting decision (Jack's)

Criteria, in order: (1) payments never stop (the host's uptime and webhook retry behaviour), (2) secrets stay out
of the repo and out of the browser, (3) one place to look when something breaks, (4) cost at this size. The
default recommendation is to **leave the sales bot where it is** until the parallel run proves the new one, and
decide hosting only then; a move and a rewrite at the same time doubles the risk on the part that handles money.
