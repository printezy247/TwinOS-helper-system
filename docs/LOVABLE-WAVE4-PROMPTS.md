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
