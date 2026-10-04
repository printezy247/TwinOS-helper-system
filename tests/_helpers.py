"""Shared bits for the tests that drive a shell script in a scrubbed PATH.

CI has no keyring, no Supabase CLI and no jq, so a script's --dry-run has to run
with a PATH holding nothing but coreutils. Four test classes need that; the
helper is here so the tool list lives in one place.
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"

# bash + coreutils only. The scripts themselves must not need more to dry-run.
COREUTILS = ("bash", "cat", "date", "cut", "dirname")
# The settings-reading path adds these on top of COREUTILS; used where a fake
# Supabase CLI has to be reachable.
QUERY_TOOLS = COREUTILS + ("sed", "jq", "grep", "sha256sum", "head", "tr", "wc")


def run_script(script: Path, *args: str, env: dict | None = None, timeout: int = 60):
    """Run a script with bash and capture its output."""
    return subprocess.run(
        ["bash", str(script), *args],
        capture_output=True, text=True, timeout=timeout, env=env,
    )


def syntax_error(script: Path) -> str:
    """`bash -n` the script; empty means it parses."""
    r = subprocess.run(["bash", "-n", str(script)], capture_output=True)
    assert r.returncode == 0, r.stderr.decode()
    return ""


def run_with_tools(
    script: Path,
    *args: str,
    tools=COREUTILS,
    fakes: dict[str, str] | None = None,
    timeout: int = 60,
):
    """Run a script with a PATH holding only `tools`, plus any `fakes`.

    A tool missing from this machine is skipped, not faked: the assertions
    afterwards say what the script printed, so a skip cannot hide a failure.
    `fakes` maps a command name to a `#!/bin/sh` body, for standing in for the
    Supabase CLI, secret-tool or curl.
    """
    with tempfile.TemporaryDirectory() as d:
        # Fakes first: writing over a symlink would edit the real binary.
        for name, body in (fakes or {}).items():
            fake_tool(Path(d), name, body)
        for tool in tools:
            src = shutil.which(tool)
            if src and not (Path(d) / tool).exists():
                os.symlink(src, os.path.join(d, tool))
        return run_script(script, *args, env={"PATH": d}, timeout=timeout)


def fake_tool(directory: Path, name: str, body: str) -> None:
    """Write an executable stand-in for `name` into `directory`."""
    p = directory / name
    p.write_text(body)
    p.chmod(0o755)