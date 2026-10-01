#!/usr/bin/env python3
"""TwinOS PC worker (plan §7: outbound only, never opens a port).

Polls POST <supabase>/functions/v1/jobs/claim with a scoped key and runs the
job kinds that need Jack's PC: the drop folder, Telechurn CSV import, the
nightly backup, clipping (GPU) and research batches. Results go back through
POST /jobs/result. Standard library only; optional extras in requirements.txt
are imported lazily and guarded.

Secrets come from the keyring, never from files:

    secret-tool store --label "TwinOS url"        service twinos key url
    secret-tool store --label "TwinOS worker key" service twinos key worker_key
    secret-tool store --label "TwinOS db url"     service twinos key db_url   # for backups

Run:  python3 twinos_worker.py            (loop)
      python3 twinos_worker.py --once     (one claim, then exit)
      python3 twinos_worker.py --self-test
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("twinos-worker")

WORKER_NAME = f"{socket.gethostname()}-pc"
POLL_S = 20
IDLE_POLL_S = 60
TIMEOUT_S = 30
DROP_DIR = Path(os.environ.get("TWINOS_DROP_DIR", "~/EzyMap/out")).expanduser()
DONE_DIR = DROP_DIR / ".ingested"
BACKUP_DIR = Path(os.environ.get("TWINOS_BACKUP_DIR", "~/EzyMap/backups")).expanduser()
TELECHURN_DIR = Path(os.environ.get("TWINOS_TELECHURN_DIR", "~/EzyMap/telechurn")).expanduser()
MAX_ASSET_BYTES = 45 * 1024 * 1024
VIDEO_EXT = {".mp4", ".mov", ".webm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
KINDS = ["drop_folder_watch", "telechurn_import", "backup", "clip", "research_batch", "scorecard_image"]


# --------------------------------------------------------------------------- #
# Secrets and HTTP
# --------------------------------------------------------------------------- #
def keyring(key: str, required: bool = True) -> str:
    """`secret-tool lookup service twinos key <key>`; env TWINOS_<KEY> overrides for tests."""
    env = os.environ.get(f"TWINOS_{key.upper()}")
    if env:
        return env.strip()
    try:
        out = subprocess.run(
            ["secret-tool", "lookup", "service", "twinos", "key", key],
            capture_output=True, text=True, timeout=10, check=False,
        )
        value = out.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        value = ""
    if not value and required:
        raise SystemExit(f"keyring has no 'twinos/{key}'. See workers/pc/README.md")
    return value


class Api:
    def __init__(self) -> None:
        self.base = keyring("url").rstrip("/") + "/functions/v1"
        self._key = keyring("worker_key")
        if not self._key.startswith("twk_pc_worker_"):
            log.warning("worker key does not look like a pc_worker key (twk_pc_worker_…)")

    def call(self, path: str, body: dict[str, Any] | None = None, method: str = "POST",
             idempotency_key: str | None = None) -> tuple[int, dict[str, Any]]:
        data = json.dumps(body or {}).encode()
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
            "User-Agent": f"twinos-worker/{WORKER_NAME}",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        req = urllib.request.Request(f"{self.base}/{path.lstrip('/')}", data=data, method=method, headers=headers)
        last = "unknown"
        for attempt in range(1, 4):
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
                    return res.status, json.loads(res.read() or b"{}")
            except urllib.error.HTTPError as e:
                detail = (e.read() or b"").decode(errors="replace")[:300]
                try:
                    payload = json.loads(detail)
                except json.JSONDecodeError:
                    payload = {"error": detail}
                if e.code < 500 and e.code != 429:
                    return e.code, payload
                last = f"{e.code}: {detail}"
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = str(e)
            time.sleep(2 ** attempt)
        return 0, {"error": "unreachable", "message": last}

    def claim(self, kinds: list[str]) -> dict[str, Any] | None:
        status, body = self.call("jobs/claim", {"worker": WORKER_NAME, "kinds": kinds})
        if status != 200:
            log.warning("claim failed %s %s", status, body)
            return None
        return body.get("job")

    def result(self, job_id: str, ok: bool, result: dict[str, Any] | None = None, error: str | None = None) -> None:
        status, body = self.call("jobs/result", {"job_id": job_id, "ok": ok, "result": result or {}, "error": error})
        if status != 200:
            log.error("result post failed %s %s", status, body)

    def beat(self, status: str = "ok", **detail: Any) -> None:
        self.call("health", {"source": "pc_worker", "status": status, "detail": detail})


# --------------------------------------------------------------------------- #
# Job handlers
# --------------------------------------------------------------------------- #
def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def signed_upload(api: Api, path: Path) -> dict[str, Any]:
    """Ask for a signed upload URL, PUT the bytes, then register the asset."""
    size = path.stat().st_size
    if size > MAX_ASSET_BYTES:
        raise RuntimeError(f"{path.name} is {size} bytes; limit is 45 MB (plan §7)")
    ctype = "video/mp4" if path.suffix.lower() in VIDEO_EXT else "image/png"
    status, body = api.call("jobs/upload-url", {"filename": path.name, "content_type": ctype, "bytes": size})
    if status != 200:
        raise RuntimeError(f"upload-url refused: {status} {body}")
    req = urllib.request.Request(body["signed_url"], data=path.read_bytes(), method="PUT",
                                 headers={"Content-Type": ctype, "x-upsert": "true"})
    with urllib.request.urlopen(req, timeout=300) as res:
        if res.status not in (200, 201):
            raise RuntimeError(f"storage PUT returned {res.status}")
    digest = sha256_of(path)
    status, reg = api.call("jobs/asset", {
        "path": body["path"], "kind": "video" if ctype.startswith("video") else "image",
        "bytes": size, "sha256": digest, "meta": {"filename": path.name, "mtime": path.stat().st_mtime},
    }, idempotency_key=f"asset:{digest}")
    if status not in (200, 201):
        raise RuntimeError(f"asset register refused: {status} {reg}")
    return {"asset_id": reg.get("asset_id"), "path": body["path"], "bytes": size}


def job_drop_folder_watch(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """~/EzyMap/out: every clean export becomes an asset (plan §9.F.44)."""
    DROP_DIR.mkdir(parents=True, exist_ok=True)
    DONE_DIR.mkdir(exist_ok=True)
    done: list[dict[str, Any]] = []
    for p in sorted(DROP_DIR.iterdir()):
        if not p.is_file() or p.suffix.lower() not in VIDEO_EXT | IMAGE_EXT:
            continue
        if time.time() - p.stat().st_mtime < 30:  # still being written by CapCut
            continue
        info = signed_upload(api, p)
        shutil.move(str(p), DONE_DIR / p.name)
        done.append(info)
    return {"ingested": done}


def job_telechurn_import(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """CSV in ~/EzyMap/telechurn/<YYYY-MM-DD>.csv with columns link_name,joins,leaves,retained."""
    week = payload.get("week_start") or (date.today() - timedelta(days=date.today().weekday())).isoformat()
    path = Path(payload.get("path") or TELECHURN_DIR / f"{week}.csv").expanduser()
    if not path.exists():
        raise RuntimeError(f"no Telechurn CSV at {path}")
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append({
                "link_name": (r.get("link_name") or r.get("Link") or r.get("name") or "").strip(),
                "joins": int(float(r.get("joins") or r.get("Joins") or 0)),
                "leaves": int(float(r.get("leaves") or r.get("Leaves") or 0)),
                "retained": int(float(r.get("retained") or r.get("Retained") or 0)),
            })
    status, body = api.call("jobs/telechurn", {"week_start": week, "rows": rows})
    if status != 200:
        raise RuntimeError(f"telechurn import refused: {status} {body}")
    return {"week_start": week, "rows": len(rows)}


def job_backup(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Nightly pg_dump to ~/EzyMap/backups (plan §9.A.7). Uses `supabase db dump` if present, else pg_dump."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    out = BACKUP_DIR / f"twinos-{stamp}.sql"
    db_url = keyring("db_url", required=False)
    if shutil.which("pg_dump") and db_url:
        cmd = ["pg_dump", "--no-owner", "--no-privileges", "--schema=public", "-f", str(out), db_url]
    elif shutil.which("supabase") and db_url:
        cmd = ["supabase", "db", "dump", "--db-url", db_url, "-f", str(out)]
    else:
        raise RuntimeError("need pg_dump or supabase CLI, plus keyring twinos/db_url")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, check=False)
    if r.returncode != 0:
        # Never echo the command: it carries the connection string.
        raise RuntimeError(f"dump failed: {r.stderr.strip()[:300]}")
    subprocess.run(["gzip", "-f", str(out)], check=False)
    gz = out.with_suffix(".sql.gz")
    # Keep 14 nightly dumps.
    for old in sorted(BACKUP_DIR.glob("twinos-*.sql.gz"))[:-14]:
        old.unlink(missing_ok=True)
    return {"file": gz.name, "bytes": gz.stat().st_size if gz.exists() else 0}


def job_clip(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Live recording → transcript → cut points → CapCut-ready clips (plan §9.G). Needs studio/ extras."""
    try:
        from studio import clipper  # noqa: WPS433 (optional dependency)
    except ImportError as e:
        raise RuntimeError(f"studio extras not installed (pip install -r requirements.txt): {e}") from e
    src = Path(payload.get("source", "")).expanduser()
    if not src.exists():
        raise RuntimeError(f"source not found: {src}")
    return clipper.run(src, lang=payload.get("lang", "en"), max_clips=int(payload.get("max_clips", 5)))


