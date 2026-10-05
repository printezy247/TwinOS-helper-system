# TwinOS MCP bridge

ABDUL's hands on the EzyMap desk (plan §9.N). One file, `twinos_mcp.py`, Python 3.12 standard library, nothing to
install. It speaks MCP over stdio to Claude Code and OpenCode (same shape as `abdul mcp`) and the same tools as a CLI.

**There is no approve tool.** ABDUL drafts, batches, schedules claim-free posts, posts board results, logs and asks.
Approval is Jack's thumb on the Telegram button or the dashboard. The file refuses any approve-looking tool name or
URL before it touches the network, and the backend refuses the `abdul` role at that endpoint anyway.

## Install

None. `python3 --version` should say 3.12 (this PC: 3.12.3).

## Keyring

```bash
secret-tool store --label='TwinOS url'    service twinos key url      # https://<project>.supabase.co
~/TwinOS-helper-system/scripts/mint-keys.sh                          # stores apikey (public anon key) and abdul_key, prints neither
```

`TWINOS_URL` / `TWINOS_KEY` / `TWINOS_ANON` in the environment override the keyring (tests, one-offs). Non-localhost URLs must be
`https://`.

## Register

```bash
claude mcp add twinos -- python3 /home/jack/TwinOS-helper-system/apps/mcp/twinos_mcp.py
```

OpenCode: add a `twinos` sibling to `mcp.abdul` in `~/.config/opencode/opencode.json`
(`"command": ["python3", "/home/jack/TwinOS-helper-system/apps/mcp/twinos_mcp.py"]`). Details and ABDUL's own
verbs for Phase 2: `../abdul/PATCH-NOTES.md`.

## Tools

| Tool | Does | Backend (plan §11) |
|---|---|---|
| `twinos_draft` | One post from a template; returns the draft, its `[NEEDED]` fields and claim flags | `POST /functions/v1/content/draft` |
| `twinos_batch` | The Wednesday batch (7 lessons, audit, poll, offer) into the Desk group (Phase 2) | `POST /functions/v1/content/batch` |
| `twinos_request_approval` | Push a draft to the Desk group with Approve/Edit/Reject for Jack | `POST /functions/v1/content/{id}/request-approval` |
| `twinos_schedule` | Publish jobs for an approved, claim-free item; 403 for anything with a price | `POST /functions/v1/content/{id}/schedule` |
| `twinos_result_reply` | Result reply under the signal; only the id crosses, wording from the board | `POST /functions/v1/results` |
| `twinos_link` | Named invite or bot link, `src-campaign-yymm` (Phase 2) | `POST /functions/v1/links` |
| `twinos_manual_metrics` | Vantage / TikTok / Telechurn weekly numbers | `POST /functions/v1/friday/manual` |
| `twinos_friday` | The Friday scoreboard | `GET /rest/v1/v_friday_scoreboard` |
| `twinos_health` | "Anything broken?" in one line | `GET /functions/v1/health` |
| `twinos_csi_log` | Log a Creator Search Insights topic (Phase 5) | `POST /functions/v1/research/csi` |
| `twinos_clip` | Queue a live for the PC worker: transcript, picks, captions, clips | `POST /functions/v1/jobs/enqueue` (`kind: clip`) |
| `twinos_brief` | Latest Monday research brief | `GET /rest/v1/briefs` |
| `twinos_inbox` | Open unified-inbox items with suggested replies | `GET /rest/v1/inbox_items` |
| `twinos_analytics` | One analytics view (`v_results_board`, `v_funnel`, `v_stop_if`, `v_content_log`...) | `GET /rest/v1/<view>` |

The function name is the directory under `supabase/functions/`; the route is the
path inside it. `docs/API.md` has the full request/response for each. Routes
marked Phase 2 or Phase 5 are not deployed yet and will answer 404 until they are.
The two `{id}` routes carry the content id **in the path**, so
`twinos_schedule` sends `POST /content/<id>/schedule {"run_at": ...}` and omits
`run_at` when Jack did not name a time (the item's own schedule applies).

Every write carries `Idempotency-Key` (uuid4, same key across retries). 5xx and 429 are retried three times with
backoff; 4xx are not. Timeout 20 s (`TWINOS_TIMEOUT`). Error text is scrubbed of anything token-shaped before a
model or a log sees it. Each request carries `X-TwinOS-Actor: abdul` for `action_log`.

## What Jack says, what runs

| Jack, to ABDUL | Tool | Call |
|---|---|---|
| "draft tomorrow's lessons" | `twinos_batch` | `{"for": "<next Monday>"}` or `{"only": ["lesson"]}` |
| "draft the gold map: 2410 held, buyers back above 2425" | `twinos_draft` | `{"template": "gold_map", "input": {"lines": [...]}}` then `twinos_request_approval` |
| "post the result for signal 3" | `twinos_result_reply` | `{"signal_id": "3"}` |
| "schedule the Monday poll for 9" | `twinos_schedule` | `{"content_id": "...", "when": "2026-10-06T09:00:00+08:00"}` |
| "Friday numbers" | `twinos_friday` | `{}` |
| "anything broken" | `twinos_health` | `{}` |
| "log CSI topic gold news today, 82, trending up, beginners" | `twinos_csi_log` | `{"topic": "gold news today", "popularity": 82, "trend": "up", "icp": "beginner"}` |
| "make a link for the swap with MacroNews" | `twinos_link` | `{"name": "swap-macronews-2611", "source": "swap", "campaign": "macronews", "partner": "MacroNews"}` |
| "clip yesterday's live" | `twinos_clip` | `{"source": "tiktok"}` (date defaults to yesterday on the server) |
| "Vantage this week: 3 FTDs, 12 active" | `twinos_manual_metrics` | `{"source": "vantage", "values": {"ftd": 3, "active": 12}}` |
| "what's the brief" | `twinos_brief` | `{}` |
| "anything in the inbox" | `twinos_inbox` | `{"limit": 10}` |
| "how did today's map do" | `twinos_analytics` | `{"view": "content_log", "filter": "post_type=eq.gold_map&order=posted_at.desc", "limit": 1}` |
| "approve it" | none | *"That button is on your phone."* |

## CLI (for `claude:` steps, routines, cron)

```bash
cd /home/jack/TwinOS-helper-system/apps/mcp
python3 twinos_mcp.py tools                                           # the list, as JSON
python3 twinos_mcp.py draft --template gold_map --input '{"lines": ["2410 held"]}'
python3 twinos_mcp.py batch --for 2026-10-05
python3 twinos_mcp.py result_reply --signal_id 3
python3 twinos_mcp.py link --name swap-macronews-2611 --source swap --campaign macronews
python3 twinos_mcp.py manual_metrics --source vantage --values '{"ftd": 3}'
python3 twinos_mcp.py friday
python3 twinos_mcp.py health
python3 twinos_mcp.py analytics --view v_stop_if --limit 5
python3 twinos_mcp.py                                                 # no args = MCP server on stdio
```

Tool names work with or without the `twinos_` prefix. `--input '{json}'` merges into the arguments (for `draft` it is
the `input` field). Exit code 1 and `failed: ...` on stdout when something went wrong.

## Tests

```bash
cd /home/jack/TwinOS-helper-system/apps/mcp && python3 -m unittest -v
```

Standard library only: a fake backend on 127.0.0.1 checks `tools/list`, each tool's request shape, retry on 500 and
429 (and not on 4xx), the `Idempotency-Key` on every write, the refusal of approve tools and paths, token redaction,
the CLI, and the ABDUL verb parsing in `../abdul/twinos_verbs.py`. No network, no keyring.
