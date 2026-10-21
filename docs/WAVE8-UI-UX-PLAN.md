# Wave 8 — UI/UX, navigation and function upgrades

**Written:** 21 Oct 2026 · **Scope:** the TwinOS dashboard (`printezy247/twin-approval-hub`) and the
Telegram ops bot (`TwinOS-helper-system/supabase/functions/tg-webhook` + `_shared/tg.ts`)

**What this is:** a list of fixes and upgrades, in phases, with the file to change and the reason.
Every line was checked against the code on 2026-10-21 — the dashboard's real `main` (`15a810c`, PRs
#3–#21 merged) and the helper repo's `main` (`a38a170`). Nothing here is a guess about a file; if a
line says "verified", the code was read.

**How to read the priorities**

| | Meaning |
|---|---|
| **P0** | Broken today. A button 403s, a page never refreshes, a rule is not enforced. |
| **P1** | Daily-use friction. Jack has to hunt for something he does every day. |
| **P2** | Polish. Makes it faster or nicer; nothing is broken without it. |

**The rule this plan obeys:** the approval gate stays Jack-only, no bulk approve, no auto-approve,
no secret in the browser, no AI rewrite from the UI, no framer-motion, no light mode. Those are in
`UPGRADE-PLAN.md` §17 "Never" and they still hold.

---

## Where things stand (verified 21 Oct 2026)

**Dashboard** — TanStack Start + React 19 + Tailwind v4 + shadcn/ui, 19 screens under `_shell`
plus `/login` and `/mini`, 66 test cases in 15 files, 15.9k lines of source. The shared query layer
(`src/lib/queries.ts`, 798 lines) is real and used by 22 files. Deep links, nav badges, the
offline guard, Edit / Cancel / Send-to-Desk, the Links and Activity pages all landed in PRs #3–#18.

**Bot** — `tg-webhook/index.ts` (1,554 lines) + `_shared/tg.ts` (671 lines). Six screens
(status · batch · friday · hours · help · drafts), a stateless callback grammar with a layout
fingerprint, paging, quick picks, edit presets, moderation buttons, clip Use/Drop. Solid.

**Backend** — 11 edge functions, ~70 routes. More capability than either front end exposes.

