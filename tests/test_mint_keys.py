"""scripts/mint-keys.sh against a fake Supabase CLI and a fake keyring.

The point of the script is that a plain key goes from the database to the
keyring without ever reaching the terminal, so every test checks the combined
output for the full key.
"""

import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "mint-keys.sh"

# A fake `supabase db query --linked "<sql>"` backed by a JSON file of api_keys rows.
FAKE_SUPABASE = r'''#!/usr/bin/env python3
import json, os, re, secrets, sys
db_path = os.environ["FAKE_DB"]
rows = json.load(open(db_path)) if os.path.exists(db_path) else []
sql = sys.argv[-1]
if "api-keys" in sys.argv:
    # The CLI lists every key; the script must keep only the anon one.
    print(json.dumps([{"name": "anon", "api_key": "eyJ.fake-anon.sig"},
                      {"name": "service_role", "api_key": "eyJ.SERVICE-ROLE-MUST-NOT-LEAK.sig"}]))
    sys.exit(0)
if os.environ.get("FAKE_FAIL"):
    # A failing CLI that echoes a key-shaped string: the script must mask it.
    print("error near twk_abdul_" + "9" * 8 + "deadbeef" * 4, file=sys.stderr)
    sys.exit(1)
out = []
if "KEYSTATE" in sql:
    act = sorted(r["name"] + "=" + r["key_prefix"] for r in rows if not r["revoked"])
    out = [{"s": "KEYSTATE:" + ",".join(act) + ":END"}]
elif "rotate_api_key(" in sql:
    name, role = re.search(r"rotate_api_key\('([^']+)', '([^']+)'\)", sql).groups()
    for r in rows:
        if r["name"] == name:
            r["revoked"] = True
            r["name"] = name + "@old"
    key = "twk_" + role + "_" + secrets.token_hex(20)
    rows.append({"name": name, "role": role, "key_prefix": key[:12], "key": key, "revoked": False})
    out = [{"minted": {"name": name, "role": role, "key": key, "key_prefix": key[:12]}}]
elif sql.lstrip().startswith("update public.api_keys"):
    name = re.search(r"where name = '([^']+)'", sql).group(1)
    for r in rows:
        if r["name"] == name:
            r["revoked"] = True
else:
    out = [{k: r[k] for k in ("name", "role", "key_prefix")} for r in rows]
json.dump(rows, open(db_path, "w"))
print(json.dumps(out))
'''

# A fake `secret-tool store|lookup|clear service twinos key <k>` backed by files.
FAKE_SECRET_TOOL = r'''#!/usr/bin/env python3
import os, sys
d = os.environ["FAKE_RING"]
args = sys.argv[1:]
cmd = args[0]
key = args[args.index("key") + 1]
path = os.path.join(d, key)
if cmd == "store":
    open(path, "w").write(sys.stdin.read())
elif cmd == "lookup":
    if os.path.exists(path):
        sys.stdout.write(open(path).read())
    else:
        sys.exit(1)
elif cmd == "clear":
    if os.path.exists(path):
        os.remove(path)
'''

KEY_RE = re.compile(r"twk_[a-z_]+_[0-9a-f]{40}")


