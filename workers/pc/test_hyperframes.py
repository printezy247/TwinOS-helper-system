"""E3 HyperFrames: deterministic 1080x1920 cover + word-caption render job.

TDD anchors: the kind is registered on both sides; missing ffmpeg or a
non-22 node fails the job with a clear message (never silently); a
composition without the risk line is refused; two renders of the same
spec hash the same first and last frame.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("TWINOS_URL", "https://example.invalid")
os.environ.setdefault("TWINOS_WORKER_KEY", "twk_pc_worker_" + "0" * 40)

import twinos_worker as w  # noqa: E402
from studio import hyperframes as hf  # noqa: E402

TINY = {"width": 270, "height": 480, "fps": 10, "duration_s": 0.6}


def spec(**over):
    base = {
        "hook": "The chart everyone missed",
        "captions": [
            {"text": "chart", "start_s": 0.10, "end_s": 0.30},
            {"text": "missed", "start_s": 0.30, "end_s": 0.55},
        ],
        "risk_line": hf.DEFAULT_RISK_LINE,
        **TINY,
    }
    base.update(over)
    return base


class KindRegistered(unittest.TestCase):
    def test_worker_accepts_and_handles_the_kind(self):
        self.assertIn("hyperframes_render", w.KINDS)
        self.assertIn("hyperframes_render", w.HANDLERS)

    def test_backend_allows_the_kind(self):
        ts = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "jobs" / "index.ts"
        self.assertRegex(ts.read_text(), re.compile(r'JOB_KINDS = \[[^\]]*"hyperframes_render"'))


class CompositionIsValid(unittest.TestCase):
    def test_missing_risk_line_is_refused(self):
        s = spec(risk_line="")
        with self.assertRaisesRegex(ValueError, "risk line"):
            hf.build_composition(s)

    def test_missing_hook_is_refused(self):
        with self.assertRaisesRegex(ValueError, "hook"):
            hf.build_composition(spec(hook=""))

    def test_composition_text_contains_the_risk_line(self):
        texts = [d["text"] for d in hf.build_composition(spec())]
        self.assertIn(hf.DEFAULT_RISK_LINE, texts)


class PrerequisitesFailLoudly(unittest.TestCase):
    def test_missing_ffmpeg_raises_clear(self):
        with mock.patch.object(hf.shutil, "which", lambda exe: None if exe == "ffmpeg" else "/usr/bin/" + exe):
            with self.assertRaisesRegex(RuntimeError, "ffmpeg"):
                hf.check_prereqs()

    def test_wrong_node_major_raises_clear(self):
        done = subprocess.CompletedProcess([], 0, "v20.11.0\n", "")
        with mock.patch.object(hf.shutil, "which", lambda exe: "/usr/bin/" + exe), \
             mock.patch.object(hf.subprocess, "run", lambda *a, **k: done):
            with self.assertRaisesRegex(RuntimeError, "Node 22"):
                hf.check_prereqs()


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("node"), "needs ffmpeg + node")
class GoldenFramesDeterministic(unittest.TestCase):
    def _frame_shas(self, tmp):
        vid = Path(tmp) / "out.mp4"
        hf.render_video(spec(), vid)
        n = int(round(TINY["duration_s"] * TINY["fps"])) - 1
        return hf.frame_sha(vid, 0), hf.frame_sha(vid, n)

    def test_two_runs_of_the_same_spec_hash_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.assertEqual(self._frame_shas(a), self._frame_shas(b))

    def test_job_reports_ok_only_with_verified_risk_and_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(hf, "OUTPUT_DIR", Path(tmp)):
                res = hf.render_job({"hook": "Hello", "captions": [{"text": "Hi", "start_s": 0.0, "end_s": 0.4}], **TINY})
            self.assertTrue(res["risk_line_verified"])
            self.assertEqual(len(res["first_frame_sha"]), 64)
            self.assertEqual(len(res["last_frame_sha"]), 64)
            self.assertTrue(Path(res["path"]).exists())


if __name__ == "__main__":
    unittest.main()
