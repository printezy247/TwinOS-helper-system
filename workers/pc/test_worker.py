"""Unit tests for twinos_worker.py that need no network and no keyring."""

from __future__ import annotations

import csv
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("TWINOS_URL", "https://example.invalid")
os.environ.setdefault("TWINOS_WORKER_KEY", "twk_pc_worker_" + "0" * 40)

import twinos_worker as w  # noqa: E402


class FakeApi:
    def __init__(self, status=200, body=None):
        self.calls = []
        self.status, self.body = status, body or {"ok": True}

    def call(self, path, body=None, method="POST", idempotency_key=None):
        self.calls.append((path, body, idempotency_key))
        return self.status, self.body

    def result(self, job_id, ok, result=None, error=None):
        self.calls.append(("jobs/result", {"job_id": job_id, "ok": ok, "result": result, "error": error}, None))


class FindRecordingTests(unittest.TestCase):
    def make(self, names):
        d = Path(tempfile.mkdtemp())
        for n in names:
            (d / n).write_bytes(b"x")
        return d

    def test_the_file_with_the_date_and_the_platform_wins(self):
        d = self.make(["live_2026-09-30_telegram.mp4", "live_2026-09-30_tiktok.mp4", "live_2026-09-29_tiktok.mp4"])
        self.assertEqual(w.find_recording(d, "tiktok", "2026-09-30").name, "live_2026-09-30_tiktok.mp4")

    def test_a_compact_date_matches_too(self):
        d = self.make(["tiktok-live-20260930-2100.mkv"])
        self.assertEqual(w.find_recording(d, "tiktok", "2026-09-30").name, "tiktok-live-20260930-2100.mkv")

    def test_with_only_the_date_the_newest_file_is_used(self):
        d = self.make(["a_2026-09-30.mp4", "b_2026-09-30.mp4"])
        old = d / "a_2026-09-30.mp4"
        os.utime(old, (1, 1))
        self.assertEqual(w.find_recording(d, "tiktok", "2026-09-30").name, "b_2026-09-30.mp4")

    def test_nothing_for_that_day_is_none_and_other_file_types_are_ignored(self):
        d = self.make(["notes_2026-09-30.txt", "live_2026-10-01.mp4"])
        self.assertIsNone(w.find_recording(d, "tiktok", "2026-09-30"))
        self.assertIsNone(w.find_recording(Path("/nonexistent-dir"), "tiktok", "2026-09-30"))


class KeyringTests(unittest.TestCase):
    def test_env_override_wins(self):
        self.assertEqual(w.keyring("url"), "https://example.invalid")

    def test_missing_optional_is_empty(self):
        with mock.patch("subprocess.run", side_effect=OSError):
            self.assertEqual(w.keyring("nope", required=False), "")


class ApiHeaderTests(unittest.TestCase):
    """The gateway admits only JWTs: the anon key rides on Authorization, the worker key on X-TwinOS-Key."""

    def sent_headers(self):
        seen = {}

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b"{}"

        def fake_urlopen(req, timeout=None):
            seen.update({k.lower(): v for k, v in req.header_items()})
            return Resp()

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            w.Api().call("health/beat", {})
        return seen

    def test_anon_key_on_authorization_worker_key_on_its_own_header(self):
        with mock.patch.dict(os.environ, {"TWINOS_APIKEY": "eyJhbGciOiJIUzI1NiJ9.e30.anon"}):
            h = self.sent_headers()
        self.assertEqual(h["authorization"], "Bearer eyJhbGciOiJIUzI1NiJ9.e30.anon")
        self.assertEqual(h["x-twinos-key"], os.environ["TWINOS_WORKER_KEY"])

    def test_without_anon_key_the_worker_key_is_the_bearer(self):
        with mock.patch.dict(os.environ, {"TWINOS_APIKEY": ""}), \
             mock.patch("subprocess.run", side_effect=OSError):
            h = self.sent_headers()
        self.assertEqual(h["authorization"], "Bearer " + os.environ["TWINOS_WORKER_KEY"])


class TelechurnTests(unittest.TestCase):
    def test_csv_rows_posted(self):
        api = FakeApi()
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"HOME": d}):
            p = Path(d) / "EzyMap" / "telechurn" / "2026-10-05.csv"
            p.parent.mkdir(parents=True)
            with p.open("w", newline="") as f:
                wr = csv.writer(f)
                wr.writerow(["link_name", "joins", "leaves", "retained"])
                wr.writerow(["tt-live-2610", "12", "3", "9"])
            out = w.job_telechurn_import(api, {"week_start": "2026-10-05", "path": str(p)})
        self.assertEqual(out["rows"], 1)
        path, body, _ = api.calls[-1]
        self.assertEqual(path, "jobs/telechurn")
        self.assertEqual(body["rows"][0]["link_name"], "tt-live-2610")


class RunOneTests(unittest.TestCase):
    def test_unknown_kind_reports_failure(self):
        api = FakeApi()
        w.run_one(api, {"id": "abc", "kind": "nope", "payload": {}})
        self.assertFalse(api.calls[-1][1]["ok"])

    def test_handler_exception_is_reported_not_raised(self):
        api = FakeApi()
        w.run_one(api, {"id": "abc", "kind": "research_batch", "payload": {}})
        self.assertFalse(api.calls[-1][1]["ok"])
        self.assertIn("Phase 5", api.calls[-1][1]["error"])


class DropFolderTests(unittest.TestCase):
    def test_oversize_refused(self):
        api = FakeApi()
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "big.mp4"
            p.write_bytes(b"0")
            with mock.patch.object(Path, "stat") as st:
                st.return_value.st_size = w.MAX_ASSET_BYTES + 1
                st.return_value.st_mtime = 0
                with self.assertRaises(RuntimeError):
                    w.signed_upload(api, p)


