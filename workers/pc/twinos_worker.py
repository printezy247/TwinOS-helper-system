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
LIVES_DIR = Path(os.environ.get("TWINOS_LIVES_DIR", "~/EzyMap/lives")).expanduser()
DONE_DIR = DROP_DIR / ".ingested"
BACKUP_DIR = Path(os.environ.get("TWINOS_BACKUP_DIR", "~/EzyMap/backups")).expanduser()
TELECHURN_DIR = Path(os.environ.get("TWINOS_TELECHURN_DIR", "~/EzyMap/telechurn")).expanduser()
MAX_ASSET_BYTES = 45 * 1024 * 1024
VIDEO_EXT = {".mp4", ".mov", ".webm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# Live recordings are often OBS .mkv; they live in LIVES_DIR, not the drop folder, so VIDEO_EXT stays as it is.
LIVE_EXT = VIDEO_EXT | {".mkv", ".flv", ".ts"}
KINDS = ["drop_folder_watch", "telechurn_import", "backup", "clip", "clip_candidates", "research_batch", "scorecard_image", "llm_variants"]
LLM_ANGLES = 3


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
        # The platform gateway only admits JWTs: the public anon key gets the call
        # in, X-TwinOS-Key says who is calling (supabase/functions/_shared/auth.ts).
        self._gate = keyring("apikey", required=False) or self._key

    def call(self, path: str, body: dict[str, Any] | None = None, method: str = "POST",
             idempotency_key: str | None = None) -> tuple[int, dict[str, Any]]:
        data = json.dumps(body or {}).encode()
        headers = {
            "Authorization": f"Bearer {self._gate}",
            "apikey": self._gate,
            "X-TwinOS-Key": self._key,
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
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
                # A 200 whose body is not JSON (a captive portal, a proxy page)
                # is a retryable network failure, not a crash.
                last = str(e)
            if attempt < 3:
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
    ctype = content_type_for(path)
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


def content_type_for(path: Path) -> str:
    s = path.suffix.lower()
    if s in VIDEO_EXT:
        return "video/mp4"
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
        s, "application/octet-stream")


def check_media_path(p: Path, what: str = "job") -> Path:
    """Job payloads may name media files, but only inside the EzyMap tree.

    Jobs are enqueued by jack, abdul and cron — a buggy or prompt-injected
    ABDUL run must not send the worker hashing, probing and transcribing
    arbitrary files (or writing clips) anywhere on this PC.
    """
    resolved = p.resolve()
    roots = [Path("~/EzyMap").expanduser(), LIVES_DIR, DROP_DIR, TELECHURN_DIR, BACKUP_DIR]
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
            return resolved
        except ValueError:
            continue
    raise RuntimeError(f"{what} path is outside the EzyMap tree: {p}")


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
        dest = DONE_DIR / p.name
        if dest.exists():
            # A re-export that reuses the name must not destroy the archive.
            dest = DONE_DIR / f"{p.stem}-{int(p.stat().st_mtime)}{p.suffix}"
        shutil.move(str(p), dest)
        done.append(info)
    return {"ingested": done}


def job_telechurn_import(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """CSV in ~/EzyMap/telechurn/<YYYY-MM-DD>.csv with columns link_name,joins,leaves,retained."""
    week = payload.get("week_start") or (date.today() - timedelta(days=date.today().weekday())).isoformat()
    path = Path(payload.get("path") or TELECHURN_DIR / f"{week}.csv").expanduser()
    if payload.get("path"):
        path = check_media_path(path, "telechurn")
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
    env = dict(os.environ)
    if shutil.which("pg_dump") and db_url:
        # The URL carries the password. Hand the parts to libpq via env — env
        # is readable only by this user, while argv is world-readable in
        # /proc/<pid>/cmdline for the whole dump (up to 30 min).
        env, dbname = _pg_env_from_url(db_url)
        cmd = ["pg_dump", "--no-owner", "--no-privileges", "--schema=public", "-f", str(out), dbname]
    elif shutil.which("supabase") and db_url:
        # The CLI only accepts the URL as an argument; prefer pg_dump above.
        cmd = ["supabase", "db", "dump", "--db-url", db_url, "-f", str(out)]
    else:
        raise RuntimeError("need pg_dump or supabase CLI, plus keyring twinos/db_url")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, check=False, env=env)
    if r.returncode != 0:
        # Never echo the command: it carries the connection string.
        raise RuntimeError(f"dump failed: {r.stderr.strip()[:300]}")
    out.chmod(0o600)
    gz = out.with_suffix(".sql.gz")
    gz_run = subprocess.run(["gzip", "-f", str(out)], capture_output=True, timeout=600, check=False)
    if gz_run.returncode != 0 or not gz.exists():
        out.unlink(missing_ok=True)
        raise RuntimeError("gzip failed; the dump is not a usable backup")
    gz.chmod(0o600)
    # Keep 14 nightly dumps.
    for old in sorted(BACKUP_DIR.glob("twinos-*.sql.gz"))[:-14]:
        old.unlink(missing_ok=True)
    return {"file": gz.name, "bytes": gz.stat().st_size}


def _pg_env_from_url(db_url: str) -> tuple[dict[str, str], str]:
    """Split a postgres:// URL into PG* env vars plus a bare dbname."""
    import urllib.parse  # noqa: WPS433 - lazy like the other optional imports

    u = urllib.parse.urlsplit(db_url.strip())
    if u.scheme not in ("postgres", "postgresql") or not u.hostname:
        raise RuntimeError("keyring twinos/db_url is not a postgres:// URL")
    env = dict(os.environ)
    env["PGHOST"] = u.hostname
    if u.port:
        env["PGPORT"] = str(u.port)
    if u.username:
        env["PGUSER"] = u.username
    if u.password:
        env["PGPASSWORD"] = u.password
    dbname = (u.path or "/").lstrip("/")
    if not dbname:
        raise RuntimeError("keyring twinos/db_url has no database name")
    return env, dbname


def find_recording(directory: Path, source: str, date: str) -> Path | None:
    """The live recording for a day: a video in `directory` whose name has the date (2026-09-30 or 20260930),
    preferring one that also names the platform, then the newest."""
    if not directory.is_dir():
        return None
    compact = date.replace("-", "")
    files = [p for p in directory.iterdir()
             if p.is_file() and p.suffix.lower() in LIVE_EXT and (date in p.name or compact in p.name)]
    if not files:
        return None
    named = [p for p in files if source.lower() in p.name.lower()]
    return max(named or files, key=lambda p: p.stat().st_mtime)


def job_clip(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Live recording → transcript → cut points → CapCut-ready clips (plan §9.G). Needs studio/ extras."""
    try:
        from studio import clipper  # noqa: WPS433 (optional dependency)
    except ImportError as e:
        raise RuntimeError('studio extras not installed: pip install "faster-whisper>=1.0" "Pillow>=10"') from e
    # The file itself (path), or an older payload that put the path in `source`, else the live for that day.
    legacy = Path(str(payload.get("source", ""))).expanduser()
    if payload.get("path"):
        src = check_media_path(Path(str(payload["path"])).expanduser(), "clip")
    elif legacy.is_file():
        src = check_media_path(legacy, "clip")
    else:
        source, date = str(payload.get("source") or "tiktok"), str(payload.get("date") or "")
        found = find_recording(LIVES_DIR, source, date) if date else None
        if found is None:
            raise RuntimeError(f"no {source} recording for {date or 'that day'} in {LIVES_DIR}")
        src = found
    if not src.exists():
        raise RuntimeError(f"source not found: {src}")
    if payload.get("clip_start") is not None and payload.get("clip_end") is not None:
        # A Desk-approved candidate window: cut exactly it, no transcription.
        from studio import moments  # noqa: WPS433 (optional dependency)

        start, end = float(payload["clip_start"]), float(payload["clip_end"])
        out = src.parent / "clips" / f"{src.stem}_{int(start)}-{int(end)}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        exe = shutil.which("ffmpeg")
        if not exe:
            raise RuntimeError("ffmpeg not on PATH")
        subprocess.run(moments.window_cut_command(exe, src, start, end, out), check=True, capture_output=True)
        return {"file": out.name, "start": start, "end": end, "candidate_cut": True}
    if payload.get("longform"):
        # Sunday-live long-form (Phase 7): the best 8-20 minute window plus
        # chapters, queued with {"longform": true}. Landscape, as recorded.
        from studio import longform  # noqa: WPS433 (optional dependency)

        return longform.run_long(src, lang=str(payload.get("lang") or "en"))
    box = payload.get("face_box")
    return clipper.run(
        src, lang=payload.get("lang", "en"), max_clips=int(payload.get("max_clips", 5)),
        layout=payload.get("layout") or None, face_box=tuple(int(v) for v in box) if box else None,
        end_text=payload.get("end_text") or None,
    )


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


def build_variants_prompt(raw_lines: list[str], platforms: list[str], lang: str, angles: int = LLM_ANGLES) -> str:
    """Strict-JSON prompt for the local model (plan §17 Wave 3 item 6).

    Three angles per platform, grounded in Jack's raw lines only: the only
    numbers the draft may quote ride along, and the model is told to invent
    none. No market commentary is asked for, ever.
    """
    plats = ", ".join(platforms)
    lines = "\n".join(f"- {ln}" for ln in raw_lines)
    return (
        f"Rewrite the draft below into {angles} different angles for each of: {plats} "
        f"(language: {lang}). Keep every fact from Jack's lines; use only these "
        f"numbers and no others. Do not invent prices, percents, results or offers. "
        f"Do not add market commentary. Reply with JSON ONLY, no other text, "
        f"in exactly this shape: "
        f'{{"variants": [{{"platform": "<one of {plats}>", "angle": <1-{angles}>, "body": "<the post text>"}}]}} '
        f"with {angles} angles per platform.\nJack's lines:\n{lines}"
    )


def parse_variants(text: str, platforms: list[str], angles: int = LLM_ANGLES) -> list[dict[str, Any]]:
    """Strict parse of the model's answer: every angle per platform, bodies non-empty."""
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"llm_variants: not JSON: {e}") from e
    rows = doc.get("variants") if isinstance(doc, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("llm_variants: need a non-empty 'variants' list")
    want = {(p, a) for p in platforms for a in range(1, angles + 1)}
    got = set()
    for r in rows:
        if not isinstance(r, dict) or not isinstance(r.get("body"), str) or not r["body"].strip():
            raise ValueError("llm_variants: every variant needs a non-empty body")
        if r.get("platform") not in platforms:
            raise ValueError(f"llm_variants: unknown platform {r.get('platform')!r}")
        try:
            angle = int(r.get("angle"))
        except (TypeError, ValueError):
            raise ValueError("llm_variants: angle must be a number") from None
        got.add((r["platform"], angle))
    if got != want:
        raise ValueError(f"llm_variants: want {sorted(want)}, got {sorted(got)}")
    return [{"platform": r["platform"], "angle": int(r["angle"]), "body": r["body"].strip()} for r in rows]


def _loopback_only(url: str) -> str:
    """The model runs on Jack's PC (NeuraOS / llama-server): refuse anything but loopback."""
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError(f"llm_variants: refusing non-local model at {host or url}")
    return url.rstrip("/")


def job_llm_variants(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Wave 3 item 6: 3 angles per platform from the LOCAL model as strict JSON.

    Off by default: the Desk only enqueues this when llm_variants_enabled is
    true, so a stray job means someone turned it on. The result goes back
    through jobs/result, where the edge function runs every variant through
    compliance plus the blocking number guard before Jack ever sees it.
    """
    import urllib.parse  # noqa: WPS433 - lazy like the other optional imports

    raw_lines = [str(x) for x in (payload.get("raw_lines") or []) if str(x).strip()]
    if not raw_lines:
        raise RuntimeError("llm_variants: no raw lines to ground the angles in")
    platforms = [str(x) for x in (payload.get("platforms") or ["telegram"])]
    lang = str(payload.get("lang") or "en")
    angles = int(payload.get("angles") or LLM_ANGLES)
    base = _loopback_only(str(payload.get("llama_url") or os.environ.get("TWINOS_LLAMA_URL", "http://127.0.0.1:8080")))
    prompt = build_variants_prompt(raw_lines, platforms, lang, angles)
    req = urllib.request.Request(
        f"{base}/v1/chat/completions",
        data=json.dumps({"messages": [{"role": "user", "content": prompt}], "temperature": 0.7}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            doc = json.load(res)
    except urllib.error.URLError as e:
        raise RuntimeError(f"llm_variants: local model unreachable: {e}") from e
    text = (((doc.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    variants = parse_variants(text, platforms, angles)
    return {"variants": variants}


def job_clip_candidates(api: Api, payload: dict[str, Any]) -> dict[str, Any]:
    """Wave 4 item 3: scene splits + transcript bursts → ranked moments.

    Nothing is cut here: moments wait for Jack in clip_candidates and the
    Desk use tap queues the cut. Needs ffmpeg + faster-whisper on the PC.
    """
    try:
        from studio import moments  # noqa: WPS433 (optional dependency)
    except ImportError as e:
        raise RuntimeError('studio extras not installed: pip install "faster-whisper>=1.0" "Pillow>=10"') from e
    raw = payload.get("path")
    if raw:
        src = check_media_path(Path(str(raw)).expanduser(), "clip_candidates")
    else:
        src = None
    if src is None or not src.exists():
        source, date = str(payload.get("source") or "tiktok"), str(payload.get("date") or "")
        found = find_recording(LIVES_DIR, source, date) if date else None
        if found is None:
            raise RuntimeError(f"no {source} recording for {date or 'that day'} in {LIVES_DIR}")
        src = found
    found_moments = moments.find_moments(src, lang=str(payload.get("lang") or "en"),
                                         max_moments=int(payload.get("max_moments", 5)))
    return {"source_path": str(src), "candidates": [
        {"start_s": m["start"], "end_s": m["end"], "score": m["score"],
         "reason": m["reason"], "hook_text": None}
        for m in found_moments
    ]}


HANDLERS: dict[str, Callable[[Api, dict[str, Any]], dict[str, Any]]] = {
    "drop_folder_watch": job_drop_folder_watch,
    "telechurn_import": job_telechurn_import,
    "backup": job_backup,
    "clip": job_clip,
    "clip_candidates": job_clip_candidates,
    "research_batch": job_research_batch,
    "scorecard_image": job_scorecard_image,
    "llm_variants": job_llm_variants,
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
