#!/usr/bin/env python3
"""TwinOS bridge for ABDUL: an MCP server over stdio, and the same tools as a CLI.

Python 3.12 standard library only. Nothing to install. Same JSON-RPC shape as
ABDUL's own `abdul mcp` (bin/abdul, mcp_serve), so it sits next to it in Claude
Code and OpenCode:

    claude mcp add twinos -- python3 /home/jack/TwinOS-helper-system/apps/mcp/twinos_mcp.py

As a CLI (ABDUL's `claude:` verb and routines can call this without any change
to bin/abdul):

    python3 twinos_mcp.py draft --template gold_map --input '{"lines": ["..."]}'
    python3 twinos_mcp.py friday
    python3 twinos_mcp.py health
    python3 twinos_mcp.py tools            # the list, as JSON

Where the backend is: env TWINOS_URL, else the keyring
(`secret-tool lookup service twinos key url`). The key: env TWINOS_KEY, else
keyring key `abdul_key` (scripts/mint-keys.sh puts it there), sent as X-TwinOS-Key
behind the public anon key (env TWINOS_ANON, else keyring `apikey`), because the
platform gateway only lets JWTs through. That key carries the `abdul` role on the server; the
server, not this file, is the final judge of what ABDUL may do.

THERE IS NO APPROVE TOOL HERE, ON PURPOSE.
    Plan §4.9 and §9.N items 107-108: ABDUL drafts, checks, schedules non-claim
    posts, posts result replies that come straight from the board, logs, reads
    everything and asks for approval. It never approves a map, a signal, an
    offer, a member result or anything carrying a price. That button exists in
    exactly two places: the Approve button under Jack's thumb in the EzyMap
    Desk group on Telegram, and the TwinOS dashboard. Not here, not in a
    routine, not in a voice command. `twinos_request_approval` pushes a draft
    to Jack; what happens next is his. Belt and braces: this file refuses any
    tool name or URL path that looks like an approval, so a future edit cannot
    quietly add one (see FORBIDDEN_PATH and tool_call).

Writes carry an `Idempotency-Key` header (uuid4) so a retry after a timeout
cannot post twice. 5xx and 429 are retried with backoff. Anything that looks
like a token is scrubbed from error text before it reaches a model or a log.

Endpoints follow plan §11: reads are PostgREST at /rest/v1/..., writes are
Edge Functions at /functions/v1/<name>. The names live in one place
(ENDPOINTS) so they can be matched to the schema once it is written.
"""

import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = "0.1.0"
NAME = "twinos"
ACTOR = "abdul"

TIMEOUT = float(os.environ.get("TWINOS_TIMEOUT") or 20)
RETRIES = 3                    # attempts in total
BACKOFF = (0.5, 1.0, 2.0)      # seconds before attempt 2, 3, 4...
RETRY_ON = {429, 500, 502, 503, 504}

# Any path with one of these in it is refused before a request is built.
# "request-approval" is allowed on purpose: asking is fine, deciding is not.
FORBIDDEN_PATH = re.compile(r"/approve(?:/|$|\?)|/approvals?/[^/]+/(?:accept|grant|decide)|/publish-now", re.I)
FORBIDDEN_TOOL = re.compile(r"approv|publish_now|force", re.I)
ALLOWED_ASK = "twinos_request_approval"   # the one name with "approv" in it: it asks, it never decides