**Live site** — confirmed current: `robots.txt` serves `Disallow: /`, the HTML carries
`<meta name="robots" content="noindex, nofollow">`, and the built CSS has `min-height:2.75rem` (the
44px button rule from PR #20). Three of the four PR #20 audit fixes are live. **The fourth is not** —
see P0-2.

**The gap that drives this plan:** the backend can do roughly 70 things; the dashboard exposes
about 25 and the bot about 12. The rest is not missing code — it is missing buttons.

---

## Phase 0 — Real bugs (fix these first, no new features)

### P0-1 · A `dashboard` role gets a 403 from three buttons it is allowed to see

`src/routes/_shell/approve.tsx:318`

```ts
canDraftActions={role === "jack" || role === "dashboard"}
```

That flag shows **Send to Desk**. The backend gate is
`_shared/roles.ts:71` → `"content.request_approval": ["jack", "abdul", "cron", "ops_bot"]` — no
`dashboard`. So a `dashboard`-role user taps the button and gets a 403 toast.

Same class of bug, same page family:

| Button | File | Backend gate | Allowed roles | Bug |
|---|---|---|---|---|
| Send to Desk | `approve.tsx:318` | `content.request_approval` | jack, abdul, cron, ops_bot | `dashboard` sees it → 403 |
| Create draft | `compose.tsx:127` | `content.draft` | jack, abdul, cron, ops_bot | not role-gated at all → 403 |
| Send to Desk for approval | `compose.tsx:86` | `content.request_approval` | jack, abdul, cron, ops_bot | not role-gated → 403 |
| Article brief (Research) | `research.tsx:74` | `research.article` | **not verified** | check and gate |

**Fix:** gate all four on `isJack`. `roles.ts` calls `dashboard` "read-mostly" and that is the
intent — the UI should not offer the button. (Alternative: add `dashboard` to the role list, but
that widens what a read-mostly account can do, which is the opposite of the file's own comment.)

### P0-2 · The security headers are not live — `_headers` is being served as a web page

`public/_headers` exists and looks right:

```
X-Robots-Tag: noindex, nofollow
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy: frame-ancestors 'self' https://lovable.dev …
```

But it is **not** a header file as far as the live site is concerned:

- `https://twin-approval-hub.lovable.app/_headers` returns the file's **contents as a page** — it is
  a static asset in `public/`, so Vite copies it to the output root and it gets served.
- The deploy target is a **Cloudflare Worker**, not Cloudflare Pages:
  `.output/nitro.json` → `"preset": "cloudflare-module"`, `deploy: npx wrangler deploy`. Workers do
  not read `_headers`.
- The live response has only `referrer-policy` (added by Lovable's own edge). No `X-Robots-Tag`, no
  CSP, no `Permissions-Policy`, no `Cross-Origin-Opener-Policy`.

So the rule from PR #20 — "no other site may embed the dashboard" — is **not being enforced**, and
the browser-permission lockdown is not either. The `noindex` still works because that one is
duplicated as an HTML `<meta>` tag, and `robots.txt` is a real static file, so both of those landed.

**Fix:** inject the headers in `src/server.ts`, which is the Worker entry and already wraps every
response. One helper that clones the response and sets the headers:

```ts
const SECURITY_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy":
    "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com",
};
```

Then delete `public/_headers` (or keep it only for a Pages preview) so it stops looking like
protection it is not providing.

**How to verify after the fix:** the header must show up in `curl -I`, not as a page.

### P0-3 · The job queue never refreshes on its own

`src/lib/queries.ts:162` — `useJobs()` has **no** `refetchInterval`, and the `jobs` table is not in
the realtime publication. The Health page's queue table therefore only changes when Jack presses
Refresh. Every other shared query has a fallback poll.

**Fix:** `refetchInterval: 60_000` on `useJobs` (one line), and add `jobs` to the realtime
publication + `TABLE_KEYS` so it goes live too.

### P0-4 · Two realtime gaps, one in each direction

The shell (`src/routes/_shell.tsx:76-95`) subscribes to 11 tables. `TABLE_KEYS`
(`src/lib/queries.ts:79`) maps 12. They do not match:

| Table | Subscribed? | In `TABLE_KEYS`? | Effect |
|---|---|---|---|
| `platform_accounts` | yes | **no** | A channel's token/limit changes → Channels page never updates |
| `feeds` | **no** | yes | A feed breaks or recovers → Feeds page never updates |
| `invite_links` | no | no | New invite link → Links page stale until Refresh |
| `action_log` | no | no | Activity page refreshes on focus only (this one is deliberate and documented) |
| `poll_results` | no | no | A poll closes → Polls page stale |
| `template_variants` | no | no | Wording changes → Templates page stale |
| `clip_candidates` | no | no | A clip is proposed → Clips page stale |

The first two are the real bugs — a subscription with no invalidation key, and an invalidation key
with no subscription. Both look wired and are dead, exactly like the seven tables that PR #73 fixed
in the backend. The backend fix was a migration that adds tables to the `supabase_realtime`
publication; the same pattern applies here.

**Fix:** add the missing `TABLE_KEYS` entries, add the missing `.on("postgres_changes" …)` lines, and
one more migration in the helper repo for `jobs`, `feeds`, `invite_links`, `poll_results`,
`template_variants`, `clip_candidates` (same idempotent DO block as
`supabase/migrations/20261018030000_realtime_publication_complete.sql`).

### P0-5 · Fifteen touch targets shrank to 36px, undoing PR #20

`src/styles.css:129` — `.btn { min-height: 2.75rem }` (44px). But `min-h-9` is a Tailwind
**utility**, and in Tailwind v4 utilities come after components in the cascade, so `min-h-9`
(2.25rem = 36px) wins. Eleven buttons are now 36px tall:

- `ResearchPanels.tsx` 129, 233, 276 · `Keyring.tsx` 19, 53 · `HealthExtras.tsx` 106, 113
- `health.tsx` 249, 333, 408 · `calendar.tsx` 731

Plus four non-buttons at 36px: `HealthExtras.tsx:96` and `health.tsx:240` (`.field`), and
`friday.tsx:316, 325` (`.chip`).

WCAG 2.2 AA's minimum is 24px, so these are not a hard failure — but PR #20 deliberately set 44px
and this silently undid it on the busiest pages.

**Fix:** `min-h-9` → `min-h-11` on those eleven, and let `.btn` own the size everywhere else.

### P0-6 · Buttons have no pointer cursor

The built CSS contains exactly one `cursor:pointer` (on `<summary>` elements). `.btn` sets none,
and a `<button>` defaults to `cursor: default` in Chrome. The design-system pre-delivery checklist
lists "cursor-pointer on all clickable elements" as a must-have.

**Fix:** in `src/styles.css` `@layer components`, add `cursor: pointer;` to `.btn`, `.chip`, `.entry`
and `.panel-interactive` (and `cursor: not-allowed` is already on `.btn:disabled`).

### P0-7 · The "Cancel schedule" confirmation is a fake dialog

`src/routes/_shell/calendar.tsx:749` — the confirm is a `<div role="alertdialog">` rendered inside
the sheet. A div with `role="alertdialog"` has no focus trap, no Esc handling, and focus stays on
the button behind it. Screen-reader users are told a dialog opened; keyboard users are not in one.

**Fix:** use the existing `ResponsiveDialog` with `alert` (it maps to shadcn `AlertDialog` on
desktop, Drawer on mobile) as a second, nested layer.

### P0-8 · The dashboard's own docs are wrong, and Lovable's agent reads them

Three files in `twin-approval-hub` describe a version of the app that no longer exists:

| File | Says | Reality |
|---|---|---|
| `README.md:13,33` | "BUILD NOW (two screens only)" · "Do not build any other screen yet" | 19 screens exist |
| `AGENTS.md:14,15` | AI review streams through HTTP handlers; pages reload via `useLiveReload` | AI review removed in PR #19; pages load via the query layer |
| `roadmap.md:14,27` | "Ideas and Channels pages: no spec"; "No backend endpoint exists to cancel a scheduled post or edit per-platform copy" | Both pages exist; both endpoints exist (PR #5) |

`AGENTS.md` is the file Lovable's agent treats as instructions, so a stale line there builds the
wrong thing. This is the cheapest high-value fix in the plan.

**Fix:** rewrite all three to describe today's app.

### P0-9 · Dead code and unused dependencies

- `src/lib/ai-review.ts` (68 lines) — orphaned since PR #19 removed the AI-review button and its
  server routes. Nothing imports it.
- `drizzle/schema.ts`, `drizzle.config.ts`, and the `drizzle-orm` + `postgres` dependencies — never
  imported anywhere. The backend owns the schema; the dashboard is read-only.
- 30 of the 46 shadcn components in `src/components/ui/` are never used outside that folder
  (`dropdown-menu`, `popover`, `tabs`, `table`, `tooltip`, `accordion`, `hover-card`, `scroll-area`,
  `pagination`, `menubar`, `navigation-menu`, `carousel`, `chart`, `context-menu`, `checkbox`,
  `radio-group`, `toggle-group`, `slider`, `progress`, `aspect-ratio`, `avatar`, `resizable`,
  `breadcrumb`, `calendar`, `alert`, `collapsible`, `input-otp`, `form`).
- The deps only those unused components need: `recharts`, `react-day-picker`, `embla-carousel-react`,
  `react-hook-form`, `@hookform/resolvers`, `input-otp`. They are in `package.json` and `bun.lock`
  for nothing. (They do not reach the browser bundle — the files are never imported — so this is
  repo weight, not page weight. Keep `recharts` if Phase 4 adds the charts.)

**Fix:** delete `src/lib/ai-review.ts` and the `drizzle/` folder; drop the six unused dependencies;
delete the unused shadcn components (or keep them and drop the deps — pick one and stay consistent).

### P0-10 · Six pages still load the old way, and the palette duplicates a query

`docs/LOVABLE-KNOWLEDGE.md` says: *"All server reads go through `src/lib/queries.ts`. Do not add
`useState` + `useEffect` loaders."* Six pages still do:

`clips.tsx` · `compose.tsx` · `inbox.tsx` · `insights.tsx` · `polls.tsx` · `templates.tsx`

Also:

- `CommandPalette.tsx:37` queries `content_items` itself instead of using `useNotifDrafts` — a
  second copy of the same query, so the palette and the bell can disagree.
- `channels.tsx` and `health.tsx` import **both** `lib/queries` and `useLiveReload` — they fetch
  twice for the same thing.

**Fix:** move the six pages onto the query layer; point the palette at `useNotifDrafts`; drop
`useLiveReload` from the two pages now on the query layer.

### P0-11 · The dashboard has no CI

The helper repo has a full gate (`deno check`, `deno lint`, `deno test`, `python unittest`, a real
Postgres migration + smoke job, and a secret-scan job). The dashboard has **no**
`.github/workflows/` at all — 19 screens and 66 tests with no automated check. Every PR so far
(#3–#21) was verified by hand.

**Fix:** add `.github/workflows/ci.yml` to `twin-approval-hub` running `npm ci`, `tsc --noEmit`,
`vitest run`, and `vite build`. This is also the gate that makes Phase 0 safe to land.

---

## Phase 1 — Navigation and discovery (dashboard)

**P1-1 · Badges for the pages that need Jack** — `useNavBadges` (`queries.ts:739`) covers
`/approve`, `/calendar`, `/health`, `/signals`, `/friday`. Nothing is badged for:

| Page | What should be badged | Where the number comes from |
|---|---|---|
| `/clips` | proposed clip candidates | `clip_candidates` where `status = 'proposed'` |
| `/inbox` (Messages) | unanswered comments | `inbox_items` where `status <> 'replied'` |
| `/research` | new briefs since last visit | `briefs` newest `week_start` |
| `/polls` | a poll that closed without a result | `poll_results` where `is_closed` |
| `/links` | an expired invite link | `invite_links` where `expires_at < now()` |
| `/activity` | a settings change | `action_log` where `target_table = 'settings'` |

**P1-2 · A palette that can find everything** — `CommandPalette.tsx` only searches posts in
`pending_approval` or `draft` (30 of them). Add: a filter for **published / scheduled / failed**
posts; a "jump to" for the *content* of a post, not just its title; and these actions that do not
exist yet — **Approve next pending post** (opens the Inbox focused on the oldest), **Copy today's
brief**, **Open Health queue**, **Ask the bot for Friday numbers**.

**P1-3 · Deep links for the eleven pages that lack them** — `src/lib/url-state.ts` already does
this properly for `/approve`, `/calendar`, `/signals`, `/friday`, `/links`, `/activity`. Extend the
same pattern to `/health` (which source, which filter), `/templates` (post type + platform),
`/clips`, `/inbox`, `/polls`, `/insights`, `/research`, `/ideas`, `/channels`, `/settings`. Rule of
thumb: **any filter that changes what a page shows belongs in the URL**, so Jack can bookmark or
paste a link to exactly that view.

**P1-4 · Give the Mini App a way in** — `/mini` exists, works, and **nothing links to it**: no nav
entry, no button, no bot button, no URL anywhere in either repo. It is an island. Add a nav item
(under Approve) and the bot's `web_app` button (Phase 3).

**P1-5 · The palette's "Recent" list drops the page you are on and shows at most four** —
`CommandPalette.tsx:41` does `.slice(1, 5)` on a list whose first entry is the current page. So the
current page is always excluded, and only four past pages show. Fix: `.slice(0, 6)`.

**P1-6 · "What changed since yesterday" on Today** — `health/today` gives pending, failed, next
and minutes saved. The Activity page already reads `action_log`. Surface the last five changes on
the Today page so Jack sees "what moved" without leaving it.

**P1-7 · Saved views** — a "Save this view" button that stores the current filter set (query
string) as a named shortcut in `localStorage`, listed in the palette. Cheap, and it turns the
palette into a real tool rather than a jump-menu.

---

## Phase 2 — Backend functions that have no button anywhere

Every one of these is live in the backend today. None of them is reachable from the dashboard.

| Endpoint | What it does | Where the button belongs | Role |
|---|---|---|---|
| `research/expand` | runs the demand crawl now | Research page → "Expand topics now" | jack, abdul, cron |
| `research/feeds` | polls every feed once | Feeds page → "Poll all feeds now" | jack, abdul, cron |
| `research/brief` | writes the Monday brief | Research page → "Write this week's brief" | jack, abdul, pc_worker |
| `research/channels` | refreshes competitor channel stats | Insights → "Refresh channel stats" | jack, abdul, cron |
| `friday/post` | builds the Friday scorecard post, queues the scorecard image, pushes to the Desk | Friday page → "Post the scorecard" | jack, abdul, cron |
| `friday/request-inputs` | asks the Desk for the missing numbers | Friday page → "Ask for the missing numbers" | jack, abdul, cron |
| `friday/export` | exports the scoreboard | Friday page → "Export" (it has a copy button; this is a file) | jack, abdul, cron |
| `content/batch` | builds the Wednesday batch now | Calendar → "Build this week's batch" | jack, abdul, cron |
| `content/annual-offer` | drafts the annual offer | Compose → as a template entry | jack, abdul, cron |
| `content/{id}/fanout` | copies one post to the other platforms | Inbox card → "Fan out" (the **bot** has this; the dashboard does not) | jack, abdul, cron |
| `results/stop-if` | lists the stop-if breaches | Signals page → a list under the badge | reports.read |
| `metrics/snapshots` | the historical snapshots | Insights | reports.read |
| `metrics/benchmarks` | competitor channel numbers (size, avg views, view rate) | Insights → a new Benchmarks panel | reports.read |
| `jobs/enqueue` | queues a job | A "Run this now" button (re-cut a clip, rebuild the scorecard) | jack, abdul, cron |

**P2-1** · The biggest one is `friday/post`: it creates a real post, queues the scorecard image on
the PC, and pushes the draft to the Desk for approval. Right now Jack asks ABDUL to run it. One
button.

**P2-2** · `metrics/benchmarks` is the data behind the competitor-channel work. A table with a bar
per channel turns a wall of numbers into a page Jack can read in ten seconds.

---

## Phase 3 — Telegram bot: navigation, functions, buttons

The bot is the faster path for most of Jack's day, and it currently exposes six screens against a
backend that supports many more.

### 3.1 · `copy_text` buttons — the single biggest bot win

Bot API 7.10 added the `copy_text` button type. Jack can tap once and the post body is on his
clipboard, ready to paste into Telegram, Instagram, X. Today the only way to get a body out of the
bot is 👁 (a new message) and a manual selection.

**Change:** `InlineButton` in `_shared/tg.ts` needs a `copy_text?: string` field alongside
`callback_data` and `url`; `approvalKeyboard` gets a **📋 Copy** row; the draft card and the
batch list get one per item.

### 3.2 · `web_app` button — open the dashboard from the Desk

`InlineButton` supports `web_app: { url }`. A **"Open in dashboard"** button on the draft card
opens `/mini` (or the dashboard) inside Telegram.

**Needs three things:** a `dashboard_url` setting (does not exist — `SETTING_KEYS` in
`_shared/supabase.ts:126` has no URL of any kind), the `web_app` field on `InlineButton`, and
BotFather registration of the Mini App. The `/mini` route and the `tg-auth/verify` HMAC check are
already built and tested.

### 3.3 · `setChatMenuButton` — a permanent button under the chat input

Today the Desk menu only exists inside a message. `setChatMenuButton` puts a button next to the
text field, always visible: **"Open dashboard"** or **"Pending drafts"**.

### 3.4 · The Back button does not go back

`_shared/tg.ts:538-546`:

```ts
export function backHomeRows(fp = NAV_LAYOUT): InlineButton[][] {
  return [[
    { text: "⬅️ Back", callback_data: navCallback("home", undefined, fp) },
    { text: "🏠 Home",  callback_data: navCallback("home", undefined, fp) },
  ]];
}
```

Both point at home. Every screen's Back button is a lie.

**Fix without breaking statelessness:** encode the previous screen in the callback data —
`nav:back:<prevScreen>@<fp>` — which fits in 64 bytes and needs no server memory. The webhook
already handles `nav` with an `arg` (`tg.ts:417`), so this is a small change in the builder and the
router.

### 3.5 · `sendChatAction` while the local model cooks

`onAdjust` (`tg-webhook/index.ts:368`) answers *"Angles cooking on the PC — I'll bring them here"*
and then the bot is silent for up to a minute while the local model runs. `sendChatAction("typing")`
keeps the chat alive. The wrapper does not have it; add it to `_shared/tg.ts`.

### 3.6 · `force_reply` on "Write my own"

The Edit preset **Write my own** (`editKeyboard`, `tg.ts:484`) asks Jack to reply, but a plain reply
could land in the wrong chat. `force_reply: true` makes Telegram attach the answer to the prompt
message. The wrapper has no `force_reply` support.

### 3.7 · `protect_content` on Desk messages

`SendOpts` already has `protect_content` (`tg.ts:39`) and **nothing uses it**. The Desk group shows
paid gold-map drafts, signal cards and results. `protect_content: true` stops members forwarding
them out of the group. This is a one-line change in `common()` — and it is the difference between
"private group" and "private group where nothing can be copied".

### 3.8 · A `/today` screen

The bot's Status screen shows health beats from the last 15 minutes and an open-alert count. The
backend's `health/today` returns pending approvals, failed publish jobs, the next scheduled posts
and minutes saved — and the dashboard's Today page renders all of it. The bot should have the same
one-glance screen. This is the bot's biggest missing function.

### 3.9 · A `/queue` screen

`GET /jobs` returns counts per kind and status (the dashboard shows it as a table on Health). A
bot screen with the same table answers "is the PC behind?" in one tap.

### 3.10 · Commands the bot has but does not advertise, and vice versa

`scripts/deploy.sh:92` registers six commands with Telegram:

```
menu · status · friday · batch · hours · help
```

but the bot's own `/help` text advertises **eight** — it also lists `/fanout` and `/clips`, which
Telegram's command menu does not show, so they are invisible until Jack remembers them. And the
**drafts screen exists with no slash command at all** — `/menu` is the only way in.

**Fix:** add `drafts`, `clips`, `fanout`, `today`, `queue` to the `setMyCommands` list, and add
`/drafts` to `onDeskCommand` (it is a `nav` screen already; the slash command is three lines).

### 3.11 · The batch list needs paging

`batchListKeyboard` (`tg.ts:497`) emits one row per item plus Refresh plus "Approve ready" — a
twelve-item batch is a fourteen-row keyboard. The drafts screen already pages (`pg:<screen>:<n>`);
the batch list should reuse it.

### 3.12 · Preview a body in place instead of sending a new message

👁 (`vw`) sends a fresh message with the body. The card is then somewhere else in the chat, and
the buttons are on the old message. Editing the card in place — which `replaceRowsFor` already
supports — keeps one card per post.

### 3.13 · Pin the Desk panel

`pinChatMessage` exists in `_shared/tg.ts:283` and is only used by the publisher. Pinning the
current Desk panel means the live state is always at the top of the group.

### 3.14 · DM support

`tg-webhook/index.ts:1542` — *"Any other chat: ignored on purpose (no DMs, no other groups)."* That
was the right call when the bot had six screens. Now a DM with `/status`, `/pending` and
`/drafts` would let Jack check state from a private chat without opening the group at all. It is
one `else if` branch, and the same Jack-id check already applies to every callback.

### 3.15 · The home panel should carry the counts

The home panel says "Status · Batch · Friday · Hours · Help — tap a button." A one-line summary
above it — *3 pending · 1 failed · next post 18:00* — is what Jack actually wants when he opens
Telegram.

---

## Phase 4 — Modern dashboard UI/UX elements

**P2-3 · Charts** — `recharts` is already installed (currently only referenced by the unused
`ui/chart.tsx`). Insights is four tables: best posting hours, hook performance, engagement per day,
signal ledger. The first three are time series and want a chart each — a bar chart for the best
hours, a line for engagement, a horizontal bar for hooks. The signal ledger stays a table (it is
numbers you compare, not a shape).

**P2-4 · Virtualized long lists** — the feed list (`useFeedItems`, infinite, 50 per page) and the
signal board (100 rows) are the two long ones. `TanStack Virtual` is not installed; the signal
board at 100 rows does not need it, the feed list might.

**P2-5 · Toasts with Undo** — sonner supports an action button, and the dashboard already uses one
("View"). Undo is only safe for actions that can be reversed without consequence:
**Cancel schedule**, **Retag backlog**, **Create link**, **Save wording**. It is **not** safe for
Approve — the post may already be out — so the approve toast should offer "View", not "Undo".

**P2-6 · A diff view in the Edit dialog** — `EditVariantDialog` replaces the body wholesale. A
before/after diff against the stored body makes a compliance retry (a banned word, a stray number)
a one-word fix instead of a rewrite, and it is the difference between "the edit broke it" and "the
edit changed three words".

**P2-7 · A real data table for Signals and Insights** — sorting, filtering and pagination are
hand-rolled with `<select>` elements today. shadcn `table` + TanStack Table is the standard
pattern (both are in the repo: `ui/table.tsx` exists, unused).

**P2-8 · Responsive tables** — the Links page already switches to cards under 768px. The Activity
and Insights tables do not, and both scroll horizontally on a phone.

**P2-9 · Per-page freshness** — the top bar shows "Updated hh:mm" for the last load. The Health page
has its own interval picker; the Inbox does not tell Jack how old the list is when the realtime
channel has been down for a while.

**P2-10 · Copy on the read-only pages** — Clips, Activity, Polls and Signals have no copy button.
Copying a poll result or a signal card is a normal thing to want.

**P2-11 · A real PWA** — `manifest.webmanifest` declares one icon: a 48×48 `.ico`. Add 192×192 and
512×512 PNGs, a maskable icon, and an `apple-touch-icon` so the installed app on a phone looks like
an app. Then add a small service worker that caches the shell, so the installed app opens offline
and the existing "You're offline" banner has something to show.

**P2-12 · `og:image`** — there is no `og:image` and no `canonical`. The dashboard gets shared in
Telegram and Slack; without an image, a shared link is a bare URL in a text bubble.

**P2-13 · Motion polish** — the page fade exists (240ms). The design-system guidance suggests a
stagger on list items (300–450ms, `back.out`) and a press state on the filter chips. Both are CSS
only, and `prefers-reduced-motion` is already respected globally — the reduced-motion block in
`styles.css:223` handles the new motion for free.

**P2-14 · Check the bottom-nav overlap** — `SidebarInset` gets `pb-20` on mobile so the fixed
bottom nav does not cover the last row. The Activity page uses `useInfiniteQuery` with a "Load
more" button; on a phone that button can sit under the nav.

**P2-15 · Keyboard-first review mode** — the Inbox has J/K/A/R/S, but the focus model needs a
pointer to be useful. A **review mode** (one post at a time, no scroll, A/R/S, Space to expand the
findings) turns the Inbox into something Jack can clear in 30 seconds without touching the phone.

---

## Phase 5 — Mini App (Telegram Web App) upgrades

`src/routes/mini.tsx` is 318 lines and works, but it uses about a fifth of the Telegram Web App
API and one third of the dashboard's own features.

**P2-16 · The unused TMA surface** — today only `ready()`, `expand()`, `MainButton`,
`HapticFeedback.notificationOccurred` and `themeParams` are used. Unused and worth adding:
`BackButton` (navigate the queue without a gesture), `SecondaryButton`, `viewport` /
`viewportChanged` (the queue should react to keyboard height), `themeChanged` (Telegram's dark
theme change mid-session), `safeAreaInsetChange`, `close`, `setHeaderColor` / `setBackgroundColor`
(the app currently paints the Telegram background with CSS, which ignores the user's accent),
`requestFullscreen`, `openTelegramLink`, `share`, `isVersionAtLeast` (feature-detect before using
the newer ones).

**P2-17 · Edit and Reschedule in the Mini App** — it can approve and reject only. The dashboard has
both (`EditVariantDialog`, `content-actions.ts`). Jack approving from his phone is the whole point
of the Mini App, and the most common correction is an edit, not a rejection.

**P2-18 · One shared write path** — the Mini App has its own `call()` and its own Supabase client
(`mini.tsx:49-73`) because it authenticates with `x-twinos-session` instead of a JWT. The write
helpers in `src/lib/content-actions.ts` (`editVariant`, `cancelVariant`) are reusable if the
session header is threaded through — that keeps one implementation of the compliance-error
handling (the 409-with-findings path) instead of two.

**P2-19 · Swipe needs a button equivalent** — the queue swipes horizontally with a 60px threshold.
There are Prev/Next buttons, so the gesture is a shortcut, not the only way — good. But the swipe
threshold does not know about the Drawer (the reject sheet), so a horizontal drag while the sheet
is open can move the queue behind it.

**P2-20 · One note rule** — the Mini App's reject note is optional (`mini.tsx:196`), the Inbox's is
optional (`approve.tsx:374`). The Desk bot's reject is immediate. Pick one rule and use it in all
three places.

---

## Phase 6 — Quality gates

- **P1-8 · CI for the dashboard** — see P0-11. This is the gate for everything else.
- **P1-9 · A test for the navigation** — none today. `checkShortcuts()` (`AppNav.tsx:54`) throws at
  import time if two pages share a jump key or a page has none, which is a good build-time guard,
  but nothing asserts that every `NAV_GROUPS` entry has a route file, that every badge key maps to
  a real page, or that the palette's groups stay in sync.
- **P1-10 · A test that the 44px rule holds** — a small lint/test that fails when a `.btn` carries
  `min-h-9`. P0-5 is the kind of thing that comes back the next time someone adds a button.
- **P1-11 · An accessibility pass over all 19 screens** — the app is close: a global focus ring
  exists (`styles.css:214`), `prefers-reduced-motion` is honoured, `prefers-reduced-motion` is the
  only motion, contrast is fine (`#8B98A5` on `#0B0F14` is about 7:1). The open items are the
  touch targets (P0-5), the fake dialog (P0-7), and **`aria-live` on the Inbox** — when a post is
  approved, the list changes silently for a screen reader; sonner's toast is announced, but the
  count change is not.
- **P1-12 · A bundle-size budget** — measure after P0-9's removals, then keep it.
- **P1-13 · A changelog that matches reality** — see P0-8.

---

## Deliberately not doing

| Idea | Why not |
|---|---|
| Bulk approve / auto-approve | `UPGRADE-PLAN.md` §17 "Never". The approval gate is the point. |
| Light mode | The design system says dark-only, and the app is a night-time tool. |
| framer-motion / heavy animation | The project rule is CSS-only motion, 150–320ms. |
| An AI rewrite button in the browser | Drafting runs through the backend and the local model. |
| Drag-to-reschedule on the calendar | A big change for a job Jack does twice a week; the Cancel button covers the mistake. |
| Removing the slow "you are offline" banner | It is honest. A service worker (P2-11) makes the app work offline rather than pretending to. |

---

## Suggested order and size

| Phase | What | Size | Risk | Needs |
|---|---|---|---|---|
| 0 | The bugs | 1–2 days | Low | CI first (P0-11) |
| 1 | Navigation | 2–3 days | Low | — |
| 2 | Wire the backend | 3–4 days | Medium (writes) | role checks per endpoint |
| 3 | The bot | 2–3 days | Low–Medium | BotFather, a `dashboard_url` setting |
| 4 | Dashboard polish | 3–5 days | Low | — |
| 5 | Mini App | 2 days | Medium | Phase 3.2 first |
| 6 | Gates | 1 day | Low | — |

Phases 0 and 1 are independent and can be done in either order. Phase 3.2 (the `web_app` button)
should land with Phase 5 so the Mini App is not a dead link in between.

---

## Steps only Jack can do

**1 · The Mini App has to be registered with BotFather** before any `web_app` button can open it.
`@BotFather` → `/newapp` → pick `@EzyOps_bot` → give it a title and a URL
(`https://twin-approval-hub.lovable.app/mini`) → it returns a `t.me/EzyOps_bot/<app>` link. That
link is what the bot's button opens.

**2 · Telegram's command menu** is set by `scripts/deploy.sh` on every deploy. The new list
(`drafts`, `clips`, `fanout`, `today`, `queue`) goes in that `COMMANDS='…'` string, so it ships
with the next deploy — no manual BotFather step, as long as the deploy script runs.

**3 · The dashboard URL** has to be stored so the bot can link to it. It does not exist yet
(`SETTING_KEYS` in `_shared/supabase.ts:126` has no URL). Add a `dashboardUrl` key, then set the
value from the dashboard's own **Settings** page — the JSON editor there writes through
`set_setting`, which is the safe path (no hand-written SQL).

**4 · The Lovable publish.** The dashboard is served by Lovable; changes pushed to `main` sync
back into the project, and the live site follows once Lovable publishes. After the P0-2 fix, check
that the headers are really on:

```bash
curl -sI https://twin-approval-hub.lovable.app/ | grep -iE 'x-robots-tag|content-security-policy|permissions-policy|cross-origin-opener'
```

Expect four lines. Today it prints nothing.

**5 · Register the new realtime tables** in the helper repo, then deploy the functions:

```bash
supabase db query --linked --output-format json "select 1"
```

then let `scripts/deploy.sh` run as usual.

---

## One more pass after this lands

Re-run the **Front-End Checklist** (https://frontendchecklist.io — HTML, CSS, JS, performance,
accessibility, SEO, security, images) over all 19 screens, not just the public sign-in page. Phase 0
fixes the known checklist failures (pointer cursor, target size, headers); a full pass would catch
the per-screen ones.
