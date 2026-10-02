"""The worker installer must never put a secret into the unit file.

CI has no systemd user session, so the script cannot be run here. These tests
pin the two things that would be dangerous or silently wrong: a secret leaking
into the unit, and the installer trying to enqueue a job with the worker's key
(jobs/enqueue is jack/abdul/cron only, so it would 403 and the verify step
would lie).
"""
import re
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "install-worker.sh"
UNIT = REPO / "workers" / "pc" / "twinos-worker.service"


class InstallWorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text()
        cls.unit = UNIT.read_text()

    def test_script_exists_and_is_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertTrue(self.src.startswith("#!/usr/bin/env bash"))

    def test_bash_syntax(self):
        r = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_unit_carries_no_secret(self):
        self.assertNotIn("twk_", self.unit)
        self.assertNotIn("eyJ", self.unit)          # a JWT
        self.assertNotIn("postgres://", self.unit)
        self.assertNotIn("postgresql://", self.unit)
        # No Environment= line may carry a credential.
        for line in self.unit.splitlines():
            if line.strip().startswith("Environment="):
                self.assertNotRegex(line, r"(key|token|secret|password)", line)

    def test_script_does_not_inject_a_secret_into_the_unit(self):
        self.assertNotIn("Environment=", self.src)
        self.assertNotRegex(self.src, r"secret-tool lookup[^\n]*>>?\s*\$?UNIT")

    def test_script_has_check_and_uninstall(self):
        self.assertIn("--check", self.src)
        self.assertIn("--uninstall", self.src)

    def test_test_job_is_enqueued_through_the_cli(self):
        # pc_worker may not call jobs/enqueue; the installer must use the CLI.
        self.assertIn("insert into public.jobs", self.src)
        self.assertIn("supabase db query", self.src)

    def test_it_verifies_the_loop_and_the_backup(self):
        self.assertIn("--self-test", self.src)
        self.assertIn("drop_folder_watch", self.src)
        self.assertIn("backup", self.src)

    def test_unit_path_matches_where_it_installs(self):
        self.assertIn("$HOME/.config/systemd/user/twinos-worker.service", self.src)
        self.assertIn("WantedBy=default.target", self.unit)


if __name__ == "__main__":
    unittest.main()
