# TwinOS — project knowledge for Lovable

Lovable project "TwinOS" (id 8aa151d6-f29b-4fba-8daf-345c4df50963). This text is
its project knowledge (set over the Lovable MCP; paste it again by hand if it is
ever lost: Project settings → Knowledge).

## What TwinOS is

TwinOS runs the EzyMap gold-trading Telegram channel so Jack's day goes to the
map, TikTok and people. It drafts posts from templates, checks them against a
compliance checklist, waits for Jack's approval, publishes to Telegram on a
schedule, posts result replies under signals, tracks members and produces the
Friday scoreboard. You are building its **dashboard only**. The backend is
Postgres + Edge Functions in **Jack's own Supabase project**, **not** Lovable
Cloud. Never enable Lovable Cloud or any Lovable database, and never create
tables, migrations, edge functions, storage buckets or auth settings.

This is a frontend-only app. It connects with `@supabase/supabase-js` in
`src/lib/supabase.ts` using the public project URL
(`https://cdnyybrfoclexjlroqcf.supabase.co`) and the public publishable key.
No other key, token or secret may ever appear in the code. The backend source
lives in the GitHub repo `printezy247/TwinOS-helper-system`; this app's code
lives only in this Lovable project.

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
| Friday manual numbers | `POST /functions/v1/friday/manual` `{week_start, source: vantage\|tiktok\|telechurn\|ads, metrics: {...}}` |
| One campaign's numbers | `POST /functions/v1/friday/campaign` `{week_start, campaign, ad_spend_usd?, first_time_depositors?, ib_accounts_opened?}` |
| Result reply | `POST /functions/v1/results` `{signal_id, dry_run?}` (`dry_run: true` returns the text without posting) |
| CSI reading | `POST /functions/v1/research/csi` `{topic, category?, metric?, value?, trend?, note?}` |
| Article brief | `POST /functions/v1/research/article` `{cluster_id}` → `{text, titles, questions, keywords}` |
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
- `dashboard` — a login whose `app_metadata.twinos_role` is `dashboard`. Read
  everything, draft, request approval. Never approve, and no Friday manual or
  campaign forms (the backend allows those to `jack` only).
  A login with no `twinos_role` at all reads nothing (RLS returns no rows);
  show "This account has no TwinOS role yet" instead of an empty list.
- Keys (`abdul`, `pc_worker`, `ezyai`) are for machines; the UI never uses them.

Read the role once after login (`session.user.app_metadata.twinos_role`) and
hide, don't just disable, the Approve button for anyone who is not `jack`.
The server enforces it again (403), so the UI is not the guard, just honest.

## Screens, in build order (one at a time; finish and wait between each)

1. **Approval Inbox** (built) — `content_items` where status in (`pending_approval`, `draft`)
   newest first, with the variant body, compliance findings (`content_variants.compliance.findings`,
   colour by severity: blocking red, needs_approval gold, warn grey), `[NEEDED:…]`
   highlighted, and buttons Approve / Reject / Reschedule (jack only).
   Variants join on `content_variants.content_id`; load them in a second query
   (an embedded select is ambiguous: two foreign keys point at `content_items`).
   `compliance` is `{ ok, needs_approval, findings: [{ check, severity, message, evidence? }], claim_flags }`.
2. **Content Calendar** (built) — week view from `publish_jobs` (run_at, status) joined to
   `content_items` (post_type, lang). The 17 post types as filters (read them
   from `templates`, do not hardcode them). Click → inbox detail.
   Failed jobs in red with `last_error`.
3. **Health** (built) — `GET /health`: beats per source with stale flag, open `alerts`,
   failed publish jobs, one-line "anything broken?" summary at the top.
4. **Analytics / Friday** (built; plus the optional ad-spend form and the Campaign cost section from `v_campaign_cost`) — `v_friday_scoreboard` for the selected week, the
   missing-input list, and the two-minute forms (Vantage: ib_accounts_opened,
   first_time_depositors, active_funded_clients, rebates_usd; TikTok: followers,
   profile_views, watch_time_min, pct_watched_full) posting to `friday/manual`.
   Quarter targets from `v_quarter_targets`; stop-if rules from `v_stop_if`.