def job_research_batch(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Phase 5 stub: autocomplete expansion, YouTube competition score, local-model clustering."""
    raise RuntimeError("research_batch is a Phase 5 job; not implemented yet")


def job_scorecard_image(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Phase 2: Pillow renderer (port of ASAP receipt.py). Stub until then."""
    try:
        from studio import scorecard  # noqa: WPS433
    except ImportError as e:
        raise RuntimeError(f"studio.scorecard not available: {e}") from e
    return scorecard.render(payload.get("scoreboard", {}), week=payload.get("week", ""))


HANDLERS: dict[str, Callable[[Api, dict[str, Any]], dict[str, Any]]] = {
    "drop_folder_watch": job_drop_folder_watch,
    "telechurn_import": job_telechurn_import,
    "backup": job_backup,
    "clip": job_clip,
    "research_batch": job_research_batch,
    "scorecard_image": job_scorecard_image,
}


# --------------------------------------------------------------------------- #
# Loop
# --------------------------------------------------------------------------- #
def run_one(api: Api, job: dict[str, Any]) -> None:
    kind, job_id = job.get("kind", ""), job.get("id", "")
    handler = HANDLERS.get(kind)
    if not handler:
        api.result(job_id, False, error=f"worker has no handler for {kind}")
        return
    log.info("job %s %s start", kind, job_id[:8])
    try:
        result = handler(api, job.get("payload") or {})
        api.result(job_id, True, result=result)
        log.info("job %s %s done", kind, job_id[:8])
    except Exception as e:  # noqa: BLE001 - the job must report, whatever broke
        log.exception("job %s %s failed", kind, job_id[:8])
        api.result(job_id, False, error=str(e)[:900])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true", help="claim at most one job and exit")
    ap.add_argument("--self-test", action="store_true", help="check keyring, drop folder and API reachability")
    ap.add_argument("--kinds", default=",".join(KINDS), help="comma-separated job kinds to accept")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")

    api = Api()
    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]

    if args.self_test:
        status, body = api.call("health", {"source": "pc_worker", "status": "ok", "detail": {"self_test": True}})
        print(json.dumps({"api": status, "body": body, "drop_dir": str(DROP_DIR), "drop_exists": DROP_DIR.exists(),
                          "pg_dump": bool(shutil.which("pg_dump")), "supabase_cli": bool(shutil.which("supabase")),
                          "ffmpeg": bool(shutil.which("ffmpeg"))}, indent=2))
        return 0 if status == 200 else 1

    stop = {"now": False}

    def _stop(*_: Any) -> None:
        stop["now"] = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    log.info("worker %s polling %s for %s", WORKER_NAME, api.base, kinds)
    while not stop["now"]:
        job = api.claim(kinds)
        if job:
            run_one(api, job)
            if args.once:
                break
            continue
        if args.once:
            break
        # Idle: the drop folder is local, so it is scanned without a job row.
        try:
            if DROP_DIR.exists() and any(p.suffix.lower() in VIDEO_EXT | IMAGE_EXT for p in DROP_DIR.iterdir() if p.is_file()):
                info = job_drop_folder_watch(api, {})
                if info["ingested"]:
                    log.info("drop folder: ingested %d file(s)", len(info["ingested"]))
        except Exception:  # noqa: BLE001 - keep polling whatever the folder did
            log.exception("drop folder scan failed")
        time.sleep(IDLE_POLL_S if not job else POLL_S)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
