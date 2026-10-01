#!/usr/bin/env python3
"""TwinOS verbs for ABDUL (plan §9.N item 106, Phase 2). A drop-in module; bin/abdul stays one file.

Wire-up (see PATCH-NOTES.md for the exact lines):

    sys.path.insert(0, "/home/jack/TwinOS-helper-system/apps/abdul"); import twinos_verbs
    ACTION_SCHEMA += twinos_verbs.TWINOS_VERBS
    # in apply_actions:  elif op.startswith("twinos_"): results.append(twinos_verbs.twinos_action(op, arg, conf))

Verbs (one line each in the ```abdul``` block, like every other ABDUL verb):

    twinos_draft: TEMPLATE | RAW LINES OR JSON [| ask]     draft a post; "ask" sends it to Jack's phone for approval
    twinos_draft: batch                                     the Wednesday batch into the Desk group
    twinos_schedule: CONTENT ID 📅 YYYY-MM-DD ⏰ HH:MM [on telegram, threads]
    twinos_result: SIGNAL ID                                result reply under the signal, wording from the board
    twinos_link: src-campaign-yymm | SOURCE | CAMPAIGN | PARTNER
    twinos_friday: latest | YYYY-MM-DD
    twinos_health: check
    twinos_csi: TOPIC | POPULARITY | up|flat|down | ICP

`twinos_call(conf, path, body)` has hub_call's shape and does the talking; the HTTP itself (retries,
Idempotency-Key, redaction, the no-approve guard) lives once, in apps/mcp/twinos_mcp.py, which this
module imports from its sibling folder. Keys come from the login keyring, service `twinos`
(`abdul_key` plus the public anon key `apikey`; scripts/mint-keys.sh stores both), never from a file.

Guardrail, in words ABDUL would use: ABDUL drafts, schedules the harmless, posts what the board already
decided, and asks. The Approve button is on Jack's phone. There is no verb for it here, and the HTTP layer
underneath refuses any approve path even if somebody writes one later.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MCP_DIR = os.path.join(os.path.dirname(HERE), "mcp")
if MCP_DIR not in sys.path:
    sys.path.insert(0, MCP_DIR)
import twinos_mcp as tm  # noqa: E402  (one HTTP implementation for both bridges)

# Every TwinOS verb ABDUL knows, in ACTION_SCHEMA's own format. The capitals are placeholders, as in bin/abdul.
TWINOS_VERBS = [
    {"verb": "twinos_draft", "arg": "TEMPLATE | RAW LINES OR JSON | ask", "what": "draft an EzyMap post (ask = to Jack's phone for approval; 'batch' alone = the Wednesday batch)", "on": ["hub"]},
    {"verb": "twinos_schedule", "arg": "CONTENT ID 📅 YYYY-MM-DD ⏰ HH:MM on PLATFORMS", "what": "schedule an approved, claim-free EzyMap post", "on": ["hub"]},
    {"verb": "twinos_result", "arg": "SIGNAL ID", "what": "post the result reply under a signal, numbers from the board", "on": ["hub"]},
    {"verb": "twinos_link", "arg": "src-campaign-yymm | SOURCE | CAMPAIGN | PARTNER", "what": "a named EzyMap invite link", "on": ["hub"]},
    {"verb": "twinos_friday", "arg": "latest | YYYY-MM-DD", "what": "the EzyMap Friday numbers", "on": ["hub"]},
    {"verb": "twinos_health", "arg": "check", "what": "anything broken in TwinOS, one line", "on": ["hub"]},
    {"verb": "twinos_csi", "arg": "TOPIC | POPULARITY | up|flat|down | ICP", "what": "log a TikTok Creator Search Insights topic", "on": ["hub"]},
]
TWINOS_VERB_NAMES = [v["verb"] for v in TWINOS_VERBS]

# Words from the arg templates above that must never be treated as real values (joins PLACEHOLDER_RE in bin/abdul).
TWINOS_PLACEHOLDERS = r"TEMPLATE \||RAW LINES OR JSON|CONTENT ID|SIGNAL ID|src-campaign-yymm \||TOPIC \| POPULARITY|on PLATFORMS"

# The paragraph that joins P4_HELP so the model knows when to use these verbs. %s is the user's name.
TWINOS_HELP = (
    "EzyMap desk (TwinOS): you are the desk operator. twinos_draft: makes a post from a template (gold_map, signal_card, lesson, "
    "start_safe, channel_audit, monday_poll, saturday_offer, outlook, scorecard) from %s's raw lines, e.g. twinos_draft: gold_map | 2410 held, "
    "buyers back above 2425, risk line on | ask. Add | ask to send it to his phone for approval; twinos_draft: batch runs the Wednesday batch. "
    "twinos_schedule: only for approved posts with no price, level, result or offer in them; the server refuses the rest. "
    "twinos_result: posts the result reply under a signal (\"post the result for signal 3\"); the wording and the numbers come from the board, "
    "never from you. twinos_link: makes a named invite link in the form src-campaign-yymm (\"make a link for the swap with MacroNews\" -> "
    "twinos_link: swap-macronews-2611 | swap | macronews | MacroNews). twinos_friday: the Friday numbers; twinos_health: anything broken; "
    "twinos_csi: logs a Creator Search Insights topic %s read off TikTok. You never approve a map, a signal, an offer, a member result or a "
    "price, and there is no verb for it: when %s says approve, tell him the button is on his phone."
)

# --------------------------------------------------------------------------- the call (hub_call's shape)


def twinos_call(conf, path, body=None):
    """ABDUL talking to TwinOS, in hub_call's shape: path like /functions/v1/content-draft or /rest/v1/v_friday_scoreboard?order=week.desc.
    body None = GET, else POST with an Idempotency-Key. twinos_url = in abdul.conf wins over the keyring; the key is always the keyring's."""
    url = str((conf or {}).get("twinos_url") or "").strip()
    if url and not os.environ.get("TWINOS_URL"):
        os.environ["TWINOS_URL"] = url
    p, _, q = path.partition("?")
    return tm.request("GET" if body is None else "POST", p, body, query=q or None)


