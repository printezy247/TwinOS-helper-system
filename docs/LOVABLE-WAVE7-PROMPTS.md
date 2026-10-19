# Wave 7 — the control wave (Lovable, one per item)

Paste **one prompt at a time** into the Lovable project "TwinOS"
(`8aa151d6-f29b-4fba-8daf-345c4df50963`). After each one, report back the changed
files and wait for the next prompt. Each prompt spends credits; stop and report
if a prompt asks for a column the schema does not have (never add tables — say
which column is missing instead).

Wave 7 is the **control wave**. Every earlier wave built a screen. This one makes
the screens faster and harder to break, and gives each one the buttons Jack keeps
leaving the dashboard for: cancel and edit a post, make an invite link, change a
stale threshold, see what just happened. The standing rules are unchanged and
live in `docs/LOVABLE-KNOWLEDGE.md`:
- frontend only;
- the anon key and the session JWT are the only credentials;
- writes go only through `supabase.functions.invoke` or the settings RPCs;
- approval stays Jack-only with a confirm, never bulk, and never on blocking
  findings;
- `[NEEDED:…]` is always visible;
- no framer-motion, and `prefers-reduced-motion` is respected;
- EzyMap green `#19C37D` / gold `#E3B341` / red `#E5484D` on `#0B0F14`;
- Inter, with tabular numbers;
- Malay is `ms`;
- times are shown in `Asia/Kuala_Lumpur`;
- everything works at 390 px.

**Build on what exists; do not rebuild it.** The app (TanStack Start + TanStack
Router) already has: the `_shell` layout with `useRole()`, `AppNav.tsx` (grouped
sidebar, a bottom nav of Today / Inbox / Calendar / Signals / More, and the More
drawer), `CommandPalette.tsx` with `JumpKeys` (`g` + letter, checked for
collisions by `checkShortcuts`) and the `?` sheet, one realtime channel in
`_shell.tsx` that fans out through `emitChanged` / `useLiveReload`,
`OfflineBanner`, `PageErrorBoundary`, a skip link, breadcrumbs, the "Updated
HH:MM" stamp, and `callFn` in `src/lib/fn.ts`. The approval inbox is `/approve`.
`/inbox` is Messages. Each prompt below extends those pieces. If a piece it names
is missing, say so and stop instead of inventing a second copy.

**Contracts this wave uses, all already deployed:**
- `POST /functions/v1/content/cancel { variant_id }` — jack only. Queued jobs go
  to `cancelled` and the variant walks back to `draft`. Idempotent. A published
  post answers 409.
- `POST /functions/v1/content/edit { variant_id, body }` — jack only. Compliance
  runs first: a blocking finding answers 409 with `findings` and nothing is
  stored. A successful edit **un-approves** the variant.
- `GET /functions/v1/content/calendar` jobs now carry **`variant_id`**, which is
  what cancel and edit take.
- `GET /functions/v1/links?source=&campaign=&active=1` (every logged-in role) and
  `POST /functions/v1/links { source, campaign, yymm, creates_join_request?, member_limit? }`
  (jack only from the dashboard).
- `GET /functions/v1/jobs` → `{ counts: { <kind>: { <status>: n } } }`.
- `settings` rows `health_stale_<source>` (minutes), written through `set_setting`.
- `action_log` (actor, action, target_table, target_id, payload, created_at),
  readable by `jack` and `dashboard`.

---

## 1. Speed and reliability — one cache under every screen

