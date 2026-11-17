# TwinOS Dashboard — UI/UX Master Plan (Phased)

**Date:** 2026-10-25
**Scope:** `mirror-hub/` — the TwinOS content-operations dashboard
**Tech stack:** TanStack Start + React 19 + Vite 8 + Tailwind CSS v4 (inline `@theme`) + shadcn/ui (new-york) + Radix UI + TanStack Query + Supabase realtime

---

## 0. Current-State Assessment

### What works well (keep, amplify)
| Strength | Where |
|---|---|
| Single coherent dark theme | `styles.css:64-100` — oklch green primary, amber accent, red destructive on navy |
| Keyboard-first shell | `AppNav.tsx` jump keys (`g`+letter), compose hotkeys (J/K/A/R/S), `Ctrl+K` palette |
| Realtime resilience | `_shell.tsx:81-202` — single channel, backoff resubscribe, 60 s poll fallback |
| A11y baked into CI | `a11y-gates.test.ts`, `wave8-gates.test.ts` — 44 px targets, focus rings, no `<main>` nesting |
| Cross-form-factor nav | Desktop sidebar + phone bottom bar + "More" drawer, no duplicate landmarks |
| URL-state filters | `url-state.ts` — tab/filters persist, shareable links |

### Where the polish is missing

1. **Hybrid styles fight each other.** shadcn/ui ships 40 components (`components/ui/`) but the app mostly uses hand-rolled `.btn`, `.field`, `.pill`, `.chip` classes. Native `<select>` and `<input type="datetime-local">` still ship raw — they break the dark theme's visual language.
2. **Compose is where Jack spends his time — and it's the densest, least consistent page.** Two button scales (`min-h-11` vs `h-7`), a custom mode toggle built from raw buttons, native dropdowns, and a "post-creation" section bolted on at the bottom.
3. **No formal design-token file.** Colors/primitives are scattered across `styles.css`, `gh.tsx`, `states.tsx`, `AppNav.tsx`. A `docs/design-tokens.md` doesn't exist.
4. **Metrics are inconsistent.** `StatTile.tsx` exists but is only used on Insights/Friday. Today uses hand-rolled inline boxes.
5. **Navigation works but the top bar has too many individual buttons** with no visual grouping on desktop.

### Trending patterns (Oct 2026 research, `awesome-shadcn-ui` + shadcn/ui + Tailwind v4 docs)
| Pattern | Trending source | TwinOS opportunity |
|---|---|---|
| **Auto-form from Zod schema** | `auto-form` (awesome-shadcn-ui) | Settings JSON editor → typed form fields |
| **Animated number transitions** | `number-flow` | StatTile / Friday metrics |
| **TanStack Table v8 with URL state** | `tnks-data-table` | Feeds, Ideas, Activity list views |
| **Multi-step wizards** | `next-stepper` | Compose → Send to Desk flow |
| **Glass/frosted surfaces** | shadboard, v0.dev | TopBar backdrop, modal overlays |
| **Focus-ring via CSS `@scope`** | Tailwind v4 | Replace the blanket `:where(...)` focus rule |

---

## 1. Master Plan — Phases

