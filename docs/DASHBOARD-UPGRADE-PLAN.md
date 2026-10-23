# TwinOS Dashboard — v4 Upgrade Plan

> **Status:** Built and published (2026-10-23) · **Owner:** Jack · **Scope:** Lovable dashboard (frontend only) · **Date:** 2026-10-23
>
> **Gate:** Approved by Jack on 2026-10-23. See the Outcome section at the end.

This plan covers four asks in one pass because they all touch the same shell (sidebar, top bar, notifications panel). Implementation lands as a sequence of Lovable prompts once approved.

---

## 1. Left sidebar — hideable + uniform

### What exists today
- `AppSidebar` already uses `collapsible="icon"` and `Ctrl+\` toggles it (persisted to `localStorage` key `twinos.sidebar.collapsed` in `_shell.tsx`).
- Groups: Today / Approve / Grow / Know / Run — hardcoded `GROUPS` array in `AppNav.tsx`.
- Mobile: `BottomNav` with a "More" drawer.

### Fixes / upgrades
1. **Persist collapse per device, not per session key collision.** The current `COLLAPSE_KEY` is fine; add a small `useSidebarPreference` hook so the toggle survives refresh on both desktop and mobile drawer state.
2. **Icon-only compact mode** (already works via shadcn `collapsible="icon"`), but ensure tooltips show the `g <key>` shortcut from the `JUMP` map so the collapsed sidebar still teaches keyboard navigation.
3. **Keyboard shortcut to toggle** — `Ctrl+\` already wired in shadcn Sidebar; verify it's registered app-wide and add a toast confirmation ("Sidebar collapsed").
4. **Mobile drawer** — the `BottomNav` "More" drawer already mirrors groups; keep grouping intact. Add a close-on-route-change so the drawer doesn't stay open after navigation.
5. **Visual uniformity** — normalize:
   - Button height: `min-h-11` everywhere (currently mixed).
   - Focus ring: reuse the existing `focusRing` constant (`focus-visible:ring-2 focus-visible:ring-ring`) on every clickable, including sidebar items.
   - Active state: `isActive` highlight uses `bg-secondary` — make sure the color matches the EzyMap green accent on dark (`#19C37D` for active/selected tint, not raw `bg-secondary`).

**Files touched:** `src/components/AppNav.tsx` (sidebar + bottom nav), `src/routes/_shell.tsx` (collapse persistence hook extraction).

---

## 2. More navigation options

### What's there
- Desktop sidebar (Today, Approve, Grow, Know, Run) — 18 pages + `/compose`.
- Bottom nav on mobile (4 items) + "More" drawer for the rest.
- `JUMP` map gives `g <key>` shortcuts for 16 routes (`/compose` excluded — single `n` key).
- `CommandPalette` (⌘K) with pages, pending items, Refresh.

### Upgrades
1. **Jump-keys cheat sheet inside CommandPalette.** Add a "Shortcuts" section listing every `g <key>` route so users discover them without memorizing. Keep it filterable by the palette's search.
2. **`/compose` shortcut in the cheat sheet.** Currently absent from `JUMP` (it uses `n` alone); add a note line "N  New post" so the palette is complete.
3. **Recent pages in CommandPalette.** Add a "Recent" section from `pushRecent` / `recentNotices` path history so ⌘K goes back without hunting the sidebar.
4. **Mobile bottom-nav review.** The 4 `BOTTOM` items are Today / Inbox / Calendar / Signals. Add **Health** as a 5th? No — the rule from LOVABLE-KNOWLEDGE (Wave 2) is "Bottom nav ≤5". Keep 4 and leave Health in the More drawer. But ensure every bottom item shows its real-time badge (Today, Inbox, Calendar already do via `useNavBadges`; Signals badge exists).
5. **Go-to shortcuts for power users.** Add `gm` = Messages (`/inbox`), `gf` = Friday (`/friday`), `gg` = Insights (`/insights`) to the `JUMP` map — filling the gap for the most-tapped non-compose pages. `/inbox`, `/friday`, `/insights` are currently **not** in `JUMP`.

**Files touched:** `src/components/AppNav.tsx` (JUMP map, cheat sheet section), `src/components/CommandPalette.tsx` (recent + shortcuts sections).

---

## 3. Notifications panel — richer controls

### What exists today
`Notifications.tsx`:
- Bell icon with unread count badge.
- `ResponsiveDialog` with a notice list (drafts + alerts).
- Footer: **Refresh** + **Close** only.
- Clicking a notice navigates to `/approve` or `/health`.

