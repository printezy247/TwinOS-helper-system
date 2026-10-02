"""The desk tour drives the new Desk features live, and must never approve.

It runs against the real Desk group after a deploy, so its hard rules are
enforced here in CI, where there is no keyring: it only ever rejects, it never
sends "/batch ok", and it never logs baseline hours (that would skew the
baseline Jack records by hand).
"""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "desk-tour.sh"


def dry_run(env=None):
    return subprocess.run(
        ["bash", str(SCRIPT), "--dry-run"],
        capture_output=True, text=True, timeout=60, env=env,
    )


class DeskTourTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text() if SCRIPT.exists() else ""

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

    def test_it_never_sends_batch_ok(self):
        self.assertIsNone(re.search(r"/batch\s+ok", self.src, re.I))

    def test_hours_is_read_only(self):
        # "/hours today" reads; "/hours <task> <minutes>" would write a baseline row.
        for cmd in re.findall(r"/hours[^\"',\n]*", self.src):
            if cmd.strip() == "/hours":
                continue
            self.assertEqual(cmd.strip(), "/hours today", cmd)

    def test_it_checks_nothing_was_queued_to_publish(self):
        self.assertIn("publish_jobs", self.src)

    def test_dry_run_tours_every_new_command(self):
        r = dry_run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for cmd in ("/status", "/friday", "/hours today", "/batch", "/fanout #"):
            self.assertIn(cmd, r.stdout, cmd)
        self.assertIn('"data":"no:', r.stdout)
        self.assertNotIn('"data":"ok:', r.stdout)
        self.assertIn("DRY RUN", r.stdout)

    def test_dry_run_needs_no_tools_beyond_coreutils(self):
        with tempfile.TemporaryDirectory() as d:
            for tool in ("bash", "cat", "date", "cut", "dirname"):
                src = shutil.which(tool)
                self.assertIsNotNone(src, f"{tool} missing on this machine")
                os.symlink(src, os.path.join(d, tool))
            r = dry_run(env={"PATH": d})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("DRY RUN", r.stdout)

    def test_a_cli_answer_without_rows_is_reported_as_a_cli_problem(self):
        # The CLI can exit 0 with an error object (or a bare banner). That must
        # stop the tour with the CLI's own words, not "setting is unset".
        for script in (SCRIPT, REPO / "scripts" / "desk-selftest.sh"):
            with tempfile.TemporaryDirectory() as d:
                fake = {
                    "supabase": "#!/bin/sh\necho 'Initialising login role...'\n"
                                "echo '{\"_tag\":\"Error\",\"error\":{\"message\":\"Access token not provided\"}}'\nexit 0\n",
                    "secret-tool": "#!/bin/sh\necho fake-value\n",
                    "curl": "#!/bin/sh\necho 200\n",
                }
                for name, body in fake.items():
                    p = Path(d) / name
                    p.write_text(body)
                    p.chmod(0o755)
                for tool in ("bash", "cat", "date", "cut", "dirname", "sed", "jq", "grep",
                             "sha256sum", "printf", "head", "tr", "sleep", "wc"):
                    src = shutil.which(tool)
                    if src:
                        os.symlink(src, os.path.join(d, tool))
                r = subprocess.run(["bash", str(script)], capture_output=True, text=True,
                                   timeout=60, env={"PATH": d})
            out = r.stdout + r.stderr
            self.assertNotEqual(r.returncode, 0, out)
            self.assertNotIn("is unset", out, script.name)
            self.assertIn("Access token not provided", out, script.name)

    def test_settings_are_read_the_way_a_person_s_terminal_answers(self):
        # Outside an agent the CLI prints a box table, and with
        # --output-format json a bare [...] (no "rows" key). Jack's run hit both.
        fake_cli = (
            "#!/bin/sh\n"
            "echo 'Initialising login role...'\n"
            "case \"$*\" in *'--output-format json'*) ;; *) echo '┌───┐'; exit 0;; esac\n"
            "echo '['\n"
            "echo '  {\"v\": \"6282941580\"}'\n"
            "echo ']'\n"
        )
        for script in (SCRIPT, REPO / "scripts" / "desk-selftest.sh"):
            with tempfile.TemporaryDirectory() as d:
                fake = {
                    "supabase": fake_cli,
                    "secret-tool": "#!/bin/sh\necho fake-value\n",
                    "curl": "#!/bin/sh\necho 200\n",
                    "sleep": "#!/bin/sh\nexit 0\n",
                }
                for name, body in fake.items():
                    p = Path(d) / name
                    p.write_text(body)
                    p.chmod(0o755)
                for tool in ("bash", "cat", "date", "cut", "dirname", "sed", "jq", "grep",
                             "sha256sum", "head", "tr", "wc"):
                    src = shutil.which(tool)
                    if src:
                        os.symlink(src, os.path.join(d, tool))
                r = subprocess.run(["bash", str(script)], capture_output=True, text=True,
                                   timeout=60, env={"PATH": d})
            out = r.stdout + r.stderr
            self.assertNotIn("is unset", out, script.name)
            self.assertNotIn("gave no rows", out, script.name)
            # Past the settings: the first webhook call was made.
            self.assertIn("HTTP 200", out, script.name)

    def test_every_script_asks_the_cli_for_json(self):
        # In a real terminal the CLI prints a box-drawn table by default; it
        # only prints JSON when nobody is watching. Jack's live run hit this.
        for script in sorted((REPO / "scripts").glob("*.sh")):
            for line in script.read_text().splitlines():
                if "supabase db query" in line and not line.lstrip().startswith("#"):
                    self.assertIn("--output-format json", line, f"{script.name}: {line.strip()}")

    def test_update_ids_do_not_collide_with_the_selftest(self):
        # The selftest uses 900000000000 + epoch; the tour sits 1e10 above it.
        self.assertIn("910000000000", self.src)


if __name__ == "__main__":
    unittest.main()
