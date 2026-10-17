# Wave 5 — dashboard prompts (Lovable, one per item)

Paste **one prompt at a time** into the Lovable project "TwinOS"
(`8aa151d6-f29b-4fba-8daf-345c4df50963`). After each one, report back the changed
files and wait for the next prompt. Each prompt spends credits; stop and report
if a prompt asks for a column the schema does not have (never add tables — say
which column is missing instead).

This wave is the **daily-friction wave**: everything here exists so Jack spends
fewer minutes a day configuring and hunting and more minutes posting. Standing
rules for every prompt (also in `docs/LOVABLE-KNOWLEDGE.md`): frontend only; the
anon key and the session JWT are the only credentials; writes only through
`supabase.functions.invoke` or the one RPC below; approval stays Jack-only with
a confirm, never bulk, never on blocking findings; `[NEEDED:…]` always visible;
no framer-motion; `prefers-reduced-motion` respected; EzyMap green `#19C37D` /
gold `#E3B341` / red `#E5484D` on `#0B0F14`; Inter; Malay is `ms`; times in
`Asia/Kuala_Lumpur`; everything must work at 390 px.

**New contracts this wave** (already deployed; nothing here needs a schema
change):
- `supabase.rpc('set_setting', { p_key, p_value })` — jack only. Clears
  `needs_confirm`, logs to `action_log`, **refuses a key the seed does not
  define**. `supabase.rpc('setting_text', { p_key, p_value })` is the same for a
  plain string, because `settings.value` is `jsonb` and a bare string is a
  syntax error.
- `GET /health` now returns `integrations`: one row per provider with `purpose`,
  `ready`, `missing` (secret names only), `get_url`, `set_command`.

---

## 1. Keyring and Settings — the screen that answers "why is this broken, and where do I go?"

> Split the Settings page into two sections, **Keyring** then **Settings**, and
> make Keyring the first thing on it.
>
> **Keyring** comes from `GET /health`'s `integrations` array. One card per
> provider, ordered with the not-ready ones first. Each card shows: the `label`,
> a one-line `purpose`, and a state — green "connected" or red "missing N
> secret(s)". For a not-ready card, expand it by default and show, on separate
> rows, the `get_url` (opens in a new tab, with a copy button) and the
> `set_command` in a monospace block with a copy button that swaps to a check
> mark for 1.5 s. A **Verify** button on each card re-calls `GET /health` and
> re-renders that card only, with a 1 s spinner. Cards never show, request or
> store a secret value — the `missing` array contains names and that is all.
> Above the cards, one line counting what is ready: "5 of 6 connected".
>
> **Settings** below it lists `settings` rows. Rows with `needs_confirm = true`
> go first under a heading "Needs your confirmation", each showing the
> description and an inline editor: a textarea for the raw JSON value, a **Save**
> and a **Cancel**, and a hint under the box naming the type — for a JSON string
> write `"a value"`, for null write `null`. Saving calls
> `supabase.rpc('setting_text', …)` when the value is a plain string and
> `supabase.rpc('set_setting', …)` otherwise. On success the row drops out of
> the confirmation group; on an error show the returned message inline under the
> box, never a toast that disappears. Group the rest of the rows under headings
> (Times, TikTok, Platform limits, Language, Targets, Signatures) read from a
> small map in the component — the keys are stable. Rows never display a secret
> and there is no field for one. A **Copy** button on every description, because
> Jack pastes these into ABDUL. Everything works at 390 px: cards stack, and the
> editor is a full-width textarea, not a modal.

## 2. Today — the landing page, and navigation grouped by intent

> Make the dashboard open on a **Today** route instead of the approval list, and
> regroup the navigation.
>
> **Today** reads `GET /functions/v1/health/today` and renders, in this order:
> one line "anything broken?" (a green sentence when the day is clean, a red one
> naming the count when it is not), **Needs your approval** (the count, linking
> to the Inbox), **Scheduled today** (the next five `publish_jobs` rows with
> platform and time), and **Still missing for Friday** (the
> `missing_inputs` array from `GET /functions/v1/friday`). Four panels, no
> charts, and nothing that needs scrolling past on a phone. If the call fails,
> show the error and a Retry button — never an empty panel that reads as "all
> clear".
>
> Regroup the navigation into four sections, each route lazy-loaded:
> **Approve** (Inbox, Calendar, Clips), **Grow** (Research, Ideas, Feeds,
> Channels), **Know** (Analytics, Signals, Polls), **Run** (Health, Settings).
> Keep the current routes working and redirect the old ones. The role check and
> the "no TwinOS role" screen stay in the one app-shell layout; no page repeats
> them. Today sits above the groups, marked as the landing route. Active route
> gets the green indicator; everything is reachable at 390 px from the same
> drawer.