### Upgrades
1. **Mark Read** (per-item) — a small ✓ button on each draft/alert row that calls a mutation to mark it read (through an RPC: `notifications.mark_read(notice_key)` — needs backend RPC, but UI-only flag is fine as a local-only "dismiss" if the RPC isn't ready). 
   - **Decision needed:** backend RPC vs. local dismiss-only. Default to local dismiss (removes from the list this session), note that a `notifications` table + RPC would make it persistent. I'll wire the UI for the RPC signature so it's ready when backend lands.
2. **Mark All Read** — a header button that clears all notices from the current session's view.
3. **Clear / Dismiss all** — a "Clear list" button in the empty-state and footer that removes everything currently shown (local), so a noisy morning doesn't leave a tower of toasts.
4. **Unread filter chip** — a toggle "Unread only" above the list (default on) so the panel shows only un-dismissed items; switch to "All" to see history.
5. **Empty state copy** — when cleared or all-read: "No recent notifications" with a `Refresh` affordance. Use the existing `EmptyState` component.
6. **Toast actions** — the existing draft toast on `_shell.tsx` has a "View" action already; keep it. Add a "Mark read" action to the toast itself so a stray toast can be silenced inline.

**Files touched:** `src/components/Notifications.tsx` (controls, filter, empty state), `src/lib/notifications.ts` (the `recentNotices` source + `markRead` local state helper).

---

## 4. Visual uniformity — audit + tokens

### Issues found across `AppNav.tsx` / `Notifications.tsx` / `_shell.tsx`
- Mixed button heights: top bar uses `min-h-11`, notifications use `h-auto min-h-11`, bottom nav uses `min-h-11` — mostly fine but `StatusPill` and `LiveInfo` are inconsistent.
- Motion: page-enter is 200–320ms (`page-enter` class in `_shell.tsx`), but there's no centralized token file. Add a `src/styles/motion.css` with `--motion-enter`, `--motion-exit`, `--motion-fast` so every transition uses the same durations and respects `prefers-reduced-motion`.
- Color: focus ring uses `ring-ring` (shadcn default) — verify that resolves to EzyMap green on dark, not the shadcn blue. If it's blue, override in the theme to `#19C37D`.
- Card padding: `SkeletonCards` and page surfaces use `px-3 py-4` / `px-4` inconsistently. Standardize to `p-4` for cards and `px-3 py-2` for list rows (mobile-first).
- Font: `Inter` confirmed in LOVABLE-KNOWLEDGE. Ensure `font-mono` for numbers uses `JetBrains Mono` (Wave 2 spec calls for both). Check `tailwind.config.ts` — if JetBrains Mono isn't loaded, add it.

**Files touched:** `src/styles/motion.css` (new), `src/app/globals.css` or `tailwind.config.ts` (font/focus-ring overrides), minor `px/py` normalization across components.

---

## Order of work (after approval)

This is frontend-only work in the Lovable cloud project (id `8aa151d6-...`). The repo side mirrors it.

1. **Prompt A** — Sidebar polish + motion tokens (`AppNav.tsx`, new `motion.css`, global style overrides).
2. **Prompt B** — CommandPalette shortcuts + recent pages (`CommandPalette.tsx`, JUMP map additions).
3. **Prompt C** — Notifications controls + empty state (`Notifications.tsx`, local dismiss helper).
4. **Prompt D** — Visual audit pass (button heights, focus rings, card padding) across all touched files.
5. **Mirror sync** — after each Lovable change is green, fast-forward tree-import push to the `twin-approval-hub-715dc526` mirror per `memory/dashboard-repo-lovable-relink.md`, then deploy.

## Decisions I'm making for you (flag any you want to change)

- **Notifications "Mark Read":** local-dismiss first (removes from session view), wired to an RPC signature `notifications.mark_read(key)` so it's ready when backend lands. This keeps the UI unblocked.
- **Jump keys added:** `gm` (Messages), `gf` (Friday), `gg` (Insights). I'm not adding `g n` for compose since `n` already exists — the cheat sheet will show both.
- **Bottom nav stays at 4** (Today/Inbox/Calendar/Signals). Health lives in More. No 5th icon.
- **Motion:** CSS-only, 200–320ms, `prefers-reduced-motion: reduce` respected (Wave 2 rule).
- **Focus ring color:** I'll override `ring-ring` to EzyMap green `#19C37D` in the theme so all shadcn components pick it up.

Say the word and I'll start with **Prompt A** (sidebar + motion tokens), or tell me which order/decisions to change.

---

## Outcome (2026-10-23)

Built in the repo Lovable watches, `printezy247/twin-approval-hub-715dc526`, as four pull requests, each merged on green CI and published to https://twin-approval-hub.lovable.app.

| Phase | PR | What shipped |
| :-- | :-- | :-- |
| A. Sidebar polish | #5 | Phone menu sheet and More drawer close on any route change; sidebar rows 44 px on phones; green active state; toast when the sidebar toggles. |
| B. Palette | #6 | The shortcut (`g` + letter, `n`) shows beside each page in the command palette. |
| C. Notifications | #7 | Mark read per item, Mark all read, Clear list, Unread/All filter, Mark read on the new-draft and alert toasts. |
| D. Visual uniformity | #8 | Shared Button 44 px on phones; hand-sized `.btn` overrides removed. |

### Already in the app, so not rebuilt
Sidebar collapse saved per device and `Ctrl+\\`; `g`-key hints in collapsed tooltips; green focus ring; motion tokens (`--tr-fast`, `--tr`, `--tr-smooth`) with reduced-motion handling; JetBrains Mono beside Inter; the Recent section and the full shortcuts dialog (`?`); jump keys `g m` (Messages), `g d` (Friday), `g p` (Insights).

### Changed from the plan
- **Jump keys `gm`, `gf`, `gg`:** not added. Messages, Friday and Insights already have keys, and `g f` is Feeds; the build fails on a duplicate key.
- **Mark read:** stored in the browser (localStorage), not through a `notifications.mark_read` RPC. No such RPC exists, and the dashboard writes only through Edge Functions and `set_setting`. A persistent version needs a backend table first.
- **`motion.css`, font change, card-padding rewrite:** skipped. Tokens and fonts already exist; a padding rewrite touches every page for no visible gain.

### Backend
No change needed. All migrations through `20261023000200` are applied on the live project, the seven `health_stale_*` settings are present and every Edge Function is deployed.