class MintKeys(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "scripts").mkdir()
        shutil.copy(SCRIPT, self.tmp / "scripts" / "mint-keys.sh")
        (self.tmp / "supabase" / ".temp").mkdir(parents=True)
        (self.tmp / "supabase" / ".temp" / "project-ref").write_text("testref")
        bindir = self.tmp / "bin"
        bindir.mkdir()
        for name, body in (("supabase", FAKE_SUPABASE), ("secret-tool", FAKE_SECRET_TOOL)):
            p = bindir / name
            p.write_text(body)
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        self.ring = self.tmp / "ring"
        self.ring.mkdir()
        self.db = self.tmp / "db.json"
        self.env = dict(os.environ, PATH=f"{bindir}:{os.environ['PATH']}",
                        FAKE_DB=str(self.db), FAKE_RING=str(self.ring))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_script(self, *args, extra_env=None):
        env = dict(self.env, **(extra_env or {}))
        r = subprocess.run(["bash", str(self.tmp / "scripts" / "mint-keys.sh"), *args],
                           capture_output=True, text=True, env=env, timeout=60)
        return r.returncode, r.stdout + r.stderr

    def rows(self):
        return json.loads(self.db.read_text())

    def ring_value(self, entry):
        p = self.ring / entry
        return p.read_text() if p.exists() else None

    def assert_no_key_shown(self, output):
        self.assertIsNone(KEY_RE.search(output), f"a full key reached the terminal:\n{output}")

    def test_first_run_mints_every_key_into_the_keyring_and_prints_none(self):
        code, out = self.run_script()
        self.assertEqual(code, 0, out)
        self.assert_no_key_shown(out)
        active = {r["name"]: r for r in self.rows() if not r["revoked"]}
        self.assertEqual(set(active), {"abdul", "pc-worker", "ezyai", "abdul-viewer", "sales-bot"})
        for name, entry in (("abdul", "abdul_key"), ("pc-worker", "worker_key"), ("ezyai", "ezyai_key"),
                            ("abdul-viewer", "viewer_key"), ("sales-bot", "sales_bot_key")):
            self.assertEqual(self.ring_value(entry), active[name]["key"])
            self.assertIn(active[name]["key_prefix"], out)
        self.assertEqual(self.ring_value("url"), "https://testref.supabase.co")
        self.assertEqual(self.ring_value("apikey"), "eyJ.fake-anon.sig")
        self.assertNotIn("SERVICE-ROLE", out)
        self.assertFalse(any("SERVICE-ROLE" in p.read_text() for p in self.ring.iterdir()))

    def test_second_run_changes_nothing(self):
        self.run_script()
        before = self.rows()
        code, out = self.run_script()
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("already set"), 7, out)  # url, apikey and the five keys
        self.assertEqual(self.rows(), before)

    def test_key_missing_from_keyring_is_not_reminted_silently(self):
        self.run_script()
        (self.ring / "worker_key").unlink()
        code, out = self.run_script()
        self.assertEqual(code, 0, out)
        self.assertIn("--rotate worker", out)
        self.assertEqual(len(self.rows()), 5)

    def test_rotate_revokes_the_old_key_and_stores_a_new_one(self):
        self.run_script()
        old = self.ring_value("worker_key")
        code, out = self.run_script("--rotate", "worker")
        self.assertEqual(code, 0, out)
        self.assert_no_key_shown(out)
        new = self.ring_value("worker_key")
        self.assertNotEqual(old, new)
        revoked = [r for r in self.rows() if r["revoked"]]
        self.assertEqual([r["key"] for r in revoked], [old])

    def test_revoke_clears_the_keyring(self):
        self.run_script()
        code, out = self.run_script("--revoke", "ezyai")
        self.assertEqual(code, 0, out)
        self.assertIsNone(self.ring_value("ezyai_key"))
        self.assertTrue(next(r for r in self.rows() if r["key_prefix"].startswith("twk_ezyai"))["revoked"])

    def test_list_masks_keys(self):
        self.run_script()
        code, out = self.run_script("--list")
        self.assertEqual(code, 0, out)
        self.assert_no_key_shown(out)

    def test_cli_failure_is_reported_with_keys_masked(self):
        code, out = self.run_script(extra_env={"FAKE_FAIL": "1"})
        self.assertNotEqual(code, 0)
        self.assertIn("STOPPED", out)
        self.assertNotIn("deadbeef" * 4, out)

    def test_unknown_who_is_refused(self):
        code, out = self.run_script("--rotate", "bob")
        self.assertNotEqual(code, 0)
        self.assertIn("abdul, worker, ezyai, viewer or sales", out)


if __name__ == "__main__":
    unittest.main()
