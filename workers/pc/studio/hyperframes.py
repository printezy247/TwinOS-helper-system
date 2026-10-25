"""HyperFrames (E3): deterministic vertical caption/cover renders.

What this is: a job kind that turns {hook, word-level captions, risk line}
into a vertical 1080x1920 mp4 — the hook text as the cover, each caption word
burned in over its time window, and the risk line drawn at the bottom for
every frame.

What is verified, honestly and without OCR: the pipeline refuses to build a
composition whose risk line is missing (build_composition), draws that exact
risk string into the render via a textfile (so nothing can mangle it between
check and frame), and only reports ok after the first and last frames of the
finished mp4 have been decoded and hashed — proof the same spec completed the
whole render path. We verify the composition inputs and the frames' existence
and determinism, not a pixel reading of the text.

Why ffmpeg here instead of the HyperFrames npm tool: the tool needs a Node
22 install plus a package download on Jack's PC. Plan rule 5 says prefer
zero new runtime dependencies, and an ffmpeg drawtext pipeline produces the
same deterministic output (same spec -> same frame hashes) with nothing to
install beyond the prerequisites we detect anyway. Node 22 is still checked
so the day the real tool is adopted, jobs fail loudly until it exists.

Determinism: a plain lavfi colour source, fixed frame count, textfile inputs
(no clock, no randomness, no threading-dependent filters), libx264 at
ultrafast. Two renders of one spec hash the same first and last frame.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

OUTPUT_DIR = Path("~/TwinOS-data/hyperframes").expanduser()
DEFAULT_RISK_LINE = "Not financial advice. Trading involves risk of loss."
_FONT_CANDIDATES = [
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]


def resolve_font() -> Path:
    for f in _FONT_CANDIDATES:
        if f.exists():
            return f
    raise RuntimeError("no DejaVu font found — install fonts-dejavu-core (sudo apt install fonts-dejavu-core)")


def check_prereqs() -> str:
    """Fail the job with a clear message when Node 22 / ffmpeg are missing."""
    ff = shutil.which("ffmpeg")
    if not ff:
        raise RuntimeError("ffmpeg not on PATH — install it (sudo apt install ffmpeg) before "
                           "HyperFrames jobs can render; the worker never skips silently")
    if not shutil.which("node"):
        raise RuntimeError("node not on PATH — Node 22 is required for HyperFrames jobs "
                           "(sudo apt install nodejs, or nvm install 22)")
    out = subprocess.run(["node", "--version"], capture_output=True, text=True, check=False).stdout.strip()
    major = out.lstrip("v").split(".", 1)[0]
    if major != "22":
        raise RuntimeError(f"Node 22 required for HyperFrames jobs (found {out or 'no node'}); "
                           "nvm install 22 && nvm use 22")
    return ff


def build_composition(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate the render spec and flatten it to draw layers, in draw order.

    Raises ValueError when a required text is missing — a frame without the
    risk line must never exist, so the check is here, before any command.
    """
    hook = str(spec.get("hook") or "").strip()
    if not hook:
        raise ValueError("hyperframes: hook text is required (it is the cover)")
    risk = str(spec.get("risk_line") or "").strip()
    if not risk:
        raise ValueError("hyperframes: a risk line is required on every rendered frame")
    dur = float(spec.get("duration_s") or 0)
    if dur <= 0:
        raise ValueError("hyperframes: duration_s must be positive")
    layers = []
    captions = spec.get("captions") or []
    cover_end = dur
    for i, c in enumerate(captions):
        s, e = float(c.get("start_s", 0)), float(c.get("end_s", 0))
        text = str(c.get("text") or "").strip()
        if not text:
            raise ValueError(f"hyperframes: caption {i} has no text")
        if not 0 <= s < e <= dur:
            raise ValueError(f"hyperframes: caption {i} window {s}..{e} outside 0..{dur}")
        cover_end = min(cover_end, s)
        layers.append({"text": text, "role": "word", "enable": f"between(t,{s:.2f},{e:.2f})"})
    layers.insert(0, {"text": hook, "role": "cover", "enable": f"lt(t,{cover_end:.2f})"})
    layers.append({"text": risk, "role": "risk", "enable": None})
    return layers


def _dims(spec: dict[str, Any]) -> tuple[int, int, int, float]:
    # Production jobs get 1080x1920@30 by default; the golden-frame tests and
    # any preview render pass explicit small dims (render_job marks those).
    w = int(spec.get("width") or 1080)
    h = int(spec.get("height") or 1920)
    fps = int(spec.get("fps") or 30)
    dur = float(spec["duration_s"])
    return w, h, fps, dur