class LlmVariantsTests(unittest.TestCase):
    RAW = ["4590 held, bias up", "watch 4612"]

    def test_prompt_carries_the_raw_lines_and_the_json_rule(self):
        p = w.build_variants_prompt(self.RAW, ["telegram"], "en", angles=3)
        self.assertIn("4590 held", p)
        self.assertIn("JSON", p)
        self.assertIn("4590", p)  # the allowed numbers ride along
        self.assertIn("only", p.lower())

    def test_strict_json_round_trip(self):
        variants = w.parse_variants(
            '{"variants": [{"platform": "telegram", "angle": 1, "body": "a"},'
            ' {"platform": "telegram", "angle": 2, "body": "b"},'
            ' {"platform": "telegram", "angle": 3, "body": "c"}]}',
            ["telegram"], angles=3,
        )
        self.assertEqual([v["angle"] for v in variants], [1, 2, 3])

    def test_bad_shape_is_refused(self):
        for bad in ("not json", '{"variants": []}', '{"other": 1}',
                    '{"variants": [{"platform": "telegram", "angle": 1}]}'):
            with self.assertRaises(ValueError, msg=bad):
                w.parse_variants(bad, ["telegram"], angles=3)

    def test_only_a_loopback_model_is_called(self):
        for url in ("http://example.com:8080", "https://10.0.0.1/", "http://192.168.1.2:8080"):
            with self.assertRaises(RuntimeError, msg=url):
                w.job_llm_variants(FakeApi(), {"llama_url": url, "raw_lines": self.RAW})

    def test_handler_is_registered(self):
        self.assertIn("llm_variants", w.KINDS)
        self.assertIn("llm_variants", w.HANDLERS)


class LongformTests(unittest.TestCase):
    def test_longform_flag_cuts_the_best_window_with_chapters(self):
        from studio import longform

        home = Path(tempfile.mkdtemp())
        lives = home / "EzyMap" / "lives"
        lives.mkdir(parents=True)
        src = lives / "live_2026-09-28.mp4"
        src.write_bytes(b"x")
        with mock.patch.dict(os.environ, {"HOME": str(home)}), \
                mock.patch.object(longform, "run_long", return_value={"long_form": "long.mp4", "chapters": 4}) as run:
            out = w.job_clip(FakeApi(), {"path": str(src), "longform": True, "lang": "en"})
        self.assertEqual(out, {"long_form": "long.mp4", "chapters": 4})
        run.assert_called_once_with(src, lang="en")

    def test_without_the_flag_clips_still_go_through_clipper(self):
        from studio import clipper

        home = Path(tempfile.mkdtemp())
        lives = home / "EzyMap" / "lives"
        lives.mkdir(parents=True)
        src = lives / "live_2026-09-28.mp4"
        src.write_bytes(b"x")
        with mock.patch.dict(os.environ, {"HOME": str(home)}), \
                mock.patch.object(clipper, "run", return_value={"clips": []}) as run:
            out = w.job_clip(FakeApi(), {"path": str(src), "max_clips": 1})
        self.assertEqual(out, {"clips": []})
        run.assert_called_once()


class CheckMediaPath(unittest.TestCase):
    """Job payloads may name files only inside the EzyMap tree."""

    def test_a_path_under_ezymap_passes(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"HOME": d}):
            p = Path(d) / "EzyMap" / "lives" / "rec.mp4"
            p.parent.mkdir(parents=True)
            p.write_bytes(b"x")
            self.assertEqual(w.check_media_path(p, "clip"), p.resolve())

    def test_a_path_outside_is_refused(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"HOME": d}):
            p = Path(d) / "secret.txt"
            p.write_text("x")
            with self.assertRaisesRegex(RuntimeError, "outside the EzyMap tree"):
                w.check_media_path(p, "clip")

    def test_a_dotdot_escape_is_refused_after_resolving(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"HOME": d}):
            p = Path(d) / "EzyMap" / "lives" / ".." / ".." / "etc" / "passwd"
            with self.assertRaisesRegex(RuntimeError, "outside the EzyMap tree"):
                w.check_media_path(p, "clip_candidates")


class ContentTypeFor(unittest.TestCase):
    def test_images_get_their_own_type(self):
        self.assertEqual(w.content_type_for(Path("a.jpg")), "image/jpeg")
        self.assertEqual(w.content_type_for(Path("a.jpeg")), "image/jpeg")
        self.assertEqual(w.content_type_for(Path("a.webp")), "image/webp")
        self.assertEqual(w.content_type_for(Path("a.PNG")), "image/png")

    def test_video_and_unknown(self):
        self.assertEqual(w.content_type_for(Path("a.mp4")), "video/mp4")
        self.assertEqual(w.content_type_for(Path("a.weird")), "application/octet-stream")


class PgEnvFromUrl(unittest.TestCase):
    def test_the_password_lands_in_the_env_never_in_a_command_argument(self):
        env, dbname = w._pg_env_from_url("postgresql://postgres:secret@db.host:5432/postgres")
        self.assertEqual(dbname, "postgres")
        self.assertEqual(env["PGPASSWORD"], "secret")
        self.assertEqual(env["PGHOST"], "db.host")
        self.assertEqual(env["PGPORT"], "5432")
        self.assertEqual(env["PGUSER"], "postgres")

    def test_a_url_without_a_database_name_is_refused(self):
        with self.assertRaises(RuntimeError):
            w._pg_env_from_url("postgresql://postgres:secret@db.host")

    def test_a_non_postgres_url_is_refused(self):
        with self.assertRaises(RuntimeError):
            w._pg_env_from_url("mysql://x/y")


if __name__ == "__main__":
    unittest.main()