> Phases are **independent, sequential PRs** (matching the repo's git-ops flow). Each phase has a test gate from existing suites where possible. Phases 1–3 are pure CSS/component swaps with no behavior change.

---

### Phase 1 — Design Tokens & Visual Foundation  (S, 1–2 days)

**Goal:** One source of truth for colors, spacing, motion, so every component reads from the same tokens.

| # | Work | Target | Gate |
|---|---|---|---|
| 1.1 | Extract design tokens into `src/styles/tokens.css` — color palette, spacing scale, motion easings, border-radius, font stacks. Re-export as `@theme inline` vars. | `styles.css` | `a11y-gates` contrast checks still pass |
| 1.2 | Extend the oklch palette: add `--color-surface-1/2/3` (surface layering for depth), `--color-border-2` (stronger divider), `--color-input` darkening for inset shadows. | `tokens.css` | Visual diff only |
| 1.3 | Replace the blanket focus ring (`:where(a,button,...)`) with a scoped `@scope (&) { :focus-visible { … } }` using `--focus-ring` token — same visual, less CSS specificity wars. | `styles.css:216` | `wave8-gates` pointer-cursor test still passes |
| 1.4 | Add `backdrop-blur` surface class `.surface-glass` for modals/topbar — `bg-background/70 backdrop-blur`, gated by a `data-theme="glass"` attribute (off by default; enabled per-component). | `tokens.css` | No regression |
| 1.5 | Write `docs/design-tokens.md` — the canonical reference for colors, spacing, motion, surface layers. | `docs/` | New doc |

**Why this comes first:** Every later phase references `--color-*`, `--radius-*`, `--tr-*` tokens. Having them in one file means Phase 2's Select/Drawer upgrades and Phase 4's button system both pull from the same vars.

---

### Phase 2 — Form Controls & Input System  (S–M, 2–3 days)

**Goal:** Replace all native `<select>`, `<input type="datetime-local">`, and raw `<textarea>` with shadcn/ui-powered pickers so data entry feels uniform and theme-aware.

| # | Work | Target | Gate |
|---|---|---|---|
| 2.1 | Create a shared `FormField` component wrapping `Input` + `Label` + `Field set`/error + char counter. Replace `.field` usage in compose fields, settings JSON editor, search. | `components/ui/form-field.tsx` + `compose.tsx` | `compose` tests still pass |
| 2.2 | Replace 3 native `<select>` (post type, language, platform) in compose with `Select` from `@/components/ui/select`. Platform picker gets icon + color per platform. | `compose.tsx:582-622` | `variant-picking.test.tsx` (picker tests exist) |
| 2.3 | Replace `<input type="datetime-local">` (schedule time) with shadcn `Calendar` + `Popover` + time input — date picker on desktop, native date on mobile. | `compose.tsx:856` | New test: opens calendar on click |
| 2.4 | Create a reusable `ChipSelector` (toggle-group style) for mode toggle (Template/Freeform), density toggle, and tab filters — using shadcn `ToggleGroup` with `Variant.Outline`. | `components/ChipSelector.tsx` + `compose.tsx` mode toggle | Visual; existing tabs tests |
| 2.5 | Upgrade `.field` focus state: add smooth `border-color` transition + `--ring` glow, matching shadcn Input's feel. | `styles.css` `.field` | `a11y-gates` focus ring test |

**UX focus:** Jack fills in post details on Compose more than any other page. Consistent pickers + char counters + the mode toggle as a proper toggle group make the "fill details" flow feel controlled and predictable.

---

### Phase 3 — Button System & Action Consistency  (S–M, 2 days)

**Goal:** One button language across the app. Every action button uses the same size scale, same variant names, same spacing.

| # | Work | Target | Gate |
|---|---|---|---|
| 3.1 | Document the **TwinOS button variants**: `primary` (green, main action), `gold` (amber, secondary CTA like "Send to Desk"), `ghost` (tertiary), `destructive` (red, danger). Map to shadcn `Button` variants + custom `btn-primary`/`btn-gold`/`btn-ghost`/`btn-danger` CSS classes. | `docs/design-tokens.md` | — |
| 3.2 | Standardize all button heights: `min-h-11` (44 px) for all interactive controls. Replace the `h-7` buttons in compose's freeform footer (`compose.tsx:769,781`) — move AI Polish/Add Sig into the main action bar at `min-h-11`. | `compose.tsx` | `wave8-gates` no `min-h-9` rule |
| 3.3 | Create an `ActionButton` wrapper that bundles icon + label + loading state + disabled-online gating (`useOnline`). Replace 12 ad-hoc `btn btn-*` patterns in approve, compose, health. | `components/ActionButton.tsx` | — |
| 3.4 | Group top-bar buttons by intent: **primary** (New post), **actions** (Refresh, Command), **view** (AMOLED, Density), **account** (Notifications, Sign out). Add `gap-1` dividers or `ButtonGroup` container class. | `AppNav.tsx` `TopBar` | Visual; nav tests |
| 3.5 | Create an `icon-btn` style: `min-w-11 min-h-11` with `px-2` for icon-only buttons (copy link, copy body, AI polish). Ensure all have `aria-label`. | `tokens.css` / `ActionButton.tsx` | `a11y-gates` label audit |

**Why now:** Buttons are the most-tapped surface. Right now Jack sees `btn btn-ghost min-h-11 px-3 text-xs` in one place and `btn btn-ghost h-7 px-2 text-xs` in the next — the visual noise makes it harder to spot the primary action.

---

### Phase 4 — Navigation & Tab UX  (M, 2–3 days)

**Goal:** Make switching between tabs and related functions feel fluid and predictable.

| # | Work | Target | Gate |
|---|---|---|---|
| 4.1 | Upgrade `UnderlineTabs` with keyboard roving (already has arrow keys — add Home/End, Enter to activate) + active-state underline animation (smooth width transition). Extract to `components/Tabs.tsx` using shadcn `Tabs` primitive underneath. | `gh.tsx` `UnderlineTabs` | `underline-tabs.test.tsx` updated |
| 4.2 | Add persistent tab labels with counts in URL: `?tab=pending` already works; add smooth tab transitions (page-in animation per-tab, not just per-route). | `_shell/approve.tsx` | — |
| 4.3 | **Top bar consolidation:** Collapse desktop-only buttons (Refresh, Sign out) into a `...` (ellipsis) `DropdownMenu` when viewport is medium. Keep New Post + Search + AMOLED + Notifications as visible buttons. | `AppNav.tsx` `TopBar` | `a11y-gates` phone-top-bar test |
| 4.4 | Add a **breadcrumb dropdown** on the top bar: current page title as a dropdown that lists sibling pages within the same nav group. Reduces sidebar↔page context switching. | `AppNav.tsx` | New test |
| 4.5 | **Quick-switch tabs** on mobile: swipe-left/right between the tabs in Inbox (Pending/Draft/Blocked) as an enhancement of the existing J/K keys. | `approve.tsx` | — |

**UX focus:** "Easy to work between tabs or related functions." Today tabs work via URL state and UnderlineTabs. The upgrades make tab switching feel tactile (animation, swipe) and give Jack a faster path between related pages (breadcrumb dropdown, top-bar consolidation).

---

### Phase 5 — Metrics, Tables & Data Display  (M, 2–3 days)

**Goal:** Unified, scannable data surfaces. Replace ad-hoc layouts with consistent list/table patterns.

| # | Work | Target | Gate |
|---|---|---|---|
| 5.1 | Adopt `StatTile` everywhere metrics appear — today's "This week" + "All systems OK" → StatTile; Friday page; Insights; Health summary. Add `number-flow` equivalent (CSS counter animation) for delta values. | `StatTile.tsx` + `index.tsx` | — |
| 5.2 | Create a `DataTable` wrapper (TanStack Table v8) for Feeds, Ideas, Activity, Channels lists. Server-side sort + filter via URL state (like `tnks-data-table`). | `components/DataTable.tsx` | New test |
| 5.3 | Standardize the `Box` header: title + count badge + View-all link + optional filter icon. Right now `gh.tsx` Box has inconsistent count badge styling vs UnderlineTabs count badges. Unify to the `Badge` pattern from `AppNav.tsx:196`. | `gh.tsx` `Box` | — |
| 5.4 | Replace the inline `pill` status indicators with a `StatusDot` component — reusable, with color + label + optional glow. Used by Health beats, Approve card badges, BottomNav. | `components/StatusDot.tsx` | — |
| 5.5 | Empty states: add themed illustrations (SVG) for `EmptyState` (nothing waiting, no scheduled posts, no alerts). Reuse the SVGs in `docs/` as a starting point. | `states.tsx` `EmptyState` | — |

**Why:** Jack scans for "what needs attention." Right now the Today page mixes hand-rolled boxes, the Health page mixes banners and pills, and Friday uses StatTile. A unified metrics language means Jack sees a number → trend → detail pattern everywhere.

---

### Phase 6 — Polish & Micro-interactions  (S–M, 1–2 days)

**Goal:** Futuristic-but-not-flashy polish. Subtle animations that reward interaction without slowing down a content worker.

| # | Work | Target | Gate |
|---|---|---|---|
| 6.1 | **Surface layering:** `.panel` gets a subtle `shadow-sm` depth; interactive cards (`panel-interactive`) get a hover-lifted shadow + border glow (already partially done in `styles.css:188-205`). Clean up the gradient sweep on `.entry` — it's too slow on mobile. | `styles.css` | Visual |
| 6.2 | **Stagger children animations** on page-load and tab-switch: cards fade in one-after-another (240 ms total, 30 ms per card). Use `tw-animate-css` (already a dep) or inline `@keyframes`. | `styles.css` + `index.tsx` card maps | — |
| 6.3 | **Number transitions** on StatTile delta: when a count changes via realtime, animate the number count-up (300 ms). | `StatTile.tsx` | — |
| 6.4 | **AMOLED mode enhancement:** add a "True black" toggle to Settings (already partially built — complete it with a live preview). Dark mode → AMOLED = `#000` backgrounds. | `ShellExtras.tsx` `AmoledToggle` | — |
| 6.5 | **Reduced-motion compliance** check: ensure every new animation respects `prefers-reduced-motion` (the blanket rule at `styles.css:225` covers new ones automatically). | `styles.css:225` | — |

---

### Phase 7 — Command Palette & Keyboard UX  (M, 2–3 days)

**Goal:** Make the command palette the "do anything" hub — the fastest path to fill in details and jump between functions.

| # | Work | Target | Gate |
|---|---|---|---|
| 7.1 | Extend palette commands: `/approve` → jump to Inbox with focus on first card; `/compose` → open composer; `/calendar schedule` → jump to Calendar; `/signal` → search signals. Add to `CommandPalette.tsx`. | `CommandPalette.tsx` + `AppNav.tsx` JUMP | `command-palette.test.tsx` |
| 7.2 | Add **quick actions** to the command palette: type "approve all" / "send to desk" / "schedule" on a focused card from within the palette. | `CommandPalette.tsx` | New test |
| 7.3 | Expose density toggle + AMOLED toggle as palette commands — Jack changes view mode without leaving the keyboard. | `CommandPalette.tsx` | — |
| 7.4 | Add a **command shortcut cheat sheet** (`?` help dialog) — currently shortcuts are invisible. Show all jump keys, page hotkeys, and palette commands in one modal. | `CommandPalette.tsx` `ShortcutsDialog` | `shortcut.test` maybe |

---

### Phase 8 — Form & Workflow Refinement  (M–L, 3–4 days)

**Goal:** The "fill in details" flow — Compose especially — should feel guided, not overwhelming.

| # | Work | Target | Gate |
|---|---|---|---|
| 8.1 | **Step-by-step wizard** for Compose: (1) Platform + Post type + Language ( pickers), (2) Title + Body (editor), (3) Schedule / Send to Desk / Create draft (actions). Keep the current single-page layout but segment with visual step indicators. | `compose.tsx` | — |
| 8.2 | **Char-counter badges** on the body textarea: green (within 200 of limit), gold (200–0 remaining), red (over). Move from inline span to a persistent `Badge` in the textarea's bottom-right corner. | `compose.tsx` char state | — |
| 8.3 | **Template field auto-label** — instead of raw field names (`e.g. title`), show human labels from a `TEMPLATE_FIELDS` map. | `composer.ts` | — |
| 8.4 | **Auto-save indicator** — show a subtle "Saved" or "Unsaved changes" pill next to the draft title, replacing the current `role="status"` "Draft restored" text. Use the existing `DENSITY_BOOT_SCRIPT` pattern of status toasts. | `compose.tsx` autosave | — |
| 8.5 | **Schedule flow polish:** when Jack clicks "Schedule in Calendar", the modal pre-fills today's date + a "next weekday 9am" suggestion. | `compose.tsx` `runAt` | — |

---

### Phase 9 — Settings Form Transformation  (M, 2–3 days)

**Goal:** Settings currently uses a `textarea` for JSON editing. Replace with typed form controls.

| # | Work | Target | Gate |
|---|---|---|---|
| 9.1 | **Typed settings forms** for `needs_confirm` settings: text input for strings, toggle for booleans, number stepper for numeric values, select for enums (e.g. `openrouter_model`, `health_stale_threshold_hours`). Replace the JSON textarea. Use `auto-form` pattern from Zod schemas. | `settings.tsx` `ConfirmEditor` | — |
| 9.2 | **Grouped layout** with collapsible accordion sections (Times, TikTok, Platform limits, Language, Targets, Signatures). Use shadcn `Accordion`. | `settings.tsx` | — |
| 9.3 | **Inline validation** — show a green checkmark when a setting saves successfully, red error when it fails. Replace the current `role="alert"` error text with an inline icon + tooltip. | `settings.tsx` | — |

---

## Implementation Notes

- **TDD:** Each phase adds or updates tests in `src/test/` before the UI change. The existing `wave8-gates.test.ts` and `a11y-gates.test.ts` will be extended to lock in new invariants (button height, token references, form control labels).
- **No behavior change:** All phases are visual/UX refinements. No data layer changes (the `queries.ts` single-query-per-resource pattern stays untouched).
- **Progressive rollout:** Each phase is a standalone PR that merges green. Jack can use the dashboard normally at every checkpoint.
- **Front-End Checklist:** At the end of Phase 3, run the [Front-End Checklist](https://frontendchecklist.io) audit against the changes — the repo already codes gates from it in `a11y-gates.test.ts`.

---

## Priority / Effort Matrix

| Phase | Impact | Effort | Do first? |
|---|---|---|---|
| 1 — Tokens | High (unlocks all) | S | ✅ Yes |
| 2 — Form controls | High (Compose pain) | S–M | ✅ Yes |
| 3 — Buttons | High (daily touch) | S–M | ✅ Yes |
| 4 — Nav/tabs | High (context switching) | M | ✅ Yes |
| 5 — Tables/metrics | Medium | M | After 1–4 |
| 6 — Polish | Low (delight) | S–M | After 1–4 |
| 7 — Command palette | Medium (power users) | M | After 2–3 |
| 8 — Form workflow | High (Compose) | M–L | After 2 |
| 9 — Settings forms | Medium | M | Last |

---

## Quick Wins (no phase — do now)

| Win | Lines | Impact |
|---|---|---|
| Standardize button height: replace `h-7` with `min-h-11` in compose freeform footer | `compose.tsx:769,781` | Fixes touch-target inconsistency today |
| Add `aria-label` to the 4 icon-only buttons in compose (AI Polish, Add Sig, Copy, Link) if missing | `compose.tsx:870-915` | a11y |
| Collapse the 3 native `<select>` in compose into one `Select` with sections (Type / Language / Platform) — shadcn Select supports grouped options | `compose.tsx:582-622` | Cleaner form |
| Move AI Polish + Add Sig from freeform-mode `h-7` buttons up into the main action bar (next to "Generate with AI") | `compose.tsx:493-531` | Reduces context switching |
