"""The TradingView test-signal script drives the real webhook — and must never approve.

Same guard as the desk selftest: the only callback verb it can send is "no".
It also has to keep checking the four things the signal card is supposed to
carry (direction emoji, COUNTER-TREND line, risk line, footer); if a future
edit drops one of those assertions, this test fails.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "test-signal.sh"


class TradingViewSignalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text()

    def test_script_exists_and_is_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertTrue(self.src.startswith("#!/usr/bin/env bash"))

    def test_bash_syntax(self):
        r = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_it_rejects_and_never_approves(self):
        self.assertIn('"data":"no:', self.src)
        self.assertNotIn('"data":"ok:', self.src)
        self.assertNotIn('"data": "ok:', self.src)

    def test_it_asserts_the_four_card_checks(self):
        for needle in ("COUNTER-TREND", "Risk 1% or less", "Results get posted", "🟢"):
            self.assertIn(needle, self.src, f"the card check for {needle!r} is missing")

    def test_dry_run_needs_no_tools_beyond_coreutils(self):
        with tempfile.TemporaryDirectory() as d:
            for tool in ("bash", "cat", "date", "cut", "dirname"):
                src = shutil.which(tool)
                self.assertIsNotNone(src, f"{tool} missing on this machine")
                os.symlink(src, os.path.join(d, tool))
            r = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run"],
                capture_output=True, text=True, timeout=60, env={"PATH": d},
            )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("DRY RUN", r.stdout)
        self.assertIn('"data":"no:', r.stdout)

    def test_the_test_signal_is_marked_test(self):
        # A test alert must be obvious in the signals table.
        self.assertIn('EXT="test-$(date +%s)"', self.src)

    def test_update_ids_stay_above_telegrams(self):
        self.assertIn("900000000000", self.src)


if __name__ == "__main__":
    unittest.main()