# --------------------------------------------------------------------------- endpoints (plan §11)
# kind: "fn" = POST /functions/v1/<path>  (writes, with Idempotency-Key)
#       "rest" = GET /rest/v1/<table or view>?<query>  (reads, PostgREST)
#
# These names are the ones actually deployed in supabase/functions/. The function
# name is the directory; the route is the path inside it (docs/API.md).
#   content → POST /content/draft
#   approve → POST /approve                (jack only; ABDUL is refused by role)
#   results → POST /results
#   friday  → POST /friday/manual
#   jobs    → POST /jobs/enqueue
# Phase-2+ routes (links, research, studio) are marked so the failure is a clear
# 404 rather than a confusing one.
ENDPOINTS = {
    "twinos_draft":            ("fn", "content/draft"),
    "twinos_batch":            ("fn", "content/batch"),              # phase 2
    # the two {id} routes carry the content id in the path, so only the
    # function base is stored and the route is built per call
    "twinos_request_approval": ("fn", "content"),
    "twinos_schedule":         ("fn", "content"),
    "twinos_result_reply":     ("fn", "results"),
    "twinos_link":             ("fn", "links"),                      # phase 2
    "twinos_manual_metrics":   ("fn", "friday/manual"),
    "twinos_csi_log":          ("fn", "research/csi"),               # phase 5
    "twinos_clip":             ("fn", "jobs/enqueue"),               # kind=clip
    "twinos_friday":           ("rest", "v_friday_scoreboard"),
    "twinos_health":           ("rest", "health_checks"),
    "twinos_brief":            ("rest", "briefs"),
    "twinos_inbox":            ("rest", "inbox_items"),
    "twinos_analytics":        ("rest", None),   # the view is a parameter, from ANALYTICS_VIEWS
}
# Views ANALYTICS_VIEWS may read, with the ones that are not views marked, so a
# bad name is refused locally instead of becoming a confusing PostgREST error.
ANALYTICS_VIEWS = ("v_results_board", "v_funnel", "v_quarter_targets", "v_stop_if", "v_friday_scoreboard",
                   "v_results_weekly", "v_content_log", "post_metrics", "channel_daily", "manual_metrics",
                   "benchmarks", "time_saved", "signals", "content_items", "publish_jobs", "alerts",
                   "v_hours_cut", "v_fanout_week",
                   "v_best_times", "v_post_engagement", "v_hook_performance", "v_signal_ledger")

# --------------------------------------------------------------------------- tools (plan §11 list + three reads)
# (name, description, {arg: type}, required args)
TOOLS = [
    ("twinos_draft", "Draft one post from a template (gold_map, signal_card, result_reply, lesson, start_safe, channel_audit, "
                     "monday_poll, saturday_offer, outlook, scorecard...). Returns the draft with its compliance flags and [NEEDED] fields. "
                     "Nothing is posted.",
     {"template": "string", "input": "object", "lang": "string", "platform": "string"}, ["template"]),
    ("twinos_batch", "Run the Wednesday batch: 7 lessons (5 skill + 2 Start Safe), Channel Audit, Monday poll, Saturday offer, numbered with "
                     "suggested times, into the Desk group for Jack. 'for' = ISO date of the Monday the batch is for (default: next week).",
     {"for": "string", "only": "array"}, []),
    ("twinos_request_approval", "Push a drafted content item to the EzyMap Desk group with Approve/Edit/Reject buttons. Only Jack can press them.",
     {"content_id": "string", "note": "string"}, ["content_id"]),
    ("twinos_schedule", "Create publish jobs for an approved, claim-free item (lessons, polls, reminders). Items with a price, level, result "
                        "or offer are refused by the server until Jack approves them. 'when' = ISO datetime, 'platforms' = e.g. [\"telegram\"].",
     {"content_id": "string", "when": "string", "platforms": "array"}, ["content_id"]),
    ("twinos_result_reply", "Post the result reply (TP1, TP2, BE, SL) under the original signal. Wording and numbers come from the board row; "
                            "ABDUL supplies only the signal id. A result that is not on the board is refused.",
     {"signal_id": "string"}, ["signal_id"]),
    ("twinos_link", "Make a named invite link or bot link: name follows src-campaign-yymm (e.g. swap-macronews-2611). "
                    "kind = invite | bot. partner and cost are optional.",
     {"name": "string", "source": "string", "campaign": "string", "kind": "string", "partner": "string", "cost": "number"}, ["name", "source"]),
    ("twinos_manual_metrics", "Record the weekly numbers that have no API: source = vantage | tiktok | telechurn, week = ISO Monday, "
                              "values = {metric: number}.",
     {"source": "string", "week": "string", "values": "object"}, ["source", "values"]),
    ("twinos_friday", "The Friday scoreboard: members, net joins, view rate, TikTok, bot starts, IB numbers, revenue, signals vs results, "
                      "strict win rate. Latest week unless 'week' (ISO Monday) is given.",
     {"week": "string"}, []),
    ("twinos_health", "Anything broken? Stale beats, failed jobs, expiring tokens, quota, open alerts. One short answer.",
     {}, []),
    ("twinos_csi_log", "Log a TikTok Creator Search Insights topic Jack read off the screen: topic, search popularity, trend, "
                       "content gap, and which ICP it fits.",
     {"topic": "string", "popularity": "number", "trend": "string", "gap": "boolean", "icp": "string", "note": "string"}, ["topic"]),
    ("twinos_clip", "Queue a live recording for the PC worker: transcript, highlight picks, caption file, clean clips, CapCut-ready. "
                    "source = tiktok | telegram, date = ISO date of the live (default yesterday, Kuala Lumpur), or path = the file itself. "
                    "layout = chart_full | chart_face | blurred_fill makes 1080x1920 clips; face_box = [x, y, width, height] of the camera "
                    "view for chart_face; end_text = the risk line for a 3 second end card.",
     {"source": "string", "date": "string", "max_clips": "integer", "layout": "string", "face_box": "array",
      "end_text": "string", "path": "string"}, []),
    ("twinos_brief", "The latest Monday research brief: next week's 7 TikTok topics scored by demand x ICP fit x low compliance risk.",
     {}, []),
    ("twinos_inbox", "Open items in the unified inbox (IG/FB/YouTube comments, Threads replies) with suggested replies. Jack sends; ABDUL reads.",
     {"limit": "integer"}, []),
    ("twinos_analytics", "Read one analytics view: " + ", ".join(ANALYTICS_VIEWS) + ". 'filter' is a PostgREST query string "
                         "(e.g. 'week=eq.2026-10-05'), 'limit' caps rows.",
     {"view": "string", "filter": "string", "limit": "integer"}, ["view"]),
]
TOOL_NAMES = [t[0] for t in TOOLS]


