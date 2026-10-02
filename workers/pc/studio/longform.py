"""YouTube long-form from the Sunday live (plan §9.G, Phase 7).

The TikTok clips are 30 to 60 seconds; the long-form cut is one 8 to 20 minute
stretch of the live, the one with the most chart talk, plus a chapter list in
YouTube's format. Picking and chapters are pure; `run_long` is the thin wrapper
that uses ffmpeg and the GPU transcript like clipper.run does. Nothing is
uploaded: Jack posts it (YouTube is a publish kit, not a provider).
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from .clipper import KEYWORDS


def _has_keyword(text: str) -> bool:
    low = text.lower()
    return any(k in low for k in KEYWORDS)


def pick_long_form(segments: list[dict[str, Any]], min_s: float = 480.0, max_s: float = 1200.0) -> dict[str, Any] | None:
    """The window of min_s..max_s seconds with the most keyword segments (earliest on a tie). None if the talk is too short."""
    if not segments or segments[-1]["end"] - segments[0]["start"] < min_s:
        return None
    best: tuple[int, float, dict[str, Any]] | None = None
    for i, first in enumerate(segments):
        j = i
        while j + 1 < len(segments) and segments[j + 1]["end"] - first["start"] <= max_s:
            j += 1
        if segments[j]["end"] - first["start"] < min_s:
            continue
        hits = sum(1 for s in segments[i:j + 1] if _has_keyword(s["text"]))
        if best is None or hits > best[0]:
            best = (hits, first["start"], {"start": first["start"], "end": segments[j]["end"], "keyword_segments": hits})
    return best[2] if best else None


def _title(text: str) -> str:
    words = re.sub(r"[^\w\s']", "", text).split()[:5]
    title = " ".join(words)
    return title[:1].upper() + title[1:] if title else "Chapter"


def chapters(segments: list[dict[str, Any]], start: float, end: float, min_gap: int = 90) -> list[tuple[int, str]]:
    """[(seconds from the cut's start, title)]. First at 0, at least three, never closer than 10 seconds."""
    inside = [s for s in segments if s["start"] >= start and s["end"] <= end]
    if not inside:
        return [(0, "Start")]
    out: list[tuple[int, str]] = [(0, _title(inside[0]["text"]))]
    for s in inside[1:]:
        rel = int(s["start"] - start)
        if rel - out[-1][0] >= min_gap and _has_keyword(s["text"]):
            out.append((rel, _title(s["text"])))
    if len(out) < 3 and len(inside) >= 3:
        for k in (len(inside) // 3, 2 * len(inside) // 3):
            rel = int(inside[k]["start"] - start)
            if all(abs(rel - t) >= 10 for t, _ in out):
                out.append((rel, _title(inside[k]["text"])))
        out.sort(key=lambda c: c[0])
    return out


def format_chapters(chs: list[tuple[int, str]]) -> str:
    def stamp(t: int) -> str:
        h, r = divmod(int(t), 3600)
        m, s = divmod(r, 60)
        return f"{h}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"
    return "\n".join(f"{stamp(t)} {title}" for t, title in chs)


def run_long(source: Path, lang: str = "en") -> dict[str, Any]:
    """Cut the best 8-20 minutes of a live and write its chapters. Landscape, as recorded."""
    from . import clipper

    ff = clipper._ffmpeg()
    out = source.parent / "clips" / source.stem
    out.mkdir(parents=True, exist_ok=True)
    audio = out / "audio.wav"
    subprocess.run([ff, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)], check=True, capture_output=True)
    segments = clipper.transcribe(audio, lang)
    window = pick_long_form(segments)
    if window is None:
        return {"out_dir": str(out), "long_form": None, "reason": "the live is shorter than 8 minutes"}
    cut = out / "long.mp4"
    subprocess.run([ff, "-y", "-ss", f"{window['start']:.2f}", "-to", f"{window['end']:.2f}", "-i", str(source),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", str(cut)], check=True, capture_output=True)
    chs = chapters(segments, window["start"], window["end"])
    (out / "chapters.txt").write_text(format_chapters(chs) + "\n", encoding="utf-8")
    inside = [s for s in segments if s["start"] >= window["start"] and s["end"] <= window["end"]]
    (out / "long.srt").write_text(clipper.srt(inside, window["start"]), encoding="utf-8")
    (out / "long.json").write_text(json.dumps({"source": str(source), **window, "chapters": len(chs)}, indent=2), encoding="utf-8")
    return {"out_dir": str(out), "long_form": cut.name, "start": window["start"], "end": window["end"], "chapters": len(chs)}
