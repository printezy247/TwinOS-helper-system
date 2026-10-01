# @EzyOps_bot — the ops bot

ABDUL's hands in Telegram (plan §4.9, decision 17, open question 4). It is a
plain Bot API bot with **no code of its own**: every update goes to the
`tg-webhook` Edge Function, every send comes from `_shared/tg.ts`. This folder
holds the setup and the rules only.

Created as `@EzyOps_bot` (`@EzyOpsBot` was taken).

## What it does

| Where | Role | It does | It never does |
|---|---|---|---|
| **EzyMap channel** | Admin with *Post messages*, *Edit messages of others*, *Delete messages of others* only | Posts approved content, pins *Start here*, edits in place, replies results under signals, creates named invite links | Add admins, change channel info, manage video chats |
| **EzyMap Desk** (private group: Jack + bot) | Member | Turns Jack's map screenshot + raw lines into a draft within a minute; shows Approve / Edit / Reschedule / Reject; reminds at 07:40 and 19:55; asks for Friday numbers | Acts on anyone but Jack |
| **Discussion group** (linked to the channel, Phase 4) | Admin with *Delete*, *Restrict (ban) users*, *Invite users via link* | Pattern-rule moderation (`mod_rules`): scam keywords, links from new members, impersonation names; warn → mute → ban; join-request captcha | Feed group text to any AI (Telegram terms, plan §6) |

## BotFather steps (Jack, Phase 0)

1. `@BotFather` → `/newbot` → name `EzyMap Ops` → username `EzyOps_bot`.
   Copy the token **into the keyring only**:
   `secret-tool store --label "EzyOps bot token" service twinos key ops_bot_token`
2. `/setprivacy` → `EzyOps_bot` → **Disable** (the bot must read Desk group messages).
3. `/setjoingroups` → **Enable**.
4. `/setcommands` → paste:
   ```
   status - Anything broken?
   friday - Friday numbers so far
   help - What the Desk group understands
   ```
5. Add the bot to the channel as admin (rights above), to the Desk group as a
   plain member, and to the discussion group as admin (Phase 4).
6. Store the token as a function secret so the functions can use it (the only
   other place it exists): `supabase secrets set TWINOS_OPS_BOT_TOKEN="$(secret-tool lookup service twinos key ops_bot_token)"`

## Webhook

URL: `https://<project-ref>.supabase.co/functions/v1/tg-webhook`

Secret: derived, not stored. Both sides compute
`sha256("twinos-ops-webhook:" + bot_token)[:48]` (`_shared/tg.ts:deriveWebhookSecret`,
same pattern as printezy's `deriveWebhookSecret`). Telegram sends it as
`X-Telegram-Bot-Api-Secret-Token`; the function compares constant-time.

Set it once (run on Jack's PC; the token never leaves the shell):

```bash
TOKEN="$(secret-tool lookup service twinos key ops_bot_token)"
SECRET="$(printf 'twinos-ops-webhook:%s' "$TOKEN" | sha256sum | cut -c1-48)"
REF="<project-ref>"
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"https://$REF.supabase.co/functions/v1/tg-webhook\",
       \"secret_token\":\"$SECRET\",
       \"allowed_updates\":[\"message\",\"edited_message\",\"callback_query\",
                            \"chat_member\",\"my_chat_member\",\"chat_join_request\",
                            \"message_reaction_count\",\"channel_post\",\"poll\"]}"
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
unset TOKEN SECRET
```

`allowed_updates` must list `chat_member`, `message_reaction_count` and
`chat_join_request` explicitly: Telegram does not deliver them by default.
`message_reaction_count` only arrives in channels/groups where the bot is admin.

Deploy the function with `--no-verify-jwt` (Telegram sends no Supabase JWT; the
derived secret is the auth): `supabase functions deploy tg-webhook --no-verify-jwt`.
Same for `tv-webhook`.

## The Desk group flow (plan §4.4, §9.C)

```
07:40  bot: "No map yet" reminder (cron → content function) if nothing arrived
07:45  Jack: photo of the chart + 3–5 raw lines         (optionally ending in "BM")
07:50  bot: draft (template 1) + checklist summary + buttons
07:58  Jack: taps ✅, or replies to the draft with new text / "soften" / "shorter" / "BM"
08:00  publisher posts the approved map to the channel

London/NY  TradingView alert → "Signal card #N" draft with buttons (COUNTER-TREND line kept)
On hit     result reply under the original signal: automatic, no buttons (board-sourced)
19:55      bot: evening line reminder
20:00      Jack: "wrap: held 4590, closed above" → evening_wrap draft → ✅
Wed 14:30  batch of 7 lessons + audit + poll + offer, numbered (Phase 2); "3: soften" edits #3
Fri 09:00  "Friday numbers" request: Vantage and TikTok, two-minute reply
```

### Button layout

```
┌──────────────┬──────────────┐
│  ✅ Approve  │   ✏️ Edit    │
├──────────────┼──────────────┤
│ 🕒 Reschedule│  ❌ Reject   │
└──────────────┴──────────────┘
```

`callback_data` is `ok:<id8>` / `edit:<id8>` / `later:<id8>` / `no:<id8>` where
`id8` is the first 8 hex of the content id (plan §9.C.21, under 64 bytes). Only
Jack's Telegram id (`settings.jack_telegram_user_id`) is accepted; everyone else gets
"Only Jack can use these buttons". After a decision the keyboard is removed so a
second tap cannot happen (ASAP `decision.py` pattern).

- **Approve** → `approve` function (internal hop, re-checks Jack's id) → status
  `approved` → publish job at the item's slot (08:00 for maps, now for the rest).
- **Edit** → reply to the draft. Long text replaces the body (re-checked);
  a short instruction queues a `rewrite` job for ABDUL and the new draft comes back.
- **Reschedule** → reply `13:00` or `tomorrow 08:00` (MYT).
- **Reject** → status `rejected`, logged.

### What the bot refuses

- Drafts from anyone but Jack in the Desk group.
- Posts with blocking checklist findings (banned words, missing risk line,
  `[NEEDED]`, broker without disclosure, two CTAs) — the ✅ answers with the reason.
- Demo/shadow signals (never reach the channel).

## Rate limits to respect (Bot API)

~30 messages/s overall, 1 message/s to the same chat, 20 messages/min to a
group. `_shared/tg.ts` sleeps on `retry_after`; the publisher paces at 1.1 s.
