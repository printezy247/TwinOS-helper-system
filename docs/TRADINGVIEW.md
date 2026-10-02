# TradingView → TwinOS

An EzyMap indicator alert becomes a `signals` row plus a **signal card** draft in
the Desk group, waiting for Jack's tap. Nothing reaches `@ezymap` without that
tap (rule: only Jack approves).

The webhook is `tv-webhook` (plan §9.D.22). TradingView can only post to ports
80/443 and cannot set headers, so the secret rides in the **query string** and is
compared constant-time (`_shared/auth.ts:requireSecret`). It is never logged.

## 1. Webhook URL

```
https://cdnyybrfoclexjlroqcf.supabase.co/functions/v1/tv-webhook?secret=<tv_secret>
```

Read the secret on Jack's PC (it never goes in a file):

```bash
secret-tool lookup service twinos key tv_secret
```

It is the same value as the function secret `TWINOS_TV_SECRET`
(`docs/SETUP.md` 0.7). Deployed with `--no-verify-jwt`; the query secret is the
auth.

## 2. Alert message, one per direction

TradingView's `{{...}}` placeholders are filled at alert time. Set up one alert
per direction (TradingView has no conditional `side`).

**Buy / long:**

```json
{"id":"{{ticker}}-{{timenow}}","symbol":"{{ticker}}","tf":"{{interval}}",
 "side":"buy","entry":{{close}},"sl":{{plot("SL")}},"tp1":{{plot("TP1")}},"tp2":{{plot("TP2")}},
 "setup":"{{strategy.order.comment}}","counter_trend":false}
```

**Sell / short:** the same, with `"side":"sell"`.

Notes:

- `id` must be **stable per alert occurrence** — it is the `external_id`, and a
  repeat of the same `id` is treated as a replay (no second card). Use
  `{{ticker}}-{{timenow}}`.
- `side` accepts `buy`/`long` and `sell`/`short`. Anything else leaves the
  direction empty, so the card renders `[NEEDED:direction]` and **cannot be
  approved** — always send a valid side.
- If the indicator exposes a counter-trend plot, send
  `"counter_trend":{{plot("CT")}}`. Otherwise write `counter_trend` in the note
  and the webhook still detects it (`/counter[- ]?trend/i` on `note`/`message`).
- `entry` also accepts `close` or `price`; `sl` accepts `stop`; `tf` accepts
  `interval`. A body that is not JSON is read as a plain note, which has no
  side, so the same `[NEEDED:direction]` block applies — always send JSON.
- Missing `entry`, `sl`, `tp1` or `tp2` do not fail the alert; they become
  `[NEEDED:…]` on the card, which blocks approval until Jack fixes the draft.

## 3. What the webhook does

1. Validates the alert (`_shared/signals.ts:validate`) — `external_id` is
   required, `direction` must be `buy` or `sell` when present, and any number
   must parse. It does **not** require entry/stop/timeframe; those become
   `[NEEDED:…]` on the card and block approval instead.
2. Upserts the `signals` row on `external_id` (`source = 'tradingview'`,
   `status = 'pending'`).
3. If a `signal_card` already exists for that signal, answers
   `200 { "replayed": true }` and stops.
4. Builds the card from the `signal_card` template and pushes it to the Desk
   group with the Approve / Edit / Reschedule / Reject buttons.
5. Answers `201 { ok, signal_id, content_id, desk, counter_trend }`.

The card always carries the locked lines (`brand_facts`): the risk line
("Risk 1% or less.") and the result footer. A counter-trend alert keeps the
warning line:

```
⚠️ COUNTER-TREND: against the daily bias. Half size or skip.
```

Direction emoji: 🟢 buy, 🔴 sell.

## 4. Testing it

`scripts/test-signal.sh` drives the live webhook with a `test-` alert
(`counter_trend=true`), asserts the `signals` row and the card's emoji,
COUNTER-TREND line, risk line and footer, then **rejects** it:

```bash
cd ~/TwinOS-helper-system && ./scripts/test-signal.sh
```

Expected: `PASS — alert test-… -> signal card #… shown in the Desk, rejected, nothing published.`
It never approves, so nothing can reach `@ezymap`. `--dry-run` prints the alert
and sends nothing.

The assertions live in `tests/test_signal_script.py` and run in CI.

## 5. Logs and troubleshooting

- **Alert delivered?** TradingView → the alert → *Log* shows the HTTP status it
  got. `201` is a new card; `200 {replayed:true}` is a duplicate `id`; `401` is a
  wrong secret; `400` is a rejected field.
- **Function side:** Supabase dashboard → Edge Functions → `tv-webhook` → Logs.
  The `signals` row's `raw` column keeps the whole alert JSON; a replayed alert
  writes `tv.alert_replay` to `action_log`, and a new card writes a
  `time_saved` row (`signals.card`).
- **No card in the Desk?** Check `settings.desk_group_chat_id` is set and the ops
  bot is a member of the Desk group. A card with no `desk_message_id` means the
  Telegram send failed; the `signals` row still exists.
- **Wrong numbers on the card?** The card uses the alert's numbers, and
  compliance refuses any number that was not in the alert (`allowed_numbers`).

## 6. Never

- Never send a demo or shadow signal: the publisher only posts `data_source =
  'live'` and `status <> 'shadow'`, and cards come from real alerts.
- Never approve a card without Jack's OK (rule 7).