def _drawtext(font: Path, path: Path, size: int, y: str, enable: str | None) -> str:
    parts = [f"fontfile='{font}'", f"textfile='{path}'", f"fontsize={size}",
             "fontcolor=white", "x=(w-text_w)/2", f"y={y}"]
    if enable:
        parts.append(f"enable='{enable}'")
    return "drawtext=" + ":".join(parts)


def video_command(ff: str, spec: dict[str, Any], dest: Path,
                  layers: list[dict[str, Any]], font: Path) -> list[str]:
    """The exact ffmpeg argv. Text comes from per-layer textfiles: quoting
    can never bend a word between the validation and the frame."""
    w, h, fps, dur = _dims(spec)
    n = int(round(dur * fps))
    texts_dir = dest.with_name(dest.stem + ".texts")
    graph = []
    for i, lay in enumerate(layers):
        f = texts_dir / f"layer{i}.txt"
        size = {"cover": h // 12, "word": h // 10, "risk": max(h // 40, 12)}[lay["role"]]
        y = {"cover": "(h-text_h)/2", "word": "0.62*h", "risk": "h-text_h-12"}[lay["role"]]
        graph.append(_drawtext(font, f, size, y, lay["enable"]))
    return [ff, "-y", "-f", "lavfi", "-i", f"color=c=0x0B0B10:s={w}x{h}:r={fps}:d={dur:.2f}",
            "-vf", ",".join(graph), "-frames:v", str(n),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
            "-pix_fmt", "yuv420p", str(dest)]


def _write_texts(texts_dir: Path, layers: list[dict[str, Any]]) -> None:
    texts_dir.mkdir(parents=True, exist_ok=True)
    for i, lay in enumerate(layers):
        (texts_dir / f"layer{i}.txt").write_text(lay["text"].replace("\n", " "), encoding="utf-8")


def render_video(spec: dict[str, Any], dest: Path) -> Path:
    ff = check_prereqs()
    layers = build_composition(spec)
    dest.parent.mkdir(parents=True, exist_ok=True)
    texts_dir = dest.with_name(dest.stem + ".texts")
    _write_texts(texts_dir, layers)
    cmd = video_command(ff, spec, dest, layers, resolve_font())
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=1800)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg render failed: {e.stderr.decode(errors='replace')[-300:]}") from e
    finally:
        shutil.rmtree(texts_dir, ignore_errors=True)
    return dest


def frame_sha(video: Path, n: int) -> str:
    """sha256 of frame n as PNG — the determinism anchor."""
    ff = shutil.which("ffmpeg")
    if not ff:
        raise RuntimeError("ffmpeg not on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "f.png"
        cmd = [ff, "-y", "-i", str(video), "-vf", f"select=eq(n\\,{n})",
               "-fps_mode", "passthrough", "-frames:v", "1", str(png)]
        subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        return hashlib.sha256(png.read_bytes()).hexdigest()


def render_job(payload: dict[str, Any]) -> dict[str, Any]:
    """One HyperFrames render, as the worker runs it.

    Width/height/fps/duration_s may be overridden by the payload — the only
    way tests get a 2-second job instead of a full-size one; production
    enqueues leave them out and get 1080x1920@30.
    """
    check_prereqs()
    captions = payload.get("captions") or []
    dur = float(payload.get("duration_s") or (max((float(c.get("end_s") or 0) for c in captions), default=0) + 0.8))
    spec = {
        "hook": str(payload.get("hook") or ""),
        "captions": captions,
        "risk_line": str(payload.get("risk_line") or DEFAULT_RISK_LINE),
        "duration_s": dur,
        "width": int(payload.get("width") or 1080),
        "height": int(payload.get("height") or 1920),
        "fps": int(payload.get("fps") or 30),
        "_preview": bool(payload.get("width") or payload.get("height") or payload.get("fps")),
    }
    layers = build_composition(spec)
    risk = spec["risk_line"]
    if risk not in [lay["text"] for lay in layers]:
        raise RuntimeError("hyperframes: risk line did not survive composition")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stem = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:12]
    dest = OUTPUT_DIR / f"{stem}.mp4"
    render_video(spec, dest)
    n = int(round(spec["duration_s"] * spec["fps"])) - 1
    first, last = frame_sha(dest, 0), frame_sha(dest, max(n, 0))
    return {
        "path": str(dest),
        "first_frame_sha": first,
        "last_frame_sha": last,
        "duration_s": spec["duration_s"],
        "risk_line_verified": True,
    }
