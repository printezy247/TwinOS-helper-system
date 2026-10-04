"""The desk selftest proves the Desk loop live — and must never approve.

It runs against the real Desk group, so its one hard rule is enforced here in
CI, where the keyring does not exist: the only callback verb it can ever send
is "no" (reject). If a future edit adds an approve tap, these tests fail.
"""
import unittest

from _helpers import COREUTILS, SCRIPTS, run_script, run_with_tools, syntax_error

SCRIPT = SCRIPTS / "desk-selftest.sh"


class DeskSelftestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text()

    def test_script_exists_and_is_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertTrue(self.src.startswith("#!/usr/bin/env bash"))

    def test_bash_syntax(self):
        syntax_error(SCRIPT)

    def test_it_rejects(self):
        self.assertIn('"data":"no:', self.src)

    def test_it_never_approves(self):
        # An approve tap would be callback data "ok:<id8>".
        self.assertNotIn('"data":"ok:', self.src)
        self.assertNotIn('"data": "ok:', self.src)

    def test_dry_run_needs_no_keyring(self):
        r = run_script(SCRIPT, "--dry-run")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('"data":"no:', r.stdout)
        self.assertNotIn('"data":"ok:', r.stdout)
        self.assertIn("DRY RUN", r.stdout)

    def test_dry_run_needs_no_tools_beyond_coreutils(self):
        # CI has no supabase CLI and no secret-tool: run the dry-run with a
        # PATH that contains only the tools it is allowed to need.
        r = run_with_tools(SCRIPT, "--dry-run", tools=COREUTILS)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("DRY RUN", r.stdout)

    def test_update_ids_stay_above_telegrams(self):
        # Real update_ids are ~1e10; synthetic ones must never collide.
        self.assertIn("900000000000", self.src)


if __name__ == "__main__":
    unittest.main()