5. **Signal board** (built; `/signals`, live signals only, results via `results` with a dry-run preview first) — `signals` with status, entry/SL/TP, result R, whether the
   card and result were posted (`signal_posts`), strict win rate
   W/(W+L) over 4 weeks with break-evens excluded, and a "post result" button
   for closed signals without a reply (calls `results`).
6. **Research** (built; `/research`: the Monday brief, scored topics, `v_repeat_questions`, CSI readings and the CSI form, the article brief button) —
   `briefs`, `topic_clusters`, `csi_captures`.
7. **Messages** (built as a placeholder; `/inbox`: `inbox_items` with suggested replies, no send buttons) —
   it fills when Phase 3 comment polling exists.

Also a thin **Settings** page that only reads `settings` (editing stays in SQL for now).

Two more read-only screens are specified as prompts 6 and 7 in
`docs/LOVABLE-WAVE4-PROMPTS.md` and may be built when you get to them, in the
same style as the rest: **Research feeds** (`feeds` + `feed_items`) and
**Poll results** (`poll_results`). Both are read-only; neither writes.

## Design notes

- Dark UI. EzyMap colours: green `#19C37D` (up / approved / ok), red `#E5484D`
  (down / rejected / blocking), gold `#E3B341` (needs approval / warning / brand accent),
  background `#0B0F14`, panels `#121820`, text `#E6EDF3`, muted `#8B98A5`.
- One font (Inter). Numbers tabular. Telegram-style message preview for drafts
  (monospace block; bodies use Telegram Markdown, so `*text*` is bold; keep emojis and line breaks).
- Mobile first: Jack approves from his phone. The Approval Inbox must work at 390 px.
- Malay is `ms`, never `my`. Times shown in `Asia/Kuala_Lumpur`.
- No emojis in UI chrome; emojis inside post bodies are content and stay.

## Wave 2 rules (navigation, feedback, motion)

- One app-shell layout route owns the login check and the role (`useRole()`);
  pages never repeat it. No role → "This account has no TwinOS role yet".
- Show the variant Jack will publish: `source.picked = true`, else the oldest
  variant whose `source.via` is not `llm_variants`. Unpicked AI angles are
  never shown as the draft and never block or allow Approve.
- Fan-out kits (`content_items.source.kit = true`) show a "Copy-paste kit"
  badge and only Reject.
- An error never reads as "nothing pending": show the message and Retry, and
  never show Approve when the item's variants or findings did not load.
- shadcn Dialog on desktop, Drawer under 768 px, for every overlay (focus
  trap, Esc, focus returns). Icon-only buttons have an aria-label.
- Keyboard shortcuts ignore keys typed in input, textarea and contenteditable.
- Motion: CSS only (no framer-motion), 150–320 ms, and none at all under
  `prefers-reduced-motion: reduce`.
- Realtime: subscribe in an effect and remove the channel on cleanup.
- The Mini App session lives in memory only and rides in the
  `x-twinos-session` header; never replace the default Authorization header.

## The approval guardrail (read twice)

- Approve exists only for `jack`. There is no "approve as ABDUL", no bulk approve
  for claim posts, no auto-approve toggle in the UI.
- A draft with any **blocking** finding cannot be approved; show the findings and
  an Edit path instead (`content.edit` is Phase 2; for now, the Desk group).
- `[NEEDED:…]` in a body means not ready. Never hide it.
- Never render or post anything from `signals` unless `data_source = 'live'` and `status <> 'shadow'`.
- Do not add an AI "rewrite" call in the UI; drafting runs through the backend
  and ABDUL, never from the browser.
- Do not store tokens or keys in the frontend. The anon key and the user session
  are the only credentials the dashboard holds.

## Reference numbers for sanity checks

Quarter targets: Q4 2026 members 2,500 / revenue $150 a day; Q1 2027 5,000 / $450;
Q2 2027 10,000 / $1,000. Stop-if: a signal with no result reply; cost per
first-time depositor over $120 for two weeks; refunds or complaints over 3%.
