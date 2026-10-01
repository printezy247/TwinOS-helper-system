# Wiring TwinOS into ABDUL

Phase 0 ships two bridges and changes nothing in `/home/jack/abdul`:

* **Now (no edit to ABDUL):** `apps/mcp/twinos_mcp.py`, an MCP server and CLI. Claude Code and OpenCode agents get
  the tools; ABDUL's `claude:` verb and routines call the CLI.
* **Phase 2 (one small edit to ABDUL):** `apps/abdul/twinos_verbs.py`, native `twinos_*` verbs in the action block.

Line numbers below are from `bin/abdul` 1.0.0 (7795 lines) as read on 2026-10-01. Check them with the `grep` shown
before editing; the anchors are the text, not the number.

## 0. Keyring entries (both bridges, do first)

Secrets live in the login keyring, like ABDUL's own (`secret(name)` at line 1646 reads `service abdul`). TwinOS uses
its own service name so the two never mix:

```bash
secret-tool store --label='TwinOS url'    service twinos key url      # paste: https://<project>.supabase.co
~/TwinOS-helper-system/scripts/mint-keys.sh                          # stores apikey (public anon key) and abdul_key, prints neither
secret-tool lookup service twinos key url                              # check
```

`abdul_key` goes on `X-TwinOS-Key`, behind the anon key on `Authorization` (the platform gateway only admits
JWTs). The key carries the **abdul** role on the server (plan §9.B item 9). Never the service-role key, never Jack's own
login. Rotating it is one `secret-tool store` again; nothing on disk changes.

Env overrides for tests and one-offs: `TWINOS_URL`, `TWINOS_KEY`, `TWINOS_TIMEOUT` (seconds, default 20).

## 1. Register the MCP server next to `abdul mcp`

Claude Code (what `docs/assistant.md` lines 122–125 say for ABDUL, repeated for TwinOS):

```bash
claude mcp add abdul  -- /home/jack/abdul/bin/abdul mcp                                   # already there
claude mcp add twinos -- python3 /home/jack/TwinOS-helper-system/apps/mcp/twinos_mcp.py
claude mcp list
```

OpenCode: `~/.config/opencode/opencode.json`, the `mcp` object (lines 71–80 today hold `abdul`). Add a sibling:

```json
"mcp": {
  "abdul":  { "type": "local", "command": ["/home/jack/abdul/bin/abdul", "mcp"], "enabled": true },
  "twinos": { "type": "local", "command": ["python3", "/home/jack/TwinOS-helper-system/apps/mcp/twinos_mcp.py"], "enabled": true }
}
```

Smoke test without a backend: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 apps/mcp/twinos_mcp.py`
lists 14 tools and none of them approves anything.

## 2. Use it from ABDUL today, with no code change

ABDUL's `claude:` verb (`ACTION_SCHEMA` line 2092, `claude_task` line 2744) opens Claude Code or OpenCode with a task
file. Once the server is registered, a task like *"use the twinos tools: draft tomorrow's lessons and request
approval"* works as is. Routines (`~/ABDUL/routines.md`, `run_routine` line 2942) can call the CLI directly through
`open:`-style steps or a `claude:` step; the CLI shape is in `apps/mcp/README.md`.

## 3. Phase 2: the native verbs (one import, four small edits)

### 3a. Import the module, near the other imports (line 15 onward)

```python
# TwinOS desk verbs (apps/abdul/twinos_verbs.py); ABDUL runs without them if the folder is missing
try:
    sys.path.insert(0, os.path.expanduser("~/TwinOS-helper-system/apps/abdul"))
    import twinos_verbs
except Exception:   # noqa: BLE001
    twinos_verbs = None
```

### 3b. The schema (`ACTION_SCHEMA`, lines 2084–2121)

After the closing `]` on line 2121, before `PHONE_VERBS` (line 2122):

```python
if twinos_verbs:
    ACTION_SCHEMA += twinos_verbs.TWINOS_VERBS
