"""Live recording → transcript → cut points → CapCut-ready clips (plan §9.G.55–60).

Phase 5 stub with the real pipeline shape:
  1. ffmpeg extracts 16 kHz mono audio
  2. faster-whisper (GPU) transcribes with word timestamps
  3. highlight picks: longest fluent runs that contain a map/level/lesson keyword
  4. ffmpeg cuts each pick to a clean clip (no face tracking on chart videos)
  5. SRT captions per clip + a cover text suggestion (3–5 words from the hook)

Output folder: <source dir>/clips/<stem>/ with clip_N.mp4, clip_N.srt, clips.json.
CapCut stays the editor: nothing here burns captions in (plan §5).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

try:
    from faster_whisper import WhisperModel  # type: ignore
except ImportError:  # pragma: no cover - optional
    WhisperModel = None  # type: ignore

KEYWORDS = ("gold", "xau", "level", "zone", "entry", "stop", "tp", "lesson", "risk", "map", "emas", "harga")
MIN_CLIP_S, MAX_CLIP_S = 30.0, 60.0


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not on PATH")
    return exe


def transcribe(audio: Path, lang: str) -> list[dict[str, Any]]:
    if WhisperModel is None:
        raise RuntimeError("faster-whisper not installed")
    model = WhisperModel("small", device="cuda", compute_type="int8_float16")
    segments, _ = model.transcribe(str(audio), language=lang if lang in ("en", "ms") else None, word_timestamps=True)
    return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]


def pick_highlights(segments: list[dict[str, Any]], max_clips: int) -> list[dict[str, Any]]:
    picks: list[dict[str, Any]] = []
    i = 0
    while i < len(segments) and len(picks) < max_clips:
        if not any(k in segments[i]["text"].lower() for k in KEYWORDS):
            i += 1
            continue
        start, j = segments[i]["start"], i
        while j + 1 < len(segments) and segments[j + 1]["end"] - start < MAX_CLIP_S:
            j += 1
        end = segments[j]["end"]
        if end - start >= MIN_CLIP_S:
            text = " ".join(s["text"] for s in segments[i:j + 1])
            picks.append({"start": start, "end": end, "text": text, "cover": " ".join(text.split()[:4])})
        i = j + 1
    return picks


def srt(segments: list[dict[str, Any]], offset: float) -> str:
    def ts(t: float) -> str:
        t = max(t - offset, 0.0)
        h, r = divmod(t, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"
    return "\n".join(f"{n}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n" for n, s in enumerate(segments, 1))


def run(source: Path, lang: str = "en", max_clips: int = 5) -> dict[str, Any]:
    ff = _ffmpeg()
    out = source.parent / "clips" / source.stem
    out.mkdir(parents=True, exist_ok=True)
    audio = out / "audio.wav"
    subprocess.run([ff, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)],
                   check=True, capture_output=True)
    segments = transcribe(audio, lang)
    picks = pick_highlights(segments, max_clips)
    clips = []
    for n, p in enumerate(picks, 1):
        clip = out / f"clip_{n}.mp4"
        subprocess.run([ff, "-y", "-ss", f"{p['start']:.2f}", "-to", f"{p['end']:.2f}", "-i", str(source),
                        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", str(clip)],
                       check=True, capture_output=True)
        inside = [s for s in segments if s["start"] >= p["start"] and s["end"] <= p["end"]]
        (out / f"clip_{n}.srt").write_text(srt(inside, p["start"]), encoding="utf-8")
        clips.append({"file": clip.name, "start": p["start"], "end": p["end"], "cover": p["cover"],
                      "risk_line_needed": True})  # plan §9.G.58: spoken/on-screen risk line is Jack's call in CapCut
    (out / "clips.json").write_text(json.dumps({"source": str(source), "clips": clips}, indent=2), encoding="utf-8")
    return {"out_dir": str(out), "clips": len(clips), "transcript_segments": len(segments)}