# --------------------------------------------------------------------------- config and secrecy

def secret(key):
    """A TwinOS value from the login keyring: secret-tool store --label='TwinOS KEY' service twinos key KEY. Empty when absent."""
    try:
        r = subprocess.run(["secret-tool", "lookup", "service", NAME, "key", key], capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def base_url():
    url = (os.environ.get("TWINOS_URL") or secret("url")).strip().rstrip("/")
    if not url:
        raise RuntimeError("no TwinOS URL: set TWINOS_URL or secret-tool store --label='TwinOS url' service twinos key url")
    host = urllib.parse.urlsplit(url).hostname or ""
    if not url.startswith("https://") and host not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("TwinOS URL must be https:// (plain http only for localhost tests)")
    return url


def api_key():
    key = (os.environ.get("TWINOS_KEY") or secret("abdul_key")).strip()
    if not key:
        raise RuntimeError("no TwinOS key: set TWINOS_KEY or run scripts/mint-keys.sh (keyring service twinos key abdul_key)")
    return key


def anon_key():
    """The project's public anon key (keyring `apikey`). The platform gateway only admits JWTs, so it rides on
    Authorization and the abdul key goes on X-TwinOS-Key. Empty when absent (local servers without a gateway)."""
    return (os.environ.get("TWINOS_ANON") or secret("apikey")).strip()


# Things that look like credentials: JWTs, bearer values, Supabase keys, long hex or base64 runs, key= query values.
_TOKENISH = [
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?"),          # JWT
    re.compile(r"(?i)\b(bearer|token|apikey|api[_-]?key|secret|password|authorization)\b[\s:=\"']+(?:bearer\s+)?[^\s\"',;&]{6,}"),
    re.compile(r"(?i)\b(?:sb[pa]?_|sk_|pk_|ghp_|xox[abp]-)[A-Za-z0-9_-]{10,}"),
    re.compile(r"\b[A-Fa-f0-9]{32,}\b"),
    re.compile(r"\b[A-Za-z0-9+/_-]{40,}={0,2}\b"),
]


def redact(text, extra=()):
    """Scrub anything that looks like a token from text (error messages, logs). The configured key is always scrubbed."""
    text = str(text)
    for v in extra:
        if v and len(v) >= 6:
            text = text.replace(v, "[redacted]")
    for rx in _TOKENISH:
        text = rx.sub(lambda m: (m.group(1) + ": [redacted]") if m.lastindex else "[redacted]", text)
    return text


# --------------------------------------------------------------------------- HTTP

class TwinOSError(Exception):
    """A clean, redacted error for the caller. .status is the HTTP status or 0."""
    def __init__(self, msg, status=0):
        super().__init__(msg)
        self.status = status


def request(method, path, body=None, query=None, idem=None, _opener=None):
    """One call to the TwinOS backend. Retries 5xx/429 and dropped connections with backoff. Returns parsed JSON (or text)."""
    if FORBIDDEN_PATH.search(path):
        raise TwinOSError("ABDUL has no approve path. That button is on Jack's phone.", 403)
    url, key = base_url(), api_key()
    gate = anon_key() or key
    full = url + path + (("?" + query) if query else "")
    headers = {"apikey": gate, "Authorization": "Bearer " + gate, "X-TwinOS-Key": key, "Accept": "application/json",
               "X-TwinOS-Actor": ACTOR, "User-Agent": "twinos-mcp/%s (abdul)" % VERSION}
    data = None
    if method != "GET":
        headers["Content-Type"] = "application/json"
        headers["Idempotency-Key"] = idem or str(uuid.uuid4())
        headers["Prefer"] = "return=representation"
        data = json.dumps(body if body is not None else {}).encode()
    opener = _opener or urllib.request.urlopen
    last = None
    for attempt in range(RETRIES):
        if attempt:
            time.sleep(BACKOFF[min(attempt - 1, len(BACKOFF) - 1)])
        req = urllib.request.Request(full, data=data, headers=headers, method=method)
        try:
            with opener(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8", "replace")
                try:
                    return json.loads(raw) if raw.strip() else {}
                except ValueError:
                    return {"text": raw[:4000]}
        except urllib.error.HTTPError as e:
            raw = ""
            try:
                raw = e.read().decode("utf-8", "replace")[:600]
            except Exception:
                pass
            last = TwinOSError("TwinOS said %d on %s %s: %s" % (e.code, method, path, redact(raw, (key,)) or e.reason), e.code)
            if e.code not in RETRY_ON:
                raise last
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = TwinOSError("could not reach TwinOS on %s %s: %s" % (method, path, redact(getattr(e, "reason", e), (key,))), 0)
    raise last or TwinOSError("gave up on %s %s" % (method, path))


def fn(name, body, idem=None):
    return request("POST", "/functions/v1/" + name, body, idem=idem)


def rest(table, query="", limit=None):
    """GET /rest/v1/<table>. The projection is ours: a tool's filter narrows
    rows, but a `select=` inside it must not replace the shape the tool is
    documented to return (or smuggle in other params) — it is stripped."""
    parts = [p for p in query.strip().lstrip("?&").split("&")
             if p and not p.startswith("select=")]
    q = "select=*" + (("&" + "&".join(parts)) if parts else "")
    if limit:
        q += "&limit=%d" % max(1, min(int(limit), 500))
    return request("GET", "/rest/v1/" + table, query=q)


# --------------------------------------------------------------------------- the tools

CLIP_LAYOUTS = ("chart_full", "chart_face", "blurred_fill")


def yesterday_kl(now=None):
    """Yesterday's date in Kuala Lumpur (UTC+8, no daylight saving): the live Jack means by default."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    kl = now.astimezone(datetime.timezone(datetime.timedelta(hours=8)))
    return (kl.date() - datetime.timedelta(days=1)).isoformat()


def _clean(a, keys):
    return {k: a[k] for k in keys if a.get(k) not in (None, "", [], {})}


def _rows(res):
    return res if isinstance(res, list) else ([res] if isinstance(res, dict) and res else [])


def tool_call(name, a, idem=None):
    """Run one tool; returns a JSON-able result. Raises TwinOSError or ValueError."""
    a = a or {}
    if (name != ALLOWED_ASK and FORBIDDEN_TOOL.search(name)) or name not in TOOL_NAMES:
        if "approv" in name.lower():
            raise TwinOSError("No approve tool here, and there never will be. twinos_request_approval sends it to Jack; he decides.", 403)
        raise ValueError("unknown tool " + name)
    spec = next(t for t in TOOLS if t[0] == name)
    missing = [k for k in spec[3] if a.get(k) in (None, "")]
    if missing:
        raise ValueError("%s needs: %s" % (name, ", ".join(missing)))
    kind, target = ENDPOINTS[name]

    if name == "twinos_draft":
        body = _clean(a, ("template", "input", "lang", "platform"))
        if isinstance(body.get("input"), str):
            try:
                body["input"] = json.loads(body["input"])
            except ValueError:
                body["input"] = {"text": body["input"]}
        return fn(target, dict(body, actor=ACTOR), idem)
    if name == "twinos_batch":
        return fn(target, dict(_clean(a, ("for", "only")), actor=ACTOR), idem)
    if name == "twinos_request_approval":
        # POST /content/{id}/request-approval — the id is in the path, not the body
        cid = urllib.parse.quote(str(a["content_id"]))
        return fn("%s/%s/request-approval" % (target, cid),
                  dict(_clean(a, ("note",)), actor=ACTOR), idem)
    if name == "twinos_schedule":
        # POST /content/{id}/schedule { run_at }. No "when" means publish on the
        # item's own schedule, which is what the function does with run_at absent
        # (the Desk flow is "OK, and it goes out").
        cid = urllib.parse.quote(str(a["content_id"]))
        body = {"actor": ACTOR}
        if a.get("when"):
            body["run_at"] = str(a["when"])
        return fn("%s/%s/schedule" % (target, cid), body, idem)
    if name == "twinos_result_reply":
        # only the id crosses: wording and numbers are the board's, never ABDUL's (plan item 24)
        return fn(target, {"signal_id": str(a["signal_id"]), "actor": ACTOR}, idem)
    if name == "twinos_link":
        body = _clean(a, ("name", "source", "campaign", "kind", "partner", "cost"))
        body["name"] = re.sub(r"[^a-z0-9-]", "-", str(body["name"]).strip().lower()).strip("-")
        if not re.match(r"^[a-z0-9]+-[a-z0-9-]+-\d{4}$", body["name"]):
            raise ValueError("link name must be src-campaign-yymm, e.g. swap-macronews-2611 (got %s)" % body["name"])
        body.setdefault("kind", "invite")
        return fn(target, dict(body, actor=ACTOR), idem)
    if name == "twinos_manual_metrics":
        if str(a["source"]).lower() not in ("vantage", "tiktok", "telechurn"):
            raise ValueError("source must be vantage, tiktok or telechurn")
        vals = a["values"]
        if isinstance(vals, str):
            vals = json.loads(vals)
        return fn(target, dict(_clean(a, ("week",)), source=str(a["source"]).lower(), values=vals, actor=ACTOR), idem)
    if name == "twinos_csi_log":
        return fn(target, dict(_clean(a, ("topic", "popularity", "trend", "gap", "icp", "note")), actor=ACTOR), idem)
    if name == "twinos_clip":
        # jobs/enqueue stores body.payload and ignores every other field, so the options go inside it.
        payload = _clean(a, ("source", "date", "max_clips", "layout", "face_box", "end_text", "path"))
        payload.setdefault("source", "tiktok")
        payload.setdefault("date", yesterday_kl())
        if payload.get("layout") and payload["layout"] not in CLIP_LAYOUTS:
            raise ValueError("layout must be one of " + ", ".join(CLIP_LAYOUTS))
        box = payload.get("face_box")
        if box is not None and not (isinstance(box, list) and len(box) == 4 and all(isinstance(v, int) and v >= 0 for v in box) and box[2] > 0 and box[3] > 0):
            raise ValueError("face_box must be [x, y, width, height]: four whole numbers, width and height above zero")
        if "end_text" in payload:
            payload["end_text"] = str(payload["end_text"])[:200]
        return fn(target, {"kind": "clip", "payload": payload, "actor": ACTOR}, idem)

    if name == "twinos_friday":
        q = ("week=eq.%s" % urllib.parse.quote(str(a["week"]), safe="")) if a.get("week") else "order=week.desc"
        rows = _rows(rest(target, q, 1))
        return rows[0] if rows else {"text": "No scoreboard yet. Friday hasn't happened, or nothing was counted."}
    if name == "twinos_health":
        checks = _rows(rest(target, "order=checked_at.desc", 50))
        alerts = _rows(rest("alerts", "resolved_at=is.null&order=created_at.desc", 20))
        broken = [c for c in checks if str(c.get("status", "")).lower() not in ("ok", "pass", "green", "")]
        if not broken and not alerts:
            text = "Nothing broken. Carry on."
        else:
            bits = ["%s: %s" % (c.get("name") or c.get("check") or "?", c.get("status") or c.get("detail") or "not ok") for c in broken[:6]]
            bits += [str(x.get("title") or x.get("text") or x.get("message") or "alert") for x in alerts[:6]]
            n = len(broken) + len(alerts)
            text = "%s want%s attention: %s" % ("One thing" if n == 1 else "%d things" % n, "s" if n == 1 else "", "; ".join(bits))
        return {"text": text, "broken": broken, "alerts": alerts}
    if name == "twinos_brief":
        rows = _rows(rest(target, "order=created_at.desc", 1))
        return rows[0] if rows else {"text": "No brief yet. Monday's research hasn't run."}
    if name == "twinos_inbox":
        return _rows(rest(target, "status=eq.open&order=created_at.desc", a.get("limit") or 20))
    if name == "twinos_analytics":
        view = str(a["view"]).strip()
        if view not in ANALYTICS_VIEWS:
            raise ValueError("view must be one of: " + ", ".join(ANALYTICS_VIEWS))
        return _rows(rest(view, str(a.get("filter") or ""), a.get("limit") or 50))
    raise ValueError("unknown tool " + name)


def tool_text(name, a):
    """The tool's answer as text for a model, errors included (never a traceback, never a token)."""
    try:
        res = tool_call(name, a)
    except (TwinOSError, ValueError, RuntimeError) as e:
        return "failed: " + redact(e), True
    if isinstance(res, dict) and "text" in res:
        rest_ = {k: v for k, v in res.items() if k != "text" and v not in (None, "", [], {})}
        return (str(res["text"]) + ("\n" + json.dumps(rest_, ensure_ascii=False, indent=1) if rest_ else ""))[:20000], False
    return json.dumps(res, ensure_ascii=False, indent=1)[:20000], False


# --------------------------------------------------------------------------- MCP over stdio (mirrors bin/abdul mcp_serve)

def mcp_tools():
    return [{"name": n, "description": d,
             "inputSchema": {"type": "object", "properties": {k: {"type": v} for k, v in props.items()}, "required": list(req)}}
            for n, d, props, req in TOOLS]


def mcp_serve(inp=None, out=None):
    """Model Context Protocol over stdio (JSON-RPC, one message per line)."""
    inp, out = inp or sys.stdin, out or sys.stdout

    def send(o):
        out.write(json.dumps(o) + "\n")
        out.flush()
    for raw in inp:
        try:
            req = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(req, dict):
            continue
        mid, method, p = req.get("id"), req.get("method", ""), req.get("params") or {}
        if mid is None:
            continue   # notifications (initialized, cancelled) need no answer
        if method == "initialize":
            res = {"protocolVersion": p.get("protocolVersion") or "2025-06-18", "capabilities": {"tools": {}},
                   "serverInfo": {"name": NAME, "version": VERSION}}
        elif method == "tools/list":
            res = {"tools": mcp_tools()}
        elif method == "tools/call":
            text, err = tool_text(p.get("name", ""), p.get("arguments") or {})
            res = {"content": [{"type": "text", "text": text}]}
            if err:
                res["isError"] = True
        elif method == "ping":
            res = {}
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "no method " + method}})
            continue
        send({"jsonrpc": "2.0", "id": mid, "result": res})