> Move the pages' reads onto TanStack Query so a screen opens instantly on a
> second visit, and two screens never show different numbers for the same thing.
>
> `@tanstack/react-query` is already installed, and `src/router.tsx` already
> creates a `QueryClient`. Today each page loads with its own `useState` +
> `useEffect`, and several pages call `fetchHealth()` on their own. Change that,
> one page at a time, keeping each page's look and states:
>
> - **Configure the client.** Give the existing `QueryClient` defaults:
>   `staleTime` 30 s, `gcTime` 10 min, refetch on focus and on reconnect, and a
>   query retry of 2 with 1 s / 3 s backoff. Mutations get `retry: 0`. Wrap the
>   app in `QueryClientProvider` if it is not already.
> - **One file of query hooks.** Put them in `src/lib/queries.ts`, one key per
>   resource: `['health']`, `['jobs']`, `['approve']`, `['calendar', week]`,
>   `['friday', week]`, `['signals']`, `['links']`, `['activity', filters]`,
>   `['settings']`, `['pending']`. Pages use these hooks instead of calling
>   `supabase` or `callFn` for reads.
> - **Realtime invalidates; it does not fetch.** Map each `emitChanged(table)`
>   to `queryClient.invalidateQueries` on the keys that read that table, so one
>   change refetches once per resource, however many components show it. Keep the
>   shell's single channel and its reconnect backoff exactly as they are.
>   `useLiveReload` can become a thin wrapper over that, or be retired once no
>   page uses it.
> - **Health once for the whole app.** `['health']` refetches every 60 s, paused
>   while the tab is hidden. The pending badge (`['pending']`, replacing
>   `loadCount`), the status pill from prompt 2, Today, Channels, Settings and
>   Health all read that one query.
> - **Preload on intent.** Set the router's `defaultPreload: 'intent'`, and give
>   the main routes a `loader` that calls `queryClient.ensureQueryData`, so
>   hovering or touching a nav link starts the fetch. Check that the router plugin
>   has `autoCodeSplitting` on. Do **not** add `React.lazy`: the router already
>   splits each file route.
> - **A 15 s timeout on reads**, with an error that says it timed out rather
>   than a generic failure.
> - **Writes run once.** Approve, reject, cancel, edit, schedule, links and
>   settings are `useMutation` calls with no retry. The button is disabled with a
>   spinner until the server answers, which is the double-tap guard. On success,
>   invalidate the affected keys. Never retry a write automatically.
> - **Offline extends the existing `OfflineBanner`.** While offline, every write
>   button is disabled with "You're offline" as its tooltip, and cached data
>   stays on screen.
> - **The "Updated HH:MM" stamp** reads the page query's `dataUpdatedAt`, so it
>   is true per page.
> - **Skeletons keep the final layout's size** and carry `aria-busy`. Cached
>   data shows straight away while it refreshes in the background, with no
>   spinner over it.
> - **Virtualize any list that can pass 100 rows** — Research and Feeds items,
>   Activity, Links — with `@tanstack/react-virtual`.
>
> Nothing here changes what any screen shows. It changes how fast it shows it and
> what happens when the network is bad. Keep the existing tests passing, and add
> one that proves a realtime event invalidates the right key.

## 2. Navigation — know what needs you without opening anything

> Extend `AppNav.tsx`, `CommandPalette.tsx` and the shell. Do not replace them.
>
> - **Live badges beyond the Approval Inbox**, from the prompt 1 queries, using
>   the existing `Badge` and `SidebarMenuBadge`:
>   - Calendar: failed jobs this week.
>   - Health: open alerts plus stale beats.
>   - Signals: closed signals with no result reply.
>   - Friday: missing inputs, Friday to Sunday only.
>   - Clips: open candidates, jack only.
>
>   Red for a failure, gold for something waiting. Every badge has an
>   `aria-label` such as "3 pending approvals", never a bare number. A zero shows
>   no badge.
> - **The More drawer shows the same badges** next to each item. When anything
>   inside More has a badge, a small dot appears on the More tab.
> - **A status pill in `TopBar`**, from `['health']`'s `summary`: green "All
>   systems OK", gold "1 stale source", red "2 open alerts". It sits next to the
>   existing Live dot and opens `/health`. On a phone it shrinks to a coloured dot
>   inside a 44 px tap target.
> - **A visible "New post" action.** `n` already opens `/compose`. Add a primary
>   button in `TopBar` on desktop, and a floating button on phones placed above
>   the bottom nav and inside the safe area.
> - **The palette gains actions**, each running the same code as its button:
>   - New post.
>   - Jump to calendar week (this, next, last).
>   - Copy Health summary.
>   - New invite link (prompt 6).
>   - Open an approval item by title.
>
>   Jack-only actions are left out of the palette for every other role, not shown
>   disabled. **The palette never approves, rejects or cancels.** Those stay
>   deliberate actions on the item itself.
> - **Deep links**: filters, tabs, the selected week and the open item go in the
>   URL as TanStack Router search params (`/calendar?week=2026-10-19`,
>   `/approve?item=…&status=pending_approval`), validated with each route's
>   `validateSearch`, so Back works and a pasted link opens the same view.
> - **Jump keys for the two new pages from prompt 6**: Links `g k`, Activity
>   `g y`. Add them to `JUMP` so `checkShortcuts` covers them. Do not move any
>   existing key.