```

`ACTIONS_HELP` (line 2130) builds the model's list from `ACTION_SCHEMA`, so the verbs appear in the prompt and in
`/api/schema` by themselves. The literal entries are in `ACTION_SCHEMA.additions.md` for review.

### 3c. Placeholders (`PLACEHOLDER_RE`, line 2214)

Append `|` + `twinos_verbs.TWINOS_PLACEHOLDERS` to the pattern string, so a block that still holds
`TEMPLATE | RAW LINES OR JSON` is dropped like `TASK TEXT` is. Simplest: build the regex after the import:

```python
if twinos_verbs:
    PLACEHOLDER_RE = re.compile(PLACEHOLDER_RE.pattern + "|" + twinos_verbs.TWINOS_PLACEHOLDERS)
```

### 3d. The verb regex and the dispatch in `apply_actions` (line 2219)

`grep -n 'automate|mail|draft|recap|practice|used|invite' bin/abdul` → line 2240. Add `twinos_[a-z]+` to that
alternation:

```python
            m = re.match(r"^\s*(add|done|move|remove|remember|note|forget|remind|alert|watch|unwatch|widget|put|research|browse|audio|doc|project|list|tell|"
                         r"automate|mail|draft|recap|practice|used|invite|twinos_[a-z]+)\s*:\s*(.+?)\s*$", line, re.I)
```

Then one branch in the `elif op == ...` chain, after `elif op == "remind":` (lines 2319–2322) and before
`except Exception as e:  # never let one bad line kill the reply` (line 2323):

```python
                elif op.startswith("twinos_"):
                    results.append(twinos_verbs.twinos_action(op, arg, conf) if twinos_verbs else "TwinOS verbs are not installed")
```

### 3e. Tell the model the desk rules (`P4_HELP`, line 2125)

`system_prompt` (line 2206) does `P4_HELP.replace("GUEST", ...).replace("USER", conf["user"])`. Append the TwinOS
paragraph there:

```python
    p4 = P4_HELP + (("\n" + twinos_verbs.TWINOS_HELP % (conf["user"], conf["user"], conf["user"])) if twinos_verbs else "")
    ... p4.replace("GUEST", ...)
```

### 3f. Check

```bash
python3 -c "import sys; sys.path.insert(0,'/home/jack/TwinOS-helper-system/apps/abdul'); import twinos_verbs; print(len(twinos_verbs.TWINOS_VERBS))"   # 7
python3 /home/jack/TwinOS-helper-system/apps/abdul/twinos_verbs.py "twinos_health: check"     # talks to the backend
abdul schema | grep twinos_                                                                     # the hub lists them
```

Then in chat: *"anything broken on the desk?"* → `twinos_health: check`. *"post the result for signal 3"* →
`twinos_result: 3`.

## 4. The guardrail: ABDUL never gets an approve path

Four layers, so a future edit cannot add one quietly:

1. **No tool, no verb.** Neither `TOOLS` in `twinos_mcp.py` nor `TWINOS_VERBS` has an approve entry. The test
   `test_tools_list_has_the_plan_names_and_no_approve` fails if one appears.
2. **The name is refused.** `tool_call()` answers any tool whose name contains "approv" (other than
   `twinos_request_approval`) with a 403-style error before building a request; `twinos_action()` answers *"I don't
   approve posts; that button is on Jack's phone."*
3. **The path is refused.** `request()` matches every path against `FORBIDDEN_PATH` (`/approve`, `/approvals/*/accept`,
   `/publish-now`) and raises before the network is touched. Tested with three paths.
4. **The server has the last word.** The `abdul` key cannot reach `POST /content/{id}/approve` (plan §11: jack only),
   and `content-schedule` returns 403 for anything with claims. The verbs read that 403 and say so in one line.

Do not add `approve` to `ACTION_SCHEMA`, do not give the `abdul` key a wider role, and do not store Jack's own key
in the `twinos` keyring service. If a routine ever needs an approval, it ends with `twinos_draft: ... | ask` and waits.

## 5. Tone

User-facing strings in `twinos_verbs.py` follow `persona()` (line 2061): short, direct, dry.
*"Nothing broken. Carry on."*, *"Wednesday batch is in the Desk group. Jack's turn."*, *"no result on the board for
signal 3 yet, so nothing was posted. The board decides, not us."* No emoji, no "Certainly".
