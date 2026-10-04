"""Clip candidates after OpenShorts (plan §17 Wave 4 item 3): scene detection,
AI-free moment scoring, face-following vertical reframe.

Pure here; ffmpeg and faster-whisper only run inside job_clip_candidates on
Jack's PC. Candidates wait for Jack in clip_candidates and are cut only
after his Desk tap.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .layouts import _drawtext_escape  # one escaper for every drawtext overlay

KEYWORDS = (
    "stop loss", "take profit", "entry", "risk", "zone", "gold", "xauusd",
    "breakout", "bias", "liquidity", "drawdown", "lot size", "sl ", "tp ",
    "counter-trend", "counter trend", "news", "cpi", "nfp", "fomc",
)
SCENE_BONUS = 0.5
EDGE_WINDOW_S = 2.0


def scene_command(source: str | Path, exe: str = "ffmpeg") -> list[str]:
    """ffmpeg that only watches: scene splits go to stderr via showinfo."""
    return [exe, "-hide_banner", "-i", str(source),
            "-vf", "select='gt(scene,0.4)',showinfo", "-f", "null", "-"]


def parse_scenes(log: str, duration_s: float) -> list[float]:
    """pts_time: stamps from showinfo → sorted unique splits inside the file."""
    out: list[float] = []
    for m in re.finditer(r"pts_time:(-?\d+(?:\.\d+)?)", log):
        t = float(m.group(1))
        if t < 0:
            continue
        t = min(t, max(duration_s - 1.0, 0.0))
        if t not in out:
            out.append(t)
    return sorted(out)


def _hits(text: str) -> list[str]:
    low = f" {text.lower()} "
    return [k.strip() for k in KEYWORDS if k in low]


def score_moments(
    segments: list[dict[str, Any]],
    scenes: list[float] | None = None,
    max_moments: int = 5,
) -> list[dict[str, Any]]:
    """Dense keyword bursts become moments; a scene cut on the edge lifts one.

    Returns at most max_moments {start, end, score, reason}, best first.
    """
    scenes = scenes or []
    scored: list[dict[str, Any]] = []
    for s in segments:
        hits = _hits(str(s.get("text", "")))
        if not hits:
            continue
        score = float(len(hits))
        if any(abs(c - float(s.get("start", 0.0))) <= EDGE_WINDOW_S for c in scenes):
            score += SCENE_BONUS
        scored.append({
            "start": float(s.get("start", 0.0)),
            "end": float(s.get("end", 0.0)),
            "score": round(score, 2),
            "reason": f"burst: {', '.join(hits[:3])}",
        })
    scored.sort(key=lambda m: (-m["score"], m["start"]))
    return scored[:max(1, max_moments)]


def reframe_filter(frame_w: int, frame_h: int, face_box: tuple[int, int, int, int] | None) -> str:
    """Vertical 1080x1920 crop centred on the face (face-following), else centre.

    face_box is (x, y, w, h) in source pixels; the chart stays centred when
    there is no box. A degenerate box is refused, never silently centred.
    """
    if frame_w <= 0 or frame_h <= 0:
        raise ValueError(f"bad frame {frame_w}x{frame_h}")
    if face_box is not None:
        x, _y, w, _h = face_box
        if w <= 0:
            raise ValueError(f"bad face box {face_box!r}")
        cx = x + w // 2
    else:
        cx = frame_w // 2
    x_expr = f"min(max({cx}-540\\,0)\\,{max(frame_w - 1080, 0)})"
    return f"crop=1080:1920:{x_expr}:0,scale=1080:1920"


def window_cut_command(ff: str, source: str | Path, start_s: float, end_s: float, dest: str | Path) -> list[str]:
    """Cut exactly one approved window: fast seek, re-encode, nothing else."""
    if not (end_s > start_s >= 0):
        raise ValueError(f"bad window {start_s}..{end_s}")
    return [ff, "-y", "-ss", f"{start_s:.2f}", "-to", f"{end_s:.2f}", "-i", str(source),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", str(dest)]


def cover_command(ff: str, source: str | Path, at_s: float, dest: str | Path, text: str) -> list[str]:
    """Grab the moment's best frame and draw the hook text on it (cover art).

    Research 2026-10-02: clip tools score moment + face for the cover; the
    moment's top frame with the hook line burned in is the same idea without
    any model. Pure command builder; the caller runs it.
    """
    at_s = float(at_s)
    if at_s < 0:
        raise ValueError(f"bad cover time {at_s}")
    escaped = _drawtext_escape(str(text))
    vf = (
        "drawtext="
        f"text='{escaped}':"
        "fontcolor=white:fontsize=72:line_spacing=8:"
        "box=1:boxcolor=black@0.55:boxborderw=24:"
        "x=(w-text_w)/2:y=h-text_h-160"
    )
    return [ff, "-y", "-ss", f"{at_s:.2f}", "-i", str(source),
            "-frames:v", "1", "-vf", vf, "-q:v", "2", str(dest)]


def probe_duration(source: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError("ffprobe not on PATH")
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(source)],
        check=True, capture_output=True, text=True, timeout=60,
    )
    return float(out.stdout.strip())


def find_moments(source: Path, lang: str = "en", max_moments: int = 5) -> list[dict[str, Any]]:
    """Scene splits + transcript bursts → ranked moments (needs ffmpeg + model)."""
    from studio import clipper  # noqa: WPS433 (optional dependency, like job_clip)

    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not on PATH")
    duration = probe_duration(source)
    # A long or corrupt recording must fail the job, not hang the worker loop.
    proc = subprocess.run(scene_command(source, exe), capture_output=True, text=True, timeout=1800)
    scenes = parse_scenes(proc.stderr, duration)
    with tempfile.TemporaryDirectory() as d:
        audio = Path(d) / "audio.wav"
        subprocess.run([exe, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)],
                       check=True, capture_output=True, timeout=clipper.EXTRACT_TIMEOUT_S)
        segments = clipper.transcribe(audio, lang)
    return score_moments(segments, scenes, max_moments)