def _tool(name, args):
    """One MCP tool through the shared layer; errors come back as a line, never a traceback."""
    try:
        return tm.tool_call(name, args), ""
    except (tm.TwinOSError, ValueError, RuntimeError) as e:
        return None, tm.redact(e)


# --------------------------------------------------------------------------- arg parsing (ABDUL's one-line style)

T_DUE = re.compile(r"📅\s*(\d{4}-\d{2}-\d{2})")
T_TIME = re.compile(r"⏰\s*(\d{1,2}:\d{2})")
T_AT = re.compile(r"\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?")
T_ON = re.compile(r"\bon\s+([a-z, ]+)$", re.I)


def _parts(arg):
    return [p.strip() for p in arg.split("|")]


def _json_or_text(s):
    s = s.strip()
    if s.startswith("{") or s.startswith("["):
        try:
            return json.loads(s)
        except ValueError:
            pass
    lines = [l.strip() for l in re.split(r"\n|;\s", s) if l.strip()]
    return {"lines": lines} if len(lines) > 1 else {"text": s}


def _num(s):
    try:
        return float(s.replace(",", "")) if s.strip() else None
    except ValueError:
        return None


# --------------------------------------------------------------------------- the handlers


def do_draft(arg, conf):
    if arg.strip().lower() in ("batch", "wednesday", "the batch"):
        res, err = _tool("twinos_batch", {})
        if err:
            return "batch failed: " + err
        n = len(res.get("items", res.get("drafts", []))) if isinstance(res, dict) else 0
        return "Wednesday batch is in the Desk group%s. Jack's turn." % ((": %d drafts" % n) if n else "")
    parts = _parts(arg)
    if not parts or not parts[0]:
        return "twinos_draft: which template?"
    template = re.sub(r"[^a-z0-9_]", "_", parts[0].lower()).strip("_")
    ask = bool(parts) and parts[-1].lower() in ("ask", "approve", "send", "to jack")
    if ask:
        parts = parts[:-1]
    raw = " | ".join(parts[1:]).strip()
    res, err = _tool("twinos_draft", {"template": template, "input": _json_or_text(raw) if raw else {}})
    if err:
        return "draft failed: " + err
    cid = str(res.get("id") or res.get("content_id") or "") if isinstance(res, dict) else ""
    needed = res.get("needed_fields") or res.get("needed") or [] if isinstance(res, dict) else []
    flags = res.get("claim_flags") or res.get("flags") or [] if isinstance(res, dict) else []
    out = "drafted %s%s" % (template, (" (%s)" % cid) if cid else "")
    if needed:
        out += "; still needs: " + ", ".join(map(str, needed))
    if flags:
        out += "; claims in it (%s), so Jack approves" % ", ".join(map(str, flags))
    if ask and cid:
        _, err2 = _tool("twinos_request_approval", {"content_id": cid})
        out += "; on Jack's phone now" if not err2 else "; could not send it to Jack: " + err2
    elif ask:
        out += "; no id came back, so nothing was sent to Jack"
    return out


def do_schedule(arg, conf):
    m_on = T_ON.search(arg)
    platforms = [p.strip().lower() for p in m_on.group(1).split(",") if p.strip()] if m_on else []
    body = T_ON.sub("", arg).strip()
    due = (T_DUE.search(body) or [None, None])[1]
    tm_ = (T_TIME.search(body) or [None, None])[1]
    if not due:
        m = T_AT.search(body)
        if m:
            due, tm_ = m.group(1), m.group(2) or tm_
    cid = T_DUE.sub("", T_TIME.sub("", T_AT.sub("", body))).replace(" at ", " ").strip().split(" ")[0].strip(":,")
    if not cid:
        return "twinos_schedule: which content id?"
    args = {"content_id": cid}
    if due:
        args["when"] = due + ("T%s:00" % tm_.zfill(5) if tm_ else "")
    if platforms:
        args["platforms"] = platforms
    res, err = _tool("twinos_schedule", args)
    if err:
        if "claim" in err.lower() or "403" in err:
            return "not scheduled: that one has a price, level, result or offer in it. Jack approves it on his phone first."
        return "schedule failed: " + err
    return "scheduled %s%s%s" % (cid, (" for %s %s" % (due, tm_ or "")).rstrip() if due else " in the next slot",
                                 (" on " + ", ".join(platforms)) if platforms else "")