# --------------------------------------------------------------------------- CLI

def _coerce(v):
    """CLI values: JSON when it parses, else the string."""
    try:
        return json.loads(v)
    except ValueError:
        return v


def cli(argv):
    if not argv or argv[0] in ("serve", "mcp"):
        mcp_serve()
        return 0
    cmd = argv[0]
    if cmd in ("-h", "--help", "help"):
        print(__doc__.split("\n\n")[0])
        print("\ntools:\n" + "\n".join("  %-26s %s" % (n[7:], d.split(". ")[0]) for n, d, _, _ in TOOLS))
        print("\nusage: twinos_mcp.py TOOL [--key value]... [--input '{json}']   (TOOL with or without the twinos_ prefix)")
        return 0
    if cmd == "tools":
        print(json.dumps(mcp_tools(), indent=1))
        return 0
    name = cmd if cmd.startswith("twinos_") else "twinos_" + cmd.replace("-", "_")
    args, i = {}, 1
    while i < len(argv):
        tok = argv[i]
        if tok.startswith("--"):
            k = tok[2:].replace("-", "_")
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                args[k] = _coerce(argv[i + 1])
                i += 2
            else:
                args[k] = True
                i += 1
        else:
            args.setdefault("input", tok)
            i += 1
    if isinstance(args.get("input"), dict) and name != "twinos_draft":
        extra = args.pop("input")
        args = dict(extra, **args)
    text, err = tool_text(name, args)
    print(text)
    return 1 if err else 0


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
