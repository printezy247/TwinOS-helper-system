# ACTION_SCHEMA additions for TwinOS

Exact entries to append to `ACTION_SCHEMA` in `/home/jack/abdul/bin/abdul` (the list starts at line 2084, ends at the
`]` on line 2121, just before `PHONE_VERBS`). Same dict shape as every other verb: `verb`, `arg` (the capitals are
placeholders the model replaces), `what` (one phrase for the help text), `on` (`hub`: handled by `apply_actions`).

They are the `TWINOS_VERBS` list in `twinos_verbs.py`, so the preferred wiring is one line
(`ACTION_SCHEMA += twinos_verbs.TWINOS_VERBS`); the literal entries are here for a hand edit or a review.

```python
    {"verb": "twinos_draft", "arg": "TEMPLATE | RAW LINES OR JSON | ask", "what": "draft an EzyMap post (ask = to Jack's phone for approval; 'batch' alone = the Wednesday batch)", "on": ["hub"]},
    {"verb": "twinos_schedule", "arg": "CONTENT ID 📅 YYYY-MM-DD ⏰ HH:MM on PLATFORMS", "what": "schedule an approved, claim-free EzyMap post", "on": ["hub"]},
    {"verb": "twinos_result", "arg": "SIGNAL ID", "what": "post the result reply under a signal, numbers from the board", "on": ["hub"]},
    {"verb": "twinos_link", "arg": "src-campaign-yymm | SOURCE | CAMPAIGN | PARTNER", "what": "a named EzyMap invite link", "on": ["hub"]},
    {"verb": "twinos_friday", "arg": "latest | YYYY-MM-DD", "what": "the EzyMap Friday numbers", "on": ["hub"]},
    {"verb": "twinos_health", "arg": "check", "what": "anything broken in TwinOS, one line", "on": ["hub"]},
    {"verb": "twinos_csi", "arg": "TOPIC | POPULARITY | up|flat|down | ICP", "what": "log a TikTok Creator Search Insights topic", "on": ["hub"]},
```

## What each one does, and what it refuses

| Verb | Example line the model writes | Goes to | Refuses |
|---|---|---|---|
| `twinos_draft` | `twinos_draft: gold_map \| 2410 held, buyers back above 2425 \| ask` | `POST /functions/v1/content-draft`, then `content-request-approval` when `ask` | Nothing is posted; a draft with claims is flagged for Jack |
| `twinos_draft` | `twinos_draft: batch` | `POST /functions/v1/content-batch` | Only runs the batch into the Desk group |
| `twinos_schedule` | `twinos_schedule: c42 📅 2026-10-06 ⏰ 07:50 on telegram` | `POST /functions/v1/content-schedule` | The server returns 403 for any item with a price, level, result or offer; ABDUL says so and stops |
| `twinos_result` | `twinos_result: 3` | `POST /functions/v1/results-reply` with `{signal_id}` only | A result not on the board: nothing is posted. ABDUL never supplies numbers |
| `twinos_link` | `twinos_link: swap-macronews-2611 \| swap \| macronews \| MacroNews` | `POST /functions/v1/links` | A name not in `src-campaign-yymm` form |
| `twinos_friday` | `twinos_friday: latest` | `GET /rest/v1/v_friday_scoreboard` | Read only |
| `twinos_health` | `twinos_health: check` | `GET /rest/v1/health_checks` + open `alerts` | Read only |
| `twinos_csi` | `twinos_csi: gold news today \| 82 \| up \| beginner` | `POST /functions/v1/research-csi` | Nothing; it is a log line |

## Not added, on purpose

There is no `twinos_approve`. `twinos_action()` answers any op containing "approv" with
*"I don't approve posts; that button is on Jack's phone."* and the HTTP layer in `apps/mcp/twinos_mcp.py` refuses
any approve path with a 403 before a request is built. Plan §4.9 and items 107–108.

## Three more lines that go with these entries

1. `PLACEHOLDER_RE` (line 2214): add the alternatives in `twinos_verbs.TWINOS_PLACEHOLDERS` so a block that still holds
   `TEMPLATE | RAW LINES OR JSON` is ignored, as the other placeholders are.
2. The verb regex in `apply_actions` (lines 2239–2240): add `twinos_[a-z]+` to the alternation.
3. `P4_HELP` (line 2125): append `twinos_verbs.TWINOS_HELP % (user, user, user)` so the model knows the desk rules.
