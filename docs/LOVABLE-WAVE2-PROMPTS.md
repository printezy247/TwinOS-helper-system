# Wave 2 — dashboard prompts (Lovable, one per item)

Paste **one prompt at a time** into the Lovable project "TwinOS"
(`8aa151d6-f29b-4fba-8daf-345c4df50963`). After each one, report back the
changed files and wait for the next prompt — later prompts build on earlier
screens. Each prompt spends credits; stop and report if a prompt asks for a
column the schema does not have (never add tables — say which column is
missing instead).

Standing rules for every prompt (also in `docs/LOVABLE-KNOWLEDGE.md`):
frontend only; the anon key and the session JWT are the only credentials;
writes only through `supabase.functions.invoke`; approval stays Jack-only
with a confirm, never bulk, never on blocking findings; `[NEEDED:…]` always
visible; no framer-motion; `prefers-reduced-motion` respected; EzyMap green
`#19C37D` / gold `#E3B341` / red `#E5484D` on `#0B0F14`; Inter; Malay is `ms`;
times in `Asia/Kuala_Lumpur`; approvals must work at 390 px.

## 1. App shell + role

> Add a shared app-shell layout route that owns the auth guard. Read the
> role once after login from `session.user.app_metadata.twinos_role` into a
> `useRole()` hook (`jack` / `dashboard` / none). A login with no
> `twinos_role` sees a "no TwinOS role yet" screen instead of empty lists.
> Hide, don't just disable, Approve for anyone who is not `jack`. Keep every
> existing screen working under the shell.

## 2. Sidebar + bottom nav

> Build a grouped sidebar from the existing shadcn `sidebar.tsx` with lucide
> icons — Today: Inbox, Calendar · Channel: Signals, Messages · Insights:
> Friday, Research · System: Health, Settings. The Inbox entry carries a
> live pending count badge. Collapse with Ctrl+\. On phones show a bottom
> nav with the same five groups. If `sidebar.tsx` is missing, say so and
> stop instead of inventing one.

## 3. Loading and error states

> Every data screen gets three states: a skeleton while loading, a specific
> empty state ("Nothing pending — the Desk is clear" style, never a blank
> page), and an error card with the message plus a Retry button. An error
> must never read as "nothing pending".

## 4. Inbox power flow

> Rebuild the Approval Inbox list with inline Approve/Reject (optimistic
> removal, rollback with a toast on failure), a shadcn Dialog on desktop
> and Drawer on mobile for the Telegram-style preview with findings by
> severity, keyboard J/K to move, A approve, R reject, S reschedule, Esc
> close, and a `?` cheat sheet. Claim posts keep the confirm dialog and
> stay Jack-only; blocking findings still hide Approve.

## 5. Command palette

> Add a ⌘K command palette on the existing `command.tsx`: all pages, every
> pending inbox item by title, and a Refresh action. If `command.tsx` is
> missing, say so and stop instead of inventing one.

## 6. Motion and surface tokens

> Add motion and surface tokens recoloured green: card lift and sheen on
> hover, a 3px focus ring, a pressed state, and a 200–320 ms page fade.
> Everything honours `prefers-reduced-motion`. No framer-motion or other
> heavy animation libraries.

## 7. Realtime

> Replace the 60 s / 30 s polling with Supabase Realtime on the content
> and job tables: the sidebar pending badge updates live, a "new draft"
> toast appears, and a last-refresh dot shows the feed is alive. Keep a
> manual Refresh as fallback with the same specific toasts.

## 8. Health cards + Settings

> Rebuild Health as one integration card per source (ops bot, scheduler,
> signal feed, PC worker, Meta/YouTube tokens) with its beat age, a
> "Check now" action, and open alerts on top. Add a Settings /
> Integrations page that shows only "set / not set" per integration with
> setup steps — never a secret value, never reveal or copy.

## 9. Tiles, tabs, toasts, chips

> Add stat tiles to Friday and Signals, status tabs with counts on the
> Inbox, specific toasts ("Approved, posts 14:00 KL" style with the real
> slot time), and filter chips on Calendar (post type) and Research
> (pillar). Times shown in Asia/Kuala_Lumpur.

## After the wave

When all nine are confirmed working, update `docs/LOVABLE-KNOWLEDGE.md`
(screens list + realtime + shell) and set it as the Lovable project
knowledge again.
