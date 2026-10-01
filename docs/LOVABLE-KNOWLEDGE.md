# TwinOS — project knowledge for Lovable

Paste this whole file into Lovable → Project settings → Knowledge.

## What TwinOS is

TwinOS runs the EzyMap gold-trading Telegram channel so Jack's day goes to the
map, TikTok and people. It drafts posts from templates, checks them against a
compliance checklist, waits for Jack's approval, publishes to Telegram on a
schedule, posts result replies under signals, tracks members and produces the
Friday scoreboard. You are building its **dashboard only**. The backend is
Postgres + Edge Functions in **Jack's own Supabase project** (already
connected; **not** Lovable Cloud).

Repo: `TwinOS-helper-system`. Put all dashboard code under `apps/dashboard/`.
Never write into `supabase/migrations`, `supabase/functions`, `workers/`, `docs/`.

## The schema-first rule

The database schema already exists (`supabase/migrations`). **Do not create,
alter or drop tables, policies, functions or triggers.** If a screen needs a
column that is missing, stop and say which one; do not add it.

## Never write tables directly from the UI

Every mutation goes through an Edge Function or an RPC. The UI reads tables
and views (RLS allows it for a logged-in user) but **never** `insert`,
`update`, `delete` on: `content_items`, `content_variants`, `publish_jobs`,
`approvals`, `signals`, `signal_posts`, `jobs`, `manual_metrics`, `action_log`.

| Action in the UI | Call |
|---|---|
| New draft | `POST /functions/v1/content/draft` |
| Send to Desk group | `POST /functions/v1/content/{id}/request-approval` |
| Approve / reject / reschedule | `POST /functions/v1/approve` `{content_id, decision, run_at?, note?}` |
| Schedule | `POST /functions/v1/content/{id}/schedule` `{run_at}` |
| Friday manual numbers | `POST /functions/v1/friday/manual` |
| Result reply | `POST /functions/v1/results` `{signal_id}` |
| Health | `GET /functions/v1/health` |
| Friday numbers | `GET /functions/v1/friday?week=YYYY-MM-DD` |
| Queue counts | `GET /functions/v1/jobs` |

Call them with `supabase.functions.invoke(name, { body })`; the user's session
JWT is attached automatically. Error bodies are `{ error, message }`; show
`message`. Full contract: `docs/API.md` in the repo.

## Role model

Roles come from the login claim `app_metadata.twinos_role`:
- `jack` — Jack's login. The only role that can **approve** or schedule a post
  carrying a claim (price, level, result, offer, member result, scorecard).
- `dashboard` — any other login. Read everything, draft, request approval,
  enter manual numbers. Never approve.
- Keys (`abdul`, `pc_worker`, `ezyai`) are for machines; the UI never uses them.

Read the role once after login (`session.user.app_metadata.twinos_role`) and
hide, don't just disable, the Approve button for anyone who is not `jack`.
The server enforces it again (403), so the UI is not the guard, just honest.

## Screens, in build order (one at a time; finish and wait between each)

1. **Approval Inbox** — `content_items` where status in (`pending_approval`, `draft`)
   newest first, with the variant body, compliance findings (`content_variants.compliance.findings`,
   colour by severity: blocking red, needs_approval gold, warn grey), `[NEEDED:…]`
   highlighted, the Desk group link, and buttons Approve / Reject / Reschedule (jack only).
2. **Content Calendar** — week view from `publish_jobs` (run_at, status) joined to
   `content_items` (post_type, lang). The 15 post types as filters. Click → inbox detail.
   Failed jobs in red with `last_error`.
3. **Health** — `GET /health`: beats per source with stale flag, open `alerts`,
   failed publish jobs, one-line "anything broken?" summary at the top.
4. **Analytics / Friday** — `v_friday_scoreboard` for the selected week, the
   missing-input list, and the two-minute forms (Vantage: ib_accounts_opened,
   first_time_depositors, active_funded_clients, rebates_usd; TikTok: followers,
   profile_views, watch_time_min, pct_watched_full) posting to `friday/manual`.
   Quarter targets from `v_quarter_targets`; stop-if rules from `v_stop_if`.
5. **Signal board** — `signals` with status, entry/SL/TP, result R, whether the
   card and result were posted (`signal_posts`), strict win rate
   W/(W+L) over 4 weeks with break-evens excluded, and a "post result" button
   for closed signals without a reply (calls `results`).
6. **Research briefs** — `briefs`, `topic_clusters`, `csi_captures` read-only
   list + a CSI capture form (Phase 5; build a placeholder page now).
7. **Inbox** — `inbox_items` from IG/FB/YouTube/Threads with suggested replies
   (Phase 3/4; placeholder now).

Also a thin **Settings** page that only reads `settings` (editing stays in SQL for now).

## Design notes

- Dark UI. EzyMap colours: green `#19C37D` (up / approved / ok), red `#E5484D`
  (down / rejected / blocking), gold `#E3B341` (needs approval / warning / brand accent),
  background `#0B0F14`, panels `#121820`, text `#E6EDF3`, muted `#8B98A5`.
- One font (Inter). Numbers tabular. Telegram-style message preview for drafts
  (monospace block, bold only where the body has `<b>`).
- Mobile first: Jack approves from his phone. The Approval Inbox must work at 390 px.
- Malay is `ms`, never `my`. Times shown in `Asia/Kuala_Lumpur`.
- No emojis in UI chrome; emojis inside post bodies are content and stay.

## The approval guardrail (read twice)

- Approve exists only for `jack`. There is no "approve as ABDUL", no bulk approve
  for claim posts, no auto-approve toggle in the UI.
- A draft with any **blocking** finding cannot be approved; show the findings and
  an Edit path instead (`content.edit` is Phase 2; for now, the Desk group).
- `[NEEDED:…]` in a body means not ready. Never hide it.
- Never render or post anything from `signals` where `quality` is not `live`.
- Do not add an AI "rewrite" call in the UI; drafting runs through the backend
  and ABDUL, never from the browser.
- Do not store tokens or keys in the frontend. The anon key and the user session
  are the only credentials the dashboard holds.

## Reference numbers for sanity checks

Quarter targets: Q4 2026 members 2,500 / revenue $150 a day; Q1 2027 5,000 / $450;
Q2 2027 10,000 / $1,000. Stop-if: a signal with no result reply; cost per
first-time depositor over $120 for two weeks; refunds or complaints over 3%.