## 3. Approval Inbox and Calendar — edit, cancel and find, without the Desk group

> Give `/approve` and `/calendar` the controls the backend now answers.
>
> **Approval Inbox (`/approve`)**
> - **A filter bar** above the list, stored in the URL: status tabs (already
>   there), plus post type (read from `templates`), language, platform, "has a
>   blocking finding", and a search over the title and body. There is a "Clear
>   filters" link whenever any filter is on.
> - **Edit (jack only)** in the item detail opens the body in a monospace
>   textarea, with the platform's character counter from Wave 6. Save calls
>   `content/edit`. On a 409, show the returned `findings` inline under the box,
>   coloured by severity, and keep Jack's text. On success, say plainly
>   "Saved — this post needs approving again", because the server un-approved it.
>   Then refresh the item.
> - **A "Send to Desk" button** for drafts (`request-approval`), visible to
>   `jack` and `dashboard`, disabled with a spinner while it runs.
> - **Copy body** and **Copy item link** buttons on every item.
> - **No bulk approve and no select-all**, by design.
>
> **Calendar**
> - **Each queued card gets a menu**, jack only: **Cancel** and **Open item**.
>   Cancel shows a confirm naming the post and its time, then calls
>   `content/cancel` with the job's `variant_id`. Remove the card from the week straight away and put it back
>   with the server's message if the call fails. On a 409 ("already published")
>   the card is not removed and the message is shown. If any old "cancel"
>   affordance has nothing behind it, replace it with this one.
> - **A failed card** shows `last_error` with a **Copy error** button and an
>   **Open item** link, so Jack can edit and reschedule from the detail.
> - **A "Today" button** next to the week picker.
> - **A summary line**: "12 queued · 3 published · 1 failed this week", taken
>   from the response, never re-counted from dates in the browser.

## 4. Health and Settings — fix it from where you see it

> Make Health the place Jack fixes things, not only the place he reads about them.
>
> - **Queue counts** from `GET /jobs`: a compact table with one row per kind and
>   columns queued / running / done / failed. A failed count over zero is red and
>   says which kind it is.
> - **Each beat card shows its stale threshold**: "stale after 30 min". For
>   `jack`, an inline **Change** control edits the matching
>   `health_stale_<source>` setting through `set_setting`, as a number of minutes
>   from 1 to 10080. Show the server's message on refusal. After a save, refetch
>   `['health']` so the card re-judges itself. Other roles see the number only.
> - **Alerts link to their screen**: a stop-if alert goes to that signal, a
>   failed publish to that calendar week, a stale beat to its card. Every alert
>   has a **Copy** button.
> - **"Copy summary"** at the top copies a plain-text report (summary, stale
>   sources, open alerts, failed jobs) for pasting into ABDUL or the Desk group.
> - **Auto-refresh** is the shared 60 s poll from prompt 1, with a **Pause**
>   toggle and a visible "next check in 42 s".
>
> **Settings**
> - **A search box** over keys and descriptions, plus a "Recently changed"
>   section listing the last ten `action_log` rows where
>   `target_table = 'settings'`: who changed what, and when, in KL time.
> - Keep the existing grouped editor. Add a **Health** group in
>   `src/lib/settings-groups.ts` holding the seven `health_stale_*` keys, and a **Reset to seeded value** button that shows the
>   value it will write before it writes it.

