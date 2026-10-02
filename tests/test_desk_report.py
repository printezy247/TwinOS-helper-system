"""desk-report.sh posts a text file to the EzyMap Desk, and nowhere else.

It sends with the Ops bot token from the keyring, so CI (no keyring) checks
its rules: the only chat it can reach is settings.desk_group_chat_id, the token
never appears on a command line, long reports are split under Telegram's limit,
and --dry-run sends nothing.
"""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "desk-report.sh"


def run(args, env=None):
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, timeout=60, env=env)


class DeskReportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = SCRIPT.read_text() if SCRIPT.exists() else ""

    def test_script_exists_and_is_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertTrue(self.src.startswith("#!/usr/bin/env bash"))
        r = subprocess.run(["bash", "-n", str(SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_it_only_ever_targets_the_desk(self):
        self.assertIn("desk_group_chat_id", self.src)
        for line in self.src.splitlines():
            if "chat_id=" in line and not line.lstrip().startswith("#"):
                self.assertIn("$DESK_ID", line, line)
        self.assertNotIn("channel_chat_id", self.src)
        self.assertNotIn("discussion", self.src.lower())

    def test_the_token_never_rides_on_a_command_line(self):
        # The URL with the token goes to curl on stdin (-K -), never as an argument.
        self.assertIn("-K -", self.src)
        self.assertIsNone(re.search(r"curl[^\n]*api\.telegram\.org/bot\$", self.src))

    def test_dry_run_splits_a_long_report_and_sends_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            report = Path(d) / "r.txt"
            report.write_text("".join(f"line {i:04d} " + "x" * 60 + "\n" for i in range(150)))
            tools = Path(d) / "bin"
            tools.mkdir()
            for tool in ("bash", "cat", "date", "cut", "dirname", "wc"):
                src = shutil.which(tool)
                self.assertIsNotNone(src, tool)
                os.symlink(src, tools / tool)
            r = run(["--dry-run", str(report)], env={"PATH": str(tools)})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        parts = re.findall(r"^--- part (\d+)/(\d+), (\d+) chars", r.stdout, re.M)
        self.assertGreaterEqual(len(parts), 3)
        for _, _, n in parts:
            self.assertLessEqual(int(n), 4000)
        self.assertIn("line 0000", r.stdout)
        self.assertIn("line 0149", r.stdout)
        self.assertIn("DRY RUN", r.stdout)

    def test_a_missing_file_stops(self):
        r = run(["--dry-run", "/nonexistent/report.txt"])
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("STOPPED", r.stderr)


if __name__ == "__main__":
    unittest.main()
