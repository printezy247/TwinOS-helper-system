"""The desk selftest proves the Desk loop live — and must never approve.

It runs against the real Desk group, so its one hard rule is enforced here in
CI, where the keyring does not exist: the only callback verb it can ever send
is "no" (reject). If a future edit adds an approve tap, these tests fail.
"""
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "desk-selftest.sh"


class DeskSelftestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text()

    def test_script_exists_and_is_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertTrue(self.src.startswith("#!/usr/bin/env bash"))

    def test_bash_syntax(self):
        r = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_it_rejects(self):
        self.assertIn('"data":"no:', self.src)

    def test_it_never_approves(self):
        # An approve tap would be callback data "ok:<id8>".
        self.assertNotIn('"data":"ok:', self.src)
        self.assertNotIn('"data": "ok:', self.src)

    def test_dry_run_needs_no_keyring(self):
        r = subprocess.run(
            ["bash", str(SCRIPT), "--dry-run"],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('"data":"no:', r.stdout)
        self.assertNotIn('"data":"ok:', r.stdout)
        self.assertIn("DRY RUN", r.stdout)

    def test_update_ids_stay_above_telegrams(self):
        # Real update_ids are ~1e10; synthetic ones must never collide.
        self.assertIn("900000000000", self.src)


if __name__ == "__main__":
    unittest.main()
