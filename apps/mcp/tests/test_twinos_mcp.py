"""Tests for the TwinOS MCP bridge. Standard library only: unittest + a fake backend on 127.0.0.1.

    cd apps/mcp && python3 -m unittest -v
"""

import io
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import twinos_mcp as tm  # noqa: E402

FAKE_ANON = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.YW5vbi1zaWduYXR1cmUtYW5vbi1zaWduYXR1cmU"
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
        os.environ["TWINOS_ANON"] = FAKE_ANON
        # The fakes have no /auth/v1/token; live reads use a real login.
        os.environ["TWINOS_LOGIN"] = "off"
        cls._backoff = tm.BACKOFF
        tm.BACKOFF = (0.01, 0.01, 0.01)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("TWINOS_LOGIN", None)
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
                  "twinos_inbox", "twinos_analytics", "twinos_research", "twinos_feeds",
                  "twinos_search", "twinos_ideas", "twinos_channels"):
            self.assertIn(n, names)
        self.assertEqual(len(names), 19)
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
        FakeTwinOS.state["bodies"]["/functions/v1/health"] = {"ok": True, "summary": "Nothing broken. Carry on."}
        tm.mcp_serve(inp, out)
        msgs = [json.loads(l) for l in out.getvalue().strip().split("\n")]
        self.assertEqual([m["id"] for m in msgs], [1, 2, 3, 4, 5, 6])
        self.assertEqual(msgs[0]["result"]["serverInfo"]["name"], "twinos")
        self.assertEqual(len(msgs[1]["result"]["tools"]), 19)
        self.assertEqual(msgs[2]["result"]["content"][0]["text"], "Nothing broken. Carry on.")
        self.assertTrue(msgs[3]["result"].get("isError"))
        self.assertIn("Jack", msgs[3]["result"]["content"][0]["text"])
        self.assertEqual(msgs[4]["error"]["code"], -32601)
        self.assertEqual(msgs[5]["result"], {})


