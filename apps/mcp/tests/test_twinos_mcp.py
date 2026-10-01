"""Tests for the TwinOS MCP bridge. Standard library only: unittest + a fake backend on 127.0.0.1.

    cd apps/mcp && python3 -m unittest -v
"""

import io
import json
import os
import sys
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import twinos_mcp as tm  # noqa: E402

FAKE_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYWJkdWwifQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU"


class FakeTwinOS(BaseHTTPRequestHandler):
    """Records every request; answers from the plan: fail N times, then a canned body per path."""
    state = {"requests": [], "fail_first": 0, "status_once": None, "bodies": {}}

    def log_message(self, *a):   # quiet
        pass

    def _handle(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode() if n else ""
        rec = {"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()},
               "body": json.loads(body) if body else None}
        FakeTwinOS.state["requests"].append(rec)
        st = FakeTwinOS.state
        if st["fail_first"] > 0:
            st["fail_first"] -= 1
            self._send(500, {"error": "boom", "hint": "token " + FAKE_KEY})
            return
        if st["status_once"]:
            code, payload = st["status_once"]
            st["status_once"] = None
            self._send(code, payload)
            return
        base = self.path.split("?")[0]
        payload = st["bodies"].get(base, {"ok": True, "path": base})
        self._send(200, payload)

    def _send(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = do_PATCH = _handle


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeTwinOS)
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        os.environ["TWINOS_URL"] = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        os.environ["TWINOS_KEY"] = FAKE_KEY
        cls._backoff = tm.BACKOFF
        tm.BACKOFF = (0.01, 0.01, 0.01)

    @classmethod
    def tearDownClass(cls):
        tm.BACKOFF = cls._backoff
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        FakeTwinOS.state.update(requests=[], fail_first=0, status_once=None, bodies={})

    @property
    def reqs(self):
        return FakeTwinOS.state["requests"]

    def last(self):
        return self.reqs[-1]


class TestToolList(Base):
    def test_tools_list_has_the_plan_names_and_no_approve(self):
        names = [t["name"] for t in tm.mcp_tools()]
        for n in ("twinos_draft", "twinos_batch", "twinos_request_approval", "twinos_schedule", "twinos_result_reply", "twinos_link",
                  "twinos_manual_metrics", "twinos_friday", "twinos_health", "twinos_csi_log", "twinos_clip", "twinos_brief",
                  "twinos_inbox", "twinos_analytics"):
            self.assertIn(n, names)
        self.assertEqual(len(names), 14)
        for n in names:
            self.assertFalse(n == "twinos_approve" or (("approv" in n) and n != "twinos_request_approval"), n)
        for t in tm.mcp_tools():
            self.assertEqual(t["inputSchema"]["type"], "object")
            self.assertIn("properties", t["inputSchema"])

    def test_header_explains_why_no_approve(self):
        self.assertIn("NO APPROVE TOOL", tm.__doc__)

    def test_mcp_round_trip(self):
        inp = io.StringIO("\n".join(json.dumps(m) for m in [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "twinos_health", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "twinos_approve", "arguments": {"content_id": "c1"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "nope"},
            {"jsonrpc": "2.0", "id": 6, "method": "ping"},
        ]) + "\n")
        out = io.StringIO()
        FakeTwinOS.state["bodies"]["/rest/v1/health_checks"] = []
        FakeTwinOS.state["bodies"]["/rest/v1/alerts"] = []
        tm.mcp_serve(inp, out)
        msgs = [json.loads(l) for l in out.getvalue().strip().split("\n")]
        self.assertEqual([m["id"] for m in msgs], [1, 2, 3, 4, 5, 6])
        self.assertEqual(msgs[0]["result"]["serverInfo"]["name"], "twinos")
        self.assertEqual(len(msgs[1]["result"]["tools"]), 14)
        self.assertEqual(msgs[2]["result"]["content"][0]["text"], "Nothing broken. Carry on.")
        self.assertTrue(msgs[3]["result"].get("isError"))
        self.assertIn("Jack", msgs[3]["result"]["content"][0]["text"])
        self.assertEqual(msgs[4]["error"]["code"], -32601)
        self.assertEqual(msgs[5]["result"], {})


class TestRequestShapes(Base):
    def test_draft(self):
        tm.tool_call("twinos_draft", {"template": "gold_map", "input": {"lines": ["XAU 2410 support"]}, "lang": "en"})
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("POST", "/functions/v1/content-draft"))
        self.assertEqual(r["body"]["template"], "gold_map")
        self.assertEqual(r["body"]["input"]["lines"], ["XAU 2410 support"])
        self.assertEqual(r["body"]["actor"], "abdul")
        self.assertEqual(r["headers"]["content-type"], "application/json")
        self.assertEqual(r["headers"]["authorization"], "Bearer " + FAKE_KEY)
        self.assertEqual(r["headers"]["apikey"], FAKE_KEY)

    def test_draft_input_as_json_string_from_cli(self):
        tm.tool_call("twinos_draft", {"template": "lesson", "input": '{"topic": "spread"}'})
        self.assertEqual(self.last()["body"]["input"], {"topic": "spread"})

    def test_draft_needs_template(self):
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_draft", {})

    def test_batch(self):
        tm.tool_call("twinos_batch", {"for": "2026-10-05"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content-batch")
        self.assertEqual(r["body"], {"for": "2026-10-05", "actor": "abdul"})

    def test_request_approval(self):
        tm.tool_call("twinos_request_approval", {"content_id": "c42", "note": "map for Thursday"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content-request-approval")
        self.assertEqual(r["body"]["content_id"], "c42")

    def test_schedule(self):
        tm.tool_call("twinos_schedule", {"content_id": "c42", "when": "2026-10-06T07:50:00+08:00", "platforms": ["telegram"]})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content-schedule")
        self.assertEqual(r["body"]["platforms"], ["telegram"])

    def test_result_reply_sends_only_the_id(self):
        tm.tool_call("twinos_result_reply", {"signal_id": "3", "status": "TP1", "pips": 40})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/results-reply")
        self.assertEqual(r["body"], {"signal_id": "3", "actor": "abdul"})   # numbers never come from ABDUL

    def test_link_name_convention(self):
        tm.tool_call("twinos_link", {"name": "Swap MacroNews 2611", "source": "swap", "campaign": "macronews", "partner": "@macronews"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/links")
        self.assertEqual(r["body"]["name"], "swap-macronews-2611")
        self.assertEqual(r["body"]["kind"], "invite")
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_link", {"name": "macronews", "source": "swap"})

    def test_manual_metrics(self):
        tm.tool_call("twinos_manual_metrics", {"source": "Vantage", "week": "2026-10-05", "values": {"ftd": 3, "active": 12}})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/metrics-manual")
        self.assertEqual(r["body"]["source"], "vantage")
        self.assertEqual(r["body"]["values"]["ftd"], 3)
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_manual_metrics", {"source": "stripe", "values": {}})

    def test_csi_log(self):
        tm.tool_call("twinos_csi_log", {"topic": "gold news today", "popularity": 82, "trend": "up", "gap": True, "icp": "beginner"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/research-csi")
        self.assertEqual(r["body"]["topic"], "gold news today")
        self.assertIs(r["body"]["gap"], True)

    def test_clip(self):
        tm.tool_call("twinos_clip", {"date": "2026-09-30"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/studio-clip")
        self.assertEqual(r["body"]["source"], "tiktok")
        self.assertEqual(r["body"]["kind"], "clip")

    def test_friday_reads_the_view(self):
        FakeTwinOS.state["bodies"]["/rest/v1/v_friday_scoreboard"] = [{"week": "2026-09-28", "members": 1200}]
        res = tm.tool_call("twinos_friday", {})
        r = self.last()
        self.assertEqual(r["method"], "GET")
        self.assertTrue(r["path"].startswith("/rest/v1/v_friday_scoreboard?"))
        self.assertIn("select=*", r["path"])
        self.assertIn("order=week.desc", r["path"])
        self.assertIn("limit=1", r["path"])
        self.assertEqual(res["members"], 1200)
        self.assertNotIn("idempotency-key", r["headers"])
        tm.tool_call("twinos_friday", {"week": "2026-09-21"})
        self.assertIn("week=eq.2026-09-21", self.last()["path"])

    def test_health_summarises(self):
        FakeTwinOS.state["bodies"]["/rest/v1/health_checks"] = [{"name": "ezyai beat", "status": "ok"}, {"name": "scheduler", "status": "stale"}]
        FakeTwinOS.state["bodies"]["/rest/v1/alerts"] = [{"title": "YouTube token expires in 3 days"}]
        res = tm.tool_call("twinos_health", {})
        self.assertTrue(res["text"].startswith("2 things want attention"))
        self.assertIn("scheduler: stale", res["text"])
        self.assertIn("YouTube token", res["text"])
        self.assertIn("resolved_at=is.null", self.last()["path"])

    def test_brief_inbox_analytics(self):
        tm.tool_call("twinos_brief", {})
        self.assertTrue(self.last()["path"].startswith("/rest/v1/briefs?"))
        tm.tool_call("twinos_inbox", {"limit": 5})
        self.assertIn("status=eq.open", self.last()["path"])
        self.assertIn("limit=5", self.last()["path"])
        tm.tool_call("twinos_analytics", {"view": "v_stop_if", "filter": "week=eq.2026-10-05", "limit": 10})
        self.assertIn("/rest/v1/v_stop_if?", self.last()["path"])
        self.assertIn("week=eq.2026-10-05", self.last()["path"])
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_analytics", {"view": "approvals"})


class TestResilience(Base):
    def test_retry_on_500_then_succeeds(self):
        FakeTwinOS.state["fail_first"] = 2
        res = tm.tool_call("twinos_batch", {})
        self.assertEqual(res.get("ok"), True)
        self.assertEqual(len(self.reqs), 3)
        keys = {r["headers"]["idempotency-key"] for r in self.reqs}
        self.assertEqual(len(keys), 1, "the same Idempotency-Key must be reused across retries")

    def test_gives_up_after_three_500s(self):
        FakeTwinOS.state["fail_first"] = 5
        with self.assertRaises(tm.TwinOSError) as cm:
            tm.tool_call("twinos_batch", {})
        self.assertEqual(cm.exception.status, 500)
        self.assertEqual(len(self.reqs), 3)

    def test_retry_on_429(self):
        FakeTwinOS.state["status_once"] = (429, {"error": "slow down"})
        tm.tool_call("twinos_friday", {})
        self.assertEqual(len(self.reqs), 2)

    def test_no_retry_on_4xx(self):
        FakeTwinOS.state["status_once"] = (403, {"error": "abdul may not schedule a claim post"})
        with self.assertRaises(tm.TwinOSError) as cm:
            tm.tool_call("twinos_schedule", {"content_id": "c9"})
        self.assertEqual(cm.exception.status, 403)
        self.assertEqual(len(self.reqs), 1)
        self.assertIn("claim post", str(cm.exception))

    def test_idempotency_header_on_every_write(self):
        writes = [("twinos_draft", {"template": "lesson"}), ("twinos_batch", {}), ("twinos_request_approval", {"content_id": "c"}),
                  ("twinos_schedule", {"content_id": "c"}), ("twinos_result_reply", {"signal_id": "1"}),
                  ("twinos_link", {"name": "tt-live-2610", "source": "tt"}), ("twinos_manual_metrics", {"source": "tiktok", "values": {"f": 1}}),
                  ("twinos_csi_log", {"topic": "x"}), ("twinos_clip", {})]
        seen = set()
        for name, args in writes:
            tm.tool_call(name, args)
            r = self.last()
            self.assertEqual(r["method"], "POST", name)
            k = r["headers"].get("idempotency-key")
            self.assertTrue(k and len(k) == 36, "%s lacks an Idempotency-Key" % name)
            seen.add(k)
        self.assertEqual(len(seen), len(writes))

    def test_connection_refused_is_clean(self):
        old = os.environ["TWINOS_URL"]
        os.environ["TWINOS_URL"] = "http://127.0.0.1:1"
        try:
            with self.assertRaises(tm.TwinOSError) as cm:
                tm.tool_call("twinos_friday", {})
            self.assertEqual(cm.exception.status, 0)
            self.assertIn("could not reach TwinOS", str(cm.exception))
        finally:
            os.environ["TWINOS_URL"] = old

    def test_https_required_off_localhost(self):
        old = os.environ["TWINOS_URL"]
        os.environ["TWINOS_URL"] = "http://twinos.example.com"
        try:
            with self.assertRaises(RuntimeError):
                tm.base_url()
        finally:
            os.environ["TWINOS_URL"] = old


class TestGuardrails(Base):
    def test_no_approve_tool_via_call(self):
        for bad in ("twinos_approve", "approve", "twinos_approval", "twinos_publish_now"):
            with self.assertRaises((tm.TwinOSError, ValueError)):
                tm.tool_call(bad, {"content_id": "c1"})
        self.assertEqual(self.reqs, [], "an approve attempt must never reach the network")

    def test_no_approve_path_via_request(self):
        for path in ("/functions/v1/content/c1/approve", "/rest/v1/approvals/c1/accept", "/functions/v1/approve?id=1"):
            with self.assertRaises(tm.TwinOSError) as cm:
                tm.request("POST", path, {})
            self.assertEqual(cm.exception.status, 403)
        self.assertEqual(self.reqs, [])
        tm.request("POST", "/functions/v1/content-request-approval", {"content_id": "c1"})   # asking is fine
        self.assertEqual(len(self.reqs), 1)

    def test_endpoints_contain_no_approve(self):
        for kind, target in tm.ENDPOINTS.values():
            self.assertFalse(target and "approve" in target and target != "content-request-approval", target)


class TestRedaction(Base):
    def test_error_text_never_carries_the_key(self):
        FakeTwinOS.state["fail_first"] = 5
        text, err = tm.tool_text("twinos_batch", {})
        self.assertTrue(err)
        self.assertNotIn(FAKE_KEY, text)
        self.assertNotIn(FAKE_KEY[:30], text)
        self.assertIn("[redacted]", text)

    def test_redact_patterns(self):
        samples = {
            "Authorization: Bearer abcDEF123456789xyz": "abcDEF123456789xyz",
            "apikey=sb_secret_1234567890abcdef": "sb_secret_1234567890abcdef",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U": "eyJhbGciOiJIUzI1NiJ9",
            "hex 0123456789abcdef0123456789abcdef01234567": "0123456789abcdef0123456789abcdef",
            "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }
        for text, must_vanish in samples.items():
            out = tm.redact(text)
            self.assertNotIn(must_vanish, out, text)
            self.assertIn("[redacted]", out)
        self.assertEqual(tm.redact("TwinOS said 403 on POST /functions/v1/content-schedule: claim post"),
                         "TwinOS said 403 on POST /functions/v1/content-schedule: claim post")
        self.assertEqual(tm.redact("week=eq.2026-10-05 limit=50"), "week=eq.2026-10-05 limit=50")


class TestCLI(Base):
    def test_cli_draft_and_friday(self):
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = tm.cli(["draft", "--template", "gold_map", "--input", '{"lines": ["2410 holds"]}'])
        self.assertEqual(rc, 0)
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content-draft")
        self.assertEqual(r["body"]["input"], {"lines": ["2410 holds"]})
        FakeTwinOS.state["bodies"]["/rest/v1/v_friday_scoreboard"] = [{"week": "2026-09-28"}]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = tm.cli(["twinos_friday"])
        self.assertEqual(rc, 0)
        self.assertIn("2026-09-28", buf.getvalue())
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = tm.cli(["approve", "--content_id", "c1"])
        self.assertEqual(rc, 1)
        self.assertIn("failed:", buf.getvalue())
        self.assertEqual(len([r for r in self.reqs if "approve" in r["path"]]), 0)

    def test_cli_input_json_merges_for_non_draft_tools(self):
        import contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            rc = tm.cli(["link", "--input", '{"name": "ig-bio-2610", "source": "ig"}'])
        self.assertEqual(rc, 0)
        self.assertEqual(self.last()["body"]["name"], "ig-bio-2610")


if __name__ == "__main__":
    unittest.main()


# --------------------------------------------------------------------------- the ABDUL verb module (apps/abdul/twinos_verbs.py)

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "abdul"))
import twinos_verbs as tv  # noqa: E402


class TestAbdulVerbs(Base):
    def test_schema_entries_match_abdul_format_and_have_no_approve(self):
        self.assertEqual(len(tv.TWINOS_VERBS), 7)
        for v in tv.TWINOS_VERBS:
            self.assertEqual(set(v), {"verb", "arg", "what", "on"})
            self.assertEqual(v["on"], ["hub"])
            self.assertTrue(v["verb"].startswith("twinos_"))
            self.assertNotIn("approv", v["verb"])

    def test_draft_with_ask_requests_approval(self):
        FakeTwinOS.state["bodies"]["/functions/v1/content-draft"] = {"id": "c77", "needed_fields": ["risk_line"], "claim_flags": ["price"]}
        out = tv.twinos_action("twinos_draft", "gold_map | 2410 held, buyers back above 2425 | ask", {})
        self.assertIn("drafted gold_map (c77)", out)
        self.assertIn("risk_line", out)
        self.assertIn("Jack approves", out)
        self.assertIn("on Jack's phone now", out)
        paths = [r["path"] for r in self.reqs]
        self.assertEqual(paths, ["/functions/v1/content-draft", "/functions/v1/content-request-approval"])
        self.assertEqual(self.reqs[0]["body"]["input"], {"text": "2410 held, buyers back above 2425"})
        self.assertEqual(self.reqs[1]["body"]["content_id"], "c77")

    def test_draft_batch(self):
        out = tv.twinos_action("twinos_draft", "batch", {})
        self.assertEqual(self.last()["path"], "/functions/v1/content-batch")
        self.assertIn("Jack's turn", out)

    def test_schedule_parses_abdul_date_marks_and_claims_are_refused(self):
        out = tv.twinos_action("twinos_schedule", "c42 📅 2026-10-06 ⏰ 07:50 on telegram, threads", {})
        r = self.last()
        self.assertEqual(r["body"]["content_id"], "c42")
        self.assertEqual(r["body"]["when"], "2026-10-06T07:50:00")
        self.assertEqual(r["body"]["platforms"], ["telegram", "threads"])
        self.assertIn("scheduled c42 for 2026-10-06 07:50 on telegram, threads", out)
        FakeTwinOS.state["status_once"] = (403, {"error": "claim post needs approval"})
        out = tv.twinos_action("twinos_schedule", "c43 at 2026-10-07 09:00", {})
        self.assertIn("Jack approves it on his phone first", out)

    def test_result_sends_only_the_id(self):
        FakeTwinOS.state["bodies"]["/functions/v1/results-reply"] = {"ok": True, "status": "TP1"}
        out = tv.twinos_action("twinos_result", "signal 3", {})
        self.assertEqual(self.last()["body"], {"signal_id": "3", "actor": "abdul"})
        self.assertEqual(out, "result reply posted under signal 3: TP1")
        FakeTwinOS.state["status_once"] = (404, {"error": "no outcome on the board"})
        self.assertIn("The board decides", tv.twinos_action("twinos_result", "9", {}))

    def test_link_friday_health_csi(self):
        FakeTwinOS.state["bodies"]["/functions/v1/links"] = {"url": "https://t.me/+abc"}
        out = tv.twinos_action("twinos_link", "swap-macronews-2611 | swap | macronews | MacroNews", {})
        self.assertEqual(self.last()["body"]["partner"], "MacroNews")
        self.assertIn("link swap-macronews-2611 made: https://t.me/+abc", out)
        FakeTwinOS.state["bodies"]["/rest/v1/v_friday_scoreboard"] = [{"week": "2026-09-28", "members": 1200, "net_joins": 34, "id": 1}]
        out = tv.twinos_action("twinos_friday", "latest", {})
        self.assertEqual(out, "Friday numbers, week of 2026-09-28: members 1200; net joins 34")
        FakeTwinOS.state["bodies"]["/rest/v1/health_checks"] = []
        FakeTwinOS.state["bodies"]["/rest/v1/alerts"] = []
        self.assertEqual(tv.twinos_action("twinos_health", "check", {}), "Nothing broken. Carry on.")
        out = tv.twinos_action("twinos_csi", "gold news today | 82 | up | beginner", {})
        self.assertEqual(self.last()["body"]["popularity"], 82)
        self.assertEqual(out, "logged CSI topic: gold news today")

    def test_approve_verb_is_refused_without_a_request(self):
        out = tv.twinos_action("twinos_approve", "c1", {})
        self.assertIn("Jack's phone", out)
        self.assertEqual(self.reqs, [])

    def test_twinos_call_has_hub_call_shape(self):
        FakeTwinOS.state["bodies"]["/rest/v1/v_stop_if"] = [{"ok": 1}]
        res = tv.twinos_call({}, "/rest/v1/v_stop_if?select=*&limit=1")
        self.assertEqual(res, [{"ok": 1}])
        self.assertEqual(self.last()["method"], "GET")
        tv.twinos_call({}, "/functions/v1/content-batch", {"for": "2026-10-05"})
        self.assertEqual(self.last()["method"], "POST")
        self.assertIn("idempotency-key", self.last()["headers"])
        with self.assertRaises(tm.TwinOSError):
            tv.twinos_call({}, "/functions/v1/content/c1/approve", {})

    def test_action_line_and_errors_are_one_line(self):
        FakeTwinOS.state["fail_first"] = 5
        out = tv.action_line("twinos_health: check")
        self.assertTrue(out.startswith("couldn't ask TwinOS how it is:"))
        self.assertNotIn(FAKE_KEY, out)
        self.assertNotIn("\n", out)