## 3. Research — filter chips, sort, and a two-pane detail

> Rebuild the Research screen around filtering rather than a single list. It
> reads `topic_clusters`, `briefs`, `v_repeat_questions`, `csi_captures` and
> `feeds` as it does now; nothing new is written.
>
> At the top, a sticky row of filter chips: **pillar** (map_recap, channel_audit,
> lesson, start_safe, tool_demo, jacks_desk), **status** (new, proposed, used,
> rejected), and **lang** where a row carries one. Chips are multi-select within
> their group and combine across groups, with a visible count of what the
> current filters leave. A sort control beside them: **score** (default,
> `total_score` descending), **newest**, **name**.
>
> Below, a two-pane layout on desktop — list on the left, detail on the right —
> and a push-to-detail stack on mobile. The detail pane shows the cluster's
> fields with their labels: demand, ICP fit, compliance risk, the three shown as
> numbers rather than bars (a bar on a 0–1 scale reads as decoration), its
> `pillar`, its `persona`, and its `notes`. If `used_in_item_id` is set, show a
> link reading "used in this post".
>
> On `csi_captures`, group rows by `topic` and show the readings newest first
> with the `trend` as the words up / flat / down — no arrow icons.
> On `briefs`, show the `proposed_slots` as a list of day, pillar and topic, and
> keep the brief body in a collapsible panel below it, not above the slots.
> A **Copy** button on any topic, because Jack pastes it into the Desk.
> No write anywhere on this screen.

## 4. Calendar — the week view, and a day column that fits a phone

> Build the week calendar from `publish_jobs` joined to `content_items`, with no
> new endpoint: read `publish_jobs` where `run_at` is inside the selected week
> (Monday to Sunday in `Asia/Kuala_Lumpur`), ordered by `run_at`, and load
> `content_items` for those ids in a second query. A week picker at the top with
> previous / this week / next, defaulting to the current week.
>
> Desktop: seven day columns, each card showing the time in `Asia/Kuala_Lumpur`,
> the post type, the language, and the job status — `failed` in red with the
> `last_error` on hover, `queued` muted, `published` green. Clicking a card goes
> to that item's approval detail. A filter row above the grid: platform and post
> type, reading the types from `templates` rather than hardcoding them.
>
> Mobile: a single scrollable day list, not a squeezed grid — seven columns at
> 390 px is unreadable, so show one day with a horizontal day strip above it and
> prev/next tap targets of at least 44 px. Every card works at 390 px.
> Nothing on this screen approves, publishes or deletes. If `publish_jobs` is
> empty for the week, show "Nothing scheduled this week" with a link to the
> Inbox — never a blank grid.

## 5. Signals — the trust ledger, honestly rendered

> Rebuild the Signal board around `v_signal_ledger` as well as `signals`, because
> the ledger is the promise: every signal, its card and its result, and none of
> it deletable. Read both; write nothing except through the existing `results`
> call.
>
> One card per signal: pair, direction, entry, created time, and two explicit
> states — **Card posted** and **Result posted**, each rendered from the
> ledger's `card_posted` and `result_posted` booleans. When `card_posted` is
> false say "card not posted" in gold, not grey: a missing card on the public
> board is a real gap, not an absent feature. When `result_posted` is false and
> the signal is past its window, say so in red.
>
> Above the list, a summary line: the count of signals with a card, the count
> with a result, and the coverage as a percentage. Below it, the existing
> "post result" button for a closed signal with no reply, unchanged: it calls
> `POST /functions/v1/results` with `dry_run: true` first and shows the text
> before any confirm, and the confirm button is jack only.
>
> Keep the four-week strict win rate and the W/(W+L) explanation visible with a
> tooltip saying break-evens are excluded. Never render or post anything from a
> signal unless `data_source = 'live'` and `status <> 'shadow'`.
> An error loading the ledger shows the message and a Retry, and never shows
> "no signals" when the call failed.

---

## What this wave does not do, and why

Four upgrades from the review need the **backend** first, and none of them can
be built from the dashboard without inventing tables:

- **Templates keyed by `(post_type, platform, lang)`** — `templates.key` is
  `post_type` as its primary key, so one post type has one template and no
  per-platform caption. That is the choke point behind per-platform copy
  control. It is a schema change and belongs in this repo first.
- **Tagged, scored `feed_items`** — the table has no category, tag, language or
  relevance column at all, so research cannot be sorted by anything.
- **`{{cta}}` and `{{hook}}` render slots** — `ctas` and `hooks` rotate by
  least-recently-used but `render()` has no placeholder that pulls from them.
- **A calendar endpoint** — prompt 4 reads the tables directly because that is
  honest for a week view; a `/content/calendar` route is worth it only once the
  composer exists.

Say which of those to build in the backend and they land as a Wave 6 of prompts.
