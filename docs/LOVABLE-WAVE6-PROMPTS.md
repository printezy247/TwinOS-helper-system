# Wave 6 — the copy-control and research prompts (Lovable, one per item)

Paste **one prompt at a time** into the Lovable project "TwinOS"
(`8aa151d6-f29b-4fba-8daf-345c4df50963`). After each one, report back the changed
files and wait for the next prompt. Each prompt spends credits; stop and report
if a prompt asks for a column the schema does not have (never add tables — say
which column is missing instead).

Wave 6 is the **copy-control wave**: one post type can now be written for
several platforms, research can be filtered by what it is about, and the
calendar reads a real endpoint. Standing rules are unchanged and live in
`docs/LOVABLE-KNOWLEDGE.md` — frontend only; the anon key and the session JWT
are the only credentials; writes only through `supabase.functions.invoke`; the
approval gate is never widened; no framer-motion; `prefers-reduced-motion`
respected; EzyMap green `#19C37D` / gold `#E3B341` / red `#E5484D` on `#0B0F14`;
Inter; Malay is `ms`; times in `Asia/Kuala_Lumpur`; 390 px throughout.

**Contracts this wave assumes, all already deployed:**
- `template_variants (post_type, platform, lang)` overriding `body`, `fields_list`,
  `char_limit` and `hashtag` only. Read-only from the UI.
- `GET /functions/v1/content/calendar?week=YYYY-MM-DD` → `{ week_start, tz, days[] }`.
- `feed_items.tags`, `.category`, `.lang`, `.match_score`.

---

## 1. The composer — one post type, several platforms

> Add a platform selector to the draft composer and make the character counter
> follow it.
>
> The composer already picks a post type and a language. Add **platform**
> (telegram, instagram, facebook, threads, youtube, tiktok, x), defaulting to
> telegram, and pass it through to `content/draft`. Changing it re-reads the
> template rather than re-rendering the old text: the same post type can now
> carry a different body, `fields_list`, `char_limit` and `hashtag` per
> platform.
>
> The character counter shows the **platform's** limit, not a global one, and
> sits under the textarea: "1,240 / 2,200". Colour it gold within 200
> characters of the limit and red over it. A second line shows the hashtag count
> when the platform has a floor or a ceiling, phrased as what is missing or
> excessive, not as a percentage. Above the counter, when the platform differs
> from telegram, a quiet line reading "This platform has its own wording" —
> shown only when a `template_variants` row actually exists for the
> (post_type, platform, lang), which you can tell from the returned body
> differing from the telegram one.
>
> Nothing here writes `template_variants`. A missing override is normal, not an
> error: the composer composes against the base template and says so.
> Approve, reject and schedule are unchanged and still jack-only.

## 2. Research — filter and sort on what the items are actually about

> Wire the Research screen's feed items to the tags the backend now writes.
>
> Above the feed-items list, a sticky filter row: **category** chips built from
> the distinct `category` values present in the loaded rows (not a hardcoded
> list — pillar names drift), and a **search** box over `tags`. Below them, a
> sort control: **relevance** (default, `match_score` descending, nulls last),
> **newest**, **oldest**.
>
> Each row shows its title, its feed name, and, when it has any, its tags as
> plain text separated by commas — not pills, not badges, because a row with
> eight tags is unreadable as eight chips at 390 px. Show `match_score` as a
> number only when it is above zero, and never as a bar: it is a count of a
> persona's own words, not a percentage, and a bar would imply otherwise.
>
> Rows with no tags sort to the bottom and say "not about any of your readers'
> questions" in muted text. That is a real answer, not an empty state — do not
> hide those rows, and do not present them as broken. The list keeps working
> with zero tagged rows: filter and sort simply have nothing to narrow, which is
> exactly what an untagged database looks like.
>
> Read-only. Nothing on this screen posts, drafts or deletes.

## 3. The calendar — read the endpoint, not the tables

> Replace the calendar's direct table reads with
> `GET /functions/v1/content/calendar?week=YYYY-MM-DD`.
>
> **Render exactly seven day columns from the returned `days` array, in order,
> and never derive a date in the browser.** The server returns the day keys
> already computed in `Asia/Kuala_Lumpur`: a post at 23:30 MYT belongs to the
> next day for a reader whose browser is on UTC, and re-deriving that in the
> client is how a schedule ends up lying about when things went out. If the
> response's `tz` differs from what you assumed, show the server's, not yours.
>
> Desktop: seven columns, each card showing the time, the post type, the
> platform, the language and the status — `failed` in red with `last_error`
> underneath, `queued` muted, `published` green. Clicking a card goes to that
> item's approval detail.
>
> Mobile: one scrollable day list with a horizontal day strip above it and
> prev/next tap targets of at least 44 px. Seven columns at 390 px is unreadable.
>
> A week picker above the grid: previous / this week / next, defaulting to
> whatever `week_start` the server returns. Platform and post-type filters read
> the types from `templates`, never a hardcoded list.
>
> An empty `days` array means nothing was scheduled that week, which is a real
> state: show "Nothing scheduled this week" with a link to the Inbox, never a
> blank grid and never an error. A failed request shows the message and a Retry
> button and never renders as an empty week.
>
> Nothing on this screen approves, publishes, reschedules or deletes.

## 4. Template variants — a Jack-only editor, or nothing

> Read `template_variants` and show, on the composer, a small **"This platform
> uses its own wording"** panel listing the overrides that exist for the current
> (post_type, platform, lang): which of `body`, `fields_list`, `char_limit`,
> `hashtag` differ from the base template.
>
> Show it as a read-only list. **Do not build an editor for it yet.** Writing
> `template_variants` is Jack's, the RLS allows only him, and a form that writes
> a body without a compliance check in front of it is a worse version of the
> Desk. When there is a decision to build that editor, it gets its own prompt
> with the compliance gate designed into it.
>
> If every field is inherited, the panel does not render at all — silence is
> accurate here, a panel saying "using the default" is noise.

---

## What Wave 6 still does not do

- **No template-variant editor.** Deliberate — see prompt 4. It needs a
  compliance check in front of any body write, and that is a design decision,
  not a form.
- **No A/B variant fan-out** (`ab_variants` on a template). The `hooks` bank
  already rotates and `v_hook_performance` already reads `hook_id`, so the
  evidence loop works; what is missing is the schema to ask for N variants of
  one draft at once.
- **No re-tagging of old feed items — one line, not a prompt.** `tagFeedItems` runs on ingest, so items
  collected before the migration start untagged. `POST /functions/v1/research/retag { limit? }` drains
  the backlog oldest-first and bounded, so calling it again works the next batch; `twinos_research
  what=retag` is the same route through ABDUL. Run it once, or leave it — the untagged rows still show,
  they just sort last.