def do_result(arg, conf):
    sid = re.sub(r"^(?:signal|sig|#)\s*", "", arg.strip(), flags=re.I).strip()
    if not sid:
        return "twinos_result: which signal?"
    res, err = _tool("twinos_result_reply", {"signal_id": sid})
    if err:
        if "not on the board" in err.lower() or "404" in err:
            return "no result on the board for signal %s yet, so nothing was posted. The board decides, not us." % sid
        return "result reply failed: " + err
    status = (res.get("status") or res.get("result") or "") if isinstance(res, dict) else ""
    return "result reply posted under signal %s%s" % (sid, (": " + str(status)) if status else "")


def do_link(arg, conf):
    parts = _parts(arg) + ["", "", "", ""]
    name, source, campaign, partner = parts[:4]
    if not name:
        return "twinos_link: name it src-campaign-yymm (e.g. swap-macronews-2611)"
    if not source:
        source = name.split("-")[0]
    args = {"name": name, "source": source}
    if campaign:
        args["campaign"] = campaign
    if partner:
        args["partner"] = partner
    cost = _num(parts[4]) if len(parts) > 4 else None
    if cost is not None:
        args["cost"] = cost
    res, err = _tool("twinos_link", args)
    if err:
        return "link failed: " + err
    url = (res.get("url") or res.get("invite_link") or res.get("link") or "") if isinstance(res, dict) else ""
    return "link %s made%s. Telechurn will see it under that name." % (args["name"].lower(), (": " + url) if url else "")


def do_friday(arg, conf):
    week = (T_AT.search(arg) or [None, None])[1]
    res, err = _tool("twinos_friday", {"week": week} if week else {})
    if err:
        return "Friday numbers failed: " + err
    if isinstance(res, dict) and set(res) == {"text"}:
        return res["text"]
    if not isinstance(res, dict):
        return "Friday numbers: " + json.dumps(res)[:600]
    wk = res.get("week") or res.get("week_start") or ""
    pairs = ["%s %s" % (k.replace("_", " "), v) for k, v in res.items()
             if k not in ("week", "week_start", "id", "created_at") and isinstance(v, (int, float, str)) and v not in ("", None)]
    return "Friday numbers%s: %s" % ((", week of %s" % wk) if wk else "", "; ".join(pairs[:16]) or "nothing counted yet")


def do_health(arg, conf):
    res, err = _tool("twinos_health", {})
    if err:
        return "couldn't ask TwinOS how it is: " + err
    return res.get("text", "no answer") if isinstance(res, dict) else str(res)


def do_csi(arg, conf):
    parts = _parts(arg) + ["", "", ""]
    topic, pop, trend, icp = parts[:4]
    if not topic:
        return "twinos_csi: which topic?"
    args = {"topic": topic}
    if _num(pop) is not None:
        args["popularity"] = _num(pop)
    if trend:
        args["trend"] = trend.lower()
    if icp:
        args["icp"] = icp
    res, err = _tool("twinos_csi_log", args)
    if err:
        return "CSI log failed: " + err
    return "logged CSI topic: %s" % topic


HANDLERS = {"twinos_draft": do_draft, "twinos_schedule": do_schedule, "twinos_result": do_result, "twinos_link": do_link,
            "twinos_friday": do_friday, "twinos_health": do_health, "twinos_csi": do_csi}


def twinos_action(op, arg, conf):
    """One action line from the ```abdul``` block -> one line of result. The entry point apply_actions calls."""
    op = op.lower().strip()
    if "approv" in op:
        return "I don't approve posts; that button is on Jack's phone."
    h = HANDLERS.get(op)
    if not h:
        return "no TwinOS verb called %s (%s)" % (op, ", ".join(TWINOS_VERB_NAMES))
    try:
        return h(arg or "", conf or {})
    except Exception as e:   # never let one bad line kill the reply (as apply_actions does)
        return "%s failed: %s" % (op, tm.redact(e))


def action_line(line, conf=None):
    """'twinos_friday: latest' -> result. Handy for a routine or a test."""
    m = re.match(r"^\s*(twinos_[a-z]+)\s*:\s*(.*?)\s*$", line, re.I | re.S)
    if not m:
        return "not a TwinOS line: " + line[:60]
    return twinos_action(m.group(1), m.group(2), conf)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "schema":
        print(json.dumps(TWINOS_VERBS, ensure_ascii=False, indent=1))
    elif len(sys.argv) > 1:
        print(action_line(" ".join(sys.argv[1:])))
    else:
        print(__doc__)