class TestRequestShapes(Base):
    def test_draft(self):
        tm.tool_call("twinos_draft", {"template": "gold_map", "input": {"lines": ["XAU 2410 support"]}, "lang": "en"})
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("POST", "/functions/v1/content/draft"))
        self.assertEqual(r["body"]["template"], "gold_map")
        self.assertEqual(r["body"]["input"]["lines"], ["XAU 2410 support"])
        self.assertEqual(r["body"]["actor"], "abdul")
        self.assertEqual(r["headers"]["content-type"], "application/json")
        # The gateway only admits JWTs: the public anon key gets the call in, the abdul key says who it is.
        self.assertEqual(r["headers"]["authorization"], "Bearer " + FAKE_ANON)
        self.assertEqual(r["headers"]["apikey"], FAKE_ANON)
        self.assertEqual(r["headers"]["x-twinos-key"], FAKE_KEY)

    def test_draft_input_as_json_string_from_cli(self):
        tm.tool_call("twinos_draft", {"template": "lesson", "input": '{"topic": "spread"}'})
        self.assertEqual(self.last()["body"]["input"], {"topic": "spread"})

    def test_draft_needs_template(self):
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_draft", {})

    def test_batch(self):
        tm.tool_call("twinos_batch", {"for": "2026-10-05"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content/batch")
        self.assertEqual(r["body"], {"for": "2026-10-05", "actor": "abdul"})

    def test_request_approval(self):
        tm.tool_call("twinos_request_approval", {"content_id": "c42", "note": "map for Thursday"})
        r = self.last()
        # the id is in the path, as the deployed route expects
        self.assertEqual(r["path"], "/functions/v1/content/c42/request-approval")
        self.assertEqual(r["body"], {"note": "map for Thursday", "actor": "abdul"})

    def test_schedule(self):
        tm.tool_call("twinos_schedule", {"content_id": "c42", "when": "2026-10-06T07:50:00+08:00", "platforms": ["telegram"]})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content/c42/schedule")
        self.assertEqual(r["body"], {"run_at": "2026-10-06T07:50:00+08:00", "actor": "abdul"})
        self.assertNotIn("platforms", r["body"], "platforms is not part of the deployed contract")

    def test_result_reply_sends_only_the_id(self):
        tm.tool_call("twinos_result_reply", {"signal_id": "3", "status": "TP1", "pips": 40})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/results")
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
        self.assertEqual(r["path"], "/functions/v1/friday/manual")
        self.assertEqual(r["body"]["source"], "vantage")
        self.assertEqual(r["body"]["values"]["ftd"], 3)
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_manual_metrics", {"source": "stripe", "values": {}})

    def test_csi_log(self):
        tm.tool_call("twinos_csi_log", {"topic": "gold news today", "popularity": 82, "trend": "up", "gap": True, "icp": "beginner"})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/research/csi")
        self.assertEqual(r["body"]["topic"], "gold news today")
        self.assertIs(r["body"]["gap"], True)

    def test_clip(self):
        tm.tool_call("twinos_clip", {"date": "2026-09-30", "layout": "blurred_fill", "end_text": "Not financial advice.", "max_clips": 3})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/jobs/enqueue")
        self.assertEqual(r["body"]["kind"], "clip")
        # jobs/enqueue reads body.payload only: flat fields would be dropped and the worker would get nothing
        p = r["body"]["payload"]
        self.assertEqual((p["source"], p["date"], p["layout"], p["end_text"], p["max_clips"]),
                         ("tiktok", "2026-09-30", "blurred_fill", "Not financial advice.", 3))
        self.assertNotIn("source", r["body"])

    def test_clip_with_no_date_means_yesterday_in_kuala_lumpur(self):
        import datetime as dt
        self.assertEqual(tm.yesterday_kl(dt.datetime(2026, 10, 7, 18, 0, tzinfo=dt.timezone.utc)), "2026-10-07")  # 02:00 on the 8th in KL
        self.assertEqual(tm.yesterday_kl(dt.datetime(2026, 10, 7, 3, 0, tzinfo=dt.timezone.utc)), "2026-10-06")
        tm.tool_call("twinos_clip", {})
        self.assertRegex(self.last()["body"]["payload"]["date"], r"^\d{4}-\d{2}-\d{2}$")

    def test_clip_refuses_a_bad_layout_or_face_box(self):
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_clip", {"layout": "diagonal"})
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_clip", {"layout": "chart_face", "face_box": [1, 2, 3]})

    def test_clip_passes_a_face_box_and_a_file_path(self):
        tm.tool_call("twinos_clip", {"layout": "chart_face", "face_box": [1400, 600, 480, 360], "path": "/home/jack/EzyMap/lives/x.mp4"})
        p = self.last()["body"]["payload"]
        self.assertEqual(p["face_box"], [1400, 600, 480, 360])
        self.assertEqual(p["path"], "/home/jack/EzyMap/lives/x.mp4")

    def test_friday_reads_the_view(self):
        FakeTwinOS.state["bodies"]["/rest/v1/v_friday_scoreboard"] = [{"week": "2026-09-28", "members": 1200}]
        res = tm.tool_call("twinos_friday", {})
        r = self.last()
        self.assertEqual(r["method"], "GET")
        self.assertTrue(r["path"].startswith("/rest/v1/v_friday_scoreboard?"))
        self.assertIn("select=*", r["path"])
        self.assertIn("order=week_start.desc", r["path"])
        self.assertIn("limit=1", r["path"])
        self.assertEqual(res["members"], 1200)
        self.assertNotIn("idempotency-key", r["headers"])
        tm.tool_call("twinos_friday", {"week": "2026-09-21"})
        self.assertIn("week_start=eq.2026-09-21", self.last()["path"])

    def test_health_summarises(self):
        FakeTwinOS.state["bodies"]["/functions/v1/health"] = {
            "ok": False, "summary": "stale: scheduler; 2 open alert(s)", "failed_jobs": 3,
        }
        res = tm.tool_call("twinos_health", {})
        self.assertEqual((self.last()["method"], self.last()["path"]), ("GET", "/functions/v1/health"))
        self.assertTrue(res["text"].startswith("stale: scheduler"))
        self.assertIn("2 open alert(s)", res["text"])
        self.assertIn("3 failed job(s)", res["text"])

    def test_research_picks_the_route_from_the_arg(self):
        tm.tool_call("twinos_research", {"what": "feeds"})
        self.assertEqual(self.last()["path"], "/functions/v1/research/feeds")
        tm.tool_call("twinos_research", {})
        self.assertEqual(self.last()["path"], "/functions/v1/research/expand")
        # brief messages the Desk and is the cron's job, so it is not offered here.
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_research", {"what": "brief"})

    def test_feeds_names_each_item_by_its_feed(self):
        FakeTwinOS.state["bodies"]["/rest/v1/feeds"] = [{"id": "f1", "name": "Macro feed"}]
        FakeTwinOS.state["bodies"]["/rest/v1/feed_items"] = [
            {"feed_id": "f1", "title": "Fed holds", "published_at": "2026-10-05T08:00:00Z", "link": "https://example.com/fed"},
            {"feed_id": "f9", "title": "Unknown source", "published_at": None, "link": None},
        ]
        rows = tm.tool_call("twinos_feeds", {"since": "2026-10-05", "limit": 5})
        self.assertEqual([r["feed"] for r in rows], ["Macro feed", "?"])
        item = next(r for r in self.reqs if "/rest/v1/feed_items" in r["path"])
        self.assertIn("published_at=gte.2026-10-05", item["path"])
        self.assertIn("limit=5", item["path"])
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_feeds", {"since": "yesterday"})

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


class TestLoginToken(Base):
    """REST reads need an authenticated session: PostgREST never sees X-TwinOS-Key."""

    def tearDown(self):
        tm._SESSION.update(jwt=None, exp=0.0)
        for k in ("TWINOS_LOGIN_EMAIL", "TWINOS_LOGIN_PASSWORD"):
            os.environ.pop(k, None)
        # restore the suite default: popping it would let the machine's
        # keyring creds turn every later read into a real login attempt.
        os.environ["TWINOS_LOGIN"] = "off"

    def test_login_can_be_switched_off_and_then_costs_no_request(self):
        os.environ["TWINOS_LOGIN"] = "off"
        self.assertEqual(tm.login_creds(), (None, None))
        self.assertIsNone(tm.user_token())
        self.assertEqual(self.reqs, [])

    def test_a_read_carries_the_session_token_and_keeps_the_anon_apikey(self):
        tm._SESSION.update(jwt="TOK", exp=time.time() + 3600)
        tm.tool_call("twinos_brief", {})
        r = self.last()
        self.assertEqual(r["path"].split("?")[0], "/rest/v1/briefs")
        self.assertEqual(r["headers"]["authorization"], "Bearer TOK")
        # the gateway only admits JWTs, so the public key still rides on apikey
        self.assertEqual(r["headers"]["apikey"], FAKE_ANON)

    def test_a_configured_login_that_fails_says_so(self):
        # setUpClass turns the login off for every suite; this one needs it on.
        os.environ["TWINOS_LOGIN"] = "on"
        os.environ["TWINOS_LOGIN_EMAIL"] = "abdul@example.test"
        os.environ["TWINOS_LOGIN_PASSWORD"] = "wrong"
        with self.assertRaises(tm.TwinOSError) as cm:
            tm.user_token()
        self.assertIn("login", str(cm.exception))

    def test_the_friday_scoreboard_reads_week_start_not_week(self):
        # v_friday_scoreboard has week_start; `week` never existed on it.
        FakeTwinOS.state["bodies"]["/rest/v1/v_friday_scoreboard"] = [{"week_start": "2026-10-05", "channel_members": 1200}]
        tm.tool_call("twinos_friday", {})
        self.assertIn("order=week_start.desc", self.last()["path"])
        tm.tool_call("twinos_friday", {"week": "2026-09-21"})
        self.assertIn("week_start=eq.2026-09-21", self.last()["path"])


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
        tm.request("POST", "/functions/v1/content/c77/request-approval", {"content_id": "c1"})   # asking is fine
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
        self.assertEqual(r["path"], "/functions/v1/content/draft")
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
        self.assertEqual(len(tv.TWINOS_VERBS), 9)
        for v in tv.TWINOS_VERBS:
            self.assertEqual(set(v), {"verb", "arg", "what", "on"})
            self.assertEqual(v["on"], ["hub"])
            self.assertTrue(v["verb"].startswith("twinos_"))
            self.assertNotIn("approv", v["verb"])

    def test_draft_with_ask_requests_approval(self):
        FakeTwinOS.state["bodies"]["/functions/v1/content/draft"] = {"id": "c77", "needed_fields": ["risk_line"], "claim_flags": ["price"]}
        out = tv.twinos_action("twinos_draft", "gold_map | 2410 held, buyers back above 2425 | ask", {})
        self.assertIn("drafted gold_map (c77)", out)
        self.assertIn("risk_line", out)
        self.assertIn("Jack approves", out)
        self.assertIn("on Jack's phone now", out)
        paths = [r["path"] for r in self.reqs]
        self.assertEqual(paths, ["/functions/v1/content/draft", "/functions/v1/content/c77/request-approval"])
        self.assertEqual(self.reqs[0]["body"]["input"], {"text": "2410 held, buyers back above 2425"})
        self.assertEqual(paths[1], "/functions/v1/content/c77/request-approval")  # id in the path

    def test_draft_batch(self):
        out = tv.twinos_action("twinos_draft", "batch", {})
        self.assertEqual(self.last()["path"], "/functions/v1/content/batch")
        self.assertIn("Jack's turn", out)

    def test_schedule_parses_abdul_date_marks_and_claims_are_refused(self):
        out = tv.twinos_action("twinos_schedule", "c42 📅 2026-10-06 ⏰ 07:50 on telegram, threads", {})
        r = self.last()
        self.assertEqual(r["path"], "/functions/v1/content/c42/schedule")
        self.assertEqual(r["body"]["run_at"], "2026-10-06T07:50:00")
        self.assertIn("scheduled c42 for 2026-10-06 07:50 on telegram, threads", out)
        FakeTwinOS.state["status_once"] = (403, {"error": "claim post needs approval"})
        out = tv.twinos_action("twinos_schedule", "c43 at 2026-10-07 09:00", {})
        self.assertIn("Jack approves it on his phone first", out)

    def test_result_sends_only_the_id(self):
        FakeTwinOS.state["bodies"]["/functions/v1/results"] = {"ok": True, "status": "TP1"}
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
        FakeTwinOS.state["bodies"]["/functions/v1/health"] = {"ok": True, "summary": "Nothing broken. Carry on."}
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
        tv.twinos_call({}, "/functions/v1/content/batch", {"for": "2026-10-05"})
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


class TestResearchReads(Base):
    """search / ideas / channels — the three reads that turn other people's
    publishing into something Jack can pick from. Nothing here writes a draft."""

    def test_search_reads_feed_items_and_cannot_be_broken_by_its_own_term(self):
        tm.tool_call("twinos_search", {"q": "gold, or (x) break", "since": "2026-10-01", "limit": 5})
        r = self.last()
        self.assertEqual(r["path"].split("?")[0], "/rest/v1/feed_items")
        self.assertIn("or=(title.ilike.", r["path"])
        self.assertIn("published_at=gte.2026-10-01", r["path"])
        self.assertIn("limit=5", r["path"])
        # punctuation would end the PostgREST filter clause, so it never reaches the URL
        self.assertNotIn("%28", r["path"], "( was stripped from the term")
        self.assertNotIn("%29", r["path"], ") was stripped from the term")

    def test_search_needs_something_to_search_for(self):
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_search", {})
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_search", {"q": "   "})
        with self.assertRaises(ValueError):
            tm.tool_call("twinos_search", {"q": "???"})
        self.assertEqual(self.reqs, [])

    def test_ideas_posts_the_window_to_the_research_route_and_keeps_the_ranking(self):
        FakeTwinOS.state["bodies"]["/functions/v1/research/ideas"] = {
            "ok": True, "days": 7,
            "ideas": [{"id": "a", "title": "Gold broke 4000", "pillar": "Gold", "matched": ["gold"], "score": 2}],
        }
        try:
            out = tm.tool_call("twinos_ideas", {"days": 7, "limit": 5})
            r = self.last()
            self.assertEqual(r["path"], "/functions/v1/research/ideas")
            self.assertEqual(r["method"], "POST")
            self.assertEqual(r["body"], {"days": 7, "limit": 5, "actor": tm.ACTOR})
            self.assertEqual(out["ideas"][0]["matched"], ["gold"])
        finally:
            FakeTwinOS.state["bodies"].pop("/functions/v1/research/ideas", None)

    def test_channels_asks_for_a_live_count_by_default_and_can_be_read_without_one(self):
        FakeTwinOS.state["bodies"]["/functions/v1/research/channels"] = {
            "ok": True, "refreshed": 1,
            "channels": [{"name": "Gold desk", "handle": "golddesk", "live_members": 4200, "refresh_error": None}],
        }
        try:
            out = tm.tool_call("twinos_channels", {})
            r = self.last()
            self.assertEqual(r["path"], "/functions/v1/research/channels")
            self.assertIs(r["body"]["refresh"], True, "a live count is what the tool is for")
            self.assertEqual(out["refreshed"], 1)

            tm.tool_call("twinos_channels", {"refresh": False})
            r = self.last()
            self.assertIs(r["body"]["refresh"], False, "and the manual notes alone are a read, not a refresh")
        finally:
            FakeTwinOS.state["bodies"].pop("/functions/v1/research/channels", None)
