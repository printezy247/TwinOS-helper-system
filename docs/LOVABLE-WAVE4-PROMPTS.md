# Wave 4 — dashboard prompts (Lovable, one per item)

Paste **one prompt at a time** into the Lovable project "TwinOS"
(`8aa151d6-f29b-4fba-8daf-345c4df50963`). After each one, report back the
changed files and wait for the next prompt. Each prompt spends credits;
stop and report if a prompt asks for a column the schema does not have
(never add tables — say which column is missing instead).

Standing rules for every prompt (also in `docs/LOVABLE-KNOWLEDGE.md`):
frontend only; the anon key and the session JWT are the only credentials;
writes only through `supabase.functions.invoke`; approval stays Jack-only
with a confirm, never bulk, never on blocking findings; `[NEEDED:…]` always
visible; no framer-motion; `prefers-reduced-motion` respected; EzyMap green
`#19C37D` / gold `#E3B341` / red `#E5484D` on `#0B0F14`; Inter; Malay is `ms`;
times in `Asia/Kuala_Lumpur`; approvals must work at 390 px.

Backend contracts this wave (already deployed; the prompts below assume them):
`tg-auth/verify { init_data }` returns `{ session, expires_at }`, a
`tma.…` bearer the edge functions accept as Jack; `GET tg-auth/me`
confirms it. (Signatures and first-comment fields arrive with item 2;
the prompts below assume them.)

## 1. Mini App approval route

> Add a `/mini` route for the Telegram Mini App approval view, opened from
> the Desk menu button. On load, read `initData` from tma.js, POST it to
> `tg-auth/verify` as `{ init_data }`, keep the returned `session` in memory
> (never in localStorage), and send it as the Bearer on every
> `supabase.functions.invoke` from this route. Confirm the session with `GET
> tg-auth/me` before showing anything. The view is the Approval Inbox
> condensed for 390 px: pending drafts with Approve / Reject + confirm,
> blocking findings hide Approve, one item per screen with prev/next. Any
> verify failure shows a plain "Open this from the EzyMap Desk" screen and
> calls nothing else. Respect `prefers-reduced-motion`; no framer-motion.

## 2. Calendar scheduler

> Build a Postiz-style week calendar from scheduled items: columns per day,
> cards per item with its time, platform dots and status. Tapping a card
> opens the per-platform preview (adapted caption + validator findings) with
> Approve / Edit / Reschedule per platform. A "New post" flow picks pillar,
> platform and slot, then drafts through `content/draft` and schedules
> through `content/{id}/schedule` with optional `first_comment` (posted as
> a reply under the channel message after `first_comment_delay_min`
> minutes) — show the comment and delay on the card. Saved signatures come
> from the `platform_signatures` setting (Settings page edits them as plain
> text, never a secret): the composer appends the platform's signature with
> one tap, and the one-CTA rule still applies. Deleting a scheduled card
> cancels its jobs, never posts. Filter chips per platform; `?` cheat sheet
> for the J/K/A/R/S keys you already added.

## 3. Clip approvals

> Add a Clips view that lists the open clip candidates: each card shows the
> time window, score, reason and hook text. Playing the window happens on
> Jack's PC (there is no video URL to stream); the card offers Use and Drop
> only, each with a confirm, Jack-only. Use queues the cut on the PC through
> the existing Desk flow — the dashboard never cuts video itself. Dropped
> cards disappear from the list. Empty state: "No open clip candidates."

## 4. Fan-out retry status

> Add a small "Retries" strip on the Content Calendar (and a line on the
> Health screen): when `content/fanout` returns `retry_queued: true` for a
> platform, show that platform's card with a "retry queued" badge until its
> draft succeeds. Surface the Desk alerts `fanout_failed` and
> `fanout_backlog` as read-only banners with a Retry button that re-invokes
> the fan-out for that platform. Read-only: this view never edits captions.

## 5. Insights (best times, hooks, engagement)

> Add a read-only Insights view on top of the four analytics views
> `v_best_times`, `v_hook_performance`, `v_post_engagement` and
> `v_signal_ledger` (read them like the other analytics views; never write).
> Top section: the three best posting hours from `v_best_times` as stat
> tiles (hour in Asia/Kuala_Lumpur, average 1-hour views). Middle: a hook
> table from `v_hook_performance` — hook text, uses, average views — with
> the winner badged. Then engagement rate per day from `v_post_engagement`
> (views-24h ÷ members, in %) as a simple bar list. Last section: the
> signal ledger from `v_signal_ledger` as a table with a per-row
> "deleted-trade guard" lock icon — the schema refuses signal deletions, so
> say so once in a caption. No charts library needed; plain tables and
> tiles are fine. Empty state: "Numbers arrive after the first posts"
> with the honest reason.