## 5. Signals, Friday and Research — the small things that save the most minutes

> Add these controls to existing screens. Nothing here widens a permission.
>
> **Signals**
> - **A "Needs a result reply" quick filter**, matching the nav badge, plus status
>   filter chips and a date range, all stored in the URL.
> - **The result flow**: dry-run preview first, as now, then **Post result**,
>   with a confirm that shows the exact text that will go out.
> - **A win-rate window toggle**: 4 weeks (the strict default), 12 weeks, all.
>   Break-evens are excluded in every window, and the window used is written
>   next to the number.
>
> **Friday**
> - **A week picker** (previous / this week / next) stored in the URL.
> - **A missing-inputs checklist** whose items scroll to their form.
> - **Hints in each manual form** showing last week's numbers as muted helper
>   text under each field, never as pre-filled values. A copied number is a
>   number nobody checked.
> - **"Copy scoreboard"** copies the week as plain text.
>
> **Research**
> - **"Draft from this"** on a topic or feed item opens the composer with the
>   topic in the title field only. Drafting still runs through `content/draft`
>   on the server.
> - **"Copy brief"** on the article brief result.
> - The Research and Feeds lists are virtualized (prompt 1). The Wave 6 category and tag
>   filters are kept.

## 6. Two new screens — Links and Activity

> Add two pages: **Links** in the Grow group, after Channels, and **Activity**
> in the Run group. On phones both appear in the More drawer automatically,
> because it is built from `GROUPS`.
>
> **Links** (`/links`)
> - **A table from `GET /links`**: name, source, campaign, active, member limit,
>   created, and the `t.me` link with a copy button that turns into a check mark
>   for 1.5 s. Filters for source, campaign and "active only", stored in the URL.
>   On phones, cards replace the table.
> - **A "New link" form, jack only**, posting to `POST /links`:
>   - `source` is a select of tt · ig · fb · yt · threads · x · swap · ad ·
>     referral · bio · bot;
>   - `campaign` is a lowercase alphanumeric input;
>   - `yymm` defaults to the current month in KL time;
>   - plus `creates_join_request` and `member_limit`.
>
>   Under the inputs, a live preview of the name the server will build
>   (`tt-live-2610`) checked against `^[a-z0-9]+-[a-z0-9]+-[0-9]{4}$`. Each
>   field's error sits under that field. If the response carries
>   `existing: true`, say "This link already existed — here it is" and highlight
>   the row, which is not an error.
> - **Read-only for every other role**: no form, no disabled form.
>
> **Activity** (`/activity`)
> - **A feed of `action_log`**, newest first, 50 rows at a time with "Load
>   more", virtualized. Each row shows the actor, the action, the target table
>   and id (linked to its screen where one exists), and the time in KL.
> - **Filters** for actor, table and today / 7 days, stored in the URL. A
>   realtime insert prepends a row with a short highlight, and no highlight under
>   reduced motion.
> - **`payload` stays collapsed** behind a "Details" toggle, as a monospace
>   block. It is shown as stored; nothing is rendered from it as HTML.
> - **Read-only. No undo button.** The undo for a change is the change's own
>   screen.

---

## What Wave 7 still does not do

- **No bulk approve, no approve from the palette, no approve from a list row
  without the detail.** Every control this wave adds is about *finding* and
  *fixing* faster. Approval is the one place where faster is not the goal.
- **No automatic retry of a write.** Approve, cancel, edit and links create
  things. A silent retry after a timeout is how a link gets made twice or a post
  approved by a request Jack thought had failed.
- **No retry button for a failed publish job.** No route re-queues one. The path
  is Open item → Edit → approve → schedule, and that keeps every re-sent post
  behind the gate.
- **No browser-side compliance check.** Edit shows what the server returns,
  exactly as the template-variant editor does.
