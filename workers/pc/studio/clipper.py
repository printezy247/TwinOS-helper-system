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

from . import layouts

try:
    from faster_whisper import WhisperModel  # type: ignore
except ImportError:  # pragma: no cover - optional
    WhisperModel = None  # type: ignore

KEYWORDS = ("gold", "xau", "level", "zone", "entry", "stop", "tp", "lesson", "risk", "map", "emas", "harga")
MIN_CLIP_S, MAX_CLIP_S = 30.0, 60.0
# A hung ffmpeg must fail the job (the worker reports it), not stall the
# single-threaded loop forever: extract / small render / cut / join.
FFPROBE_TIMEOUT_S, EXTRACT_TIMEOUT_S, RENDER_TIMEOUT_S, CUT_TIMEOUT_S = 60, 600, 300, 1800


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


def ass_time(t: float) -> str:
    """ASS clock H:MM:SS.CC; a time before the clip start clamps to zero."""
    # Centiseconds from the total, not from the fractional part: rounding
    # .995 up must carry into the seconds (0:01:10.995 → 0:01:11.00), not
    # emit an out-of-range ".100" field.
    total_cs = int(round(max(t, 0.0) * 100))
    h, rem = divmod(total_cs, 3600 * 100)
    m, rem = divmod(rem, 60 * 100)
    sec, cs = divmod(rem, 100)
    return f"{h}:{m:02}:{sec:02}.{cs:02}"


def ass_words(segments: list[dict[str, Any]], offset: float = 0.0) -> str:
    """Word-level ASS captions for a clip (research 2026-10-02: burned-in
    word-by-word captions are the standard shorts treatment).

    Segments carrying faster-whisper `words` timings get one Dialogue per
    word, times shifted by the clip start; a segment without them falls back
    to one Dialogue with its text. Nothing is written to disk here.
    """
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Caption,DejaVu Sans,72,&H00FFFFFF,&H00000000,&H7F000000,-1,3,2,60,60,90,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, MarginL, MarginR, MarginV, Text\n"
    )
    lines = []
    for seg in segments:
        words = seg.get("words") or []
        if words:
            for w in words:
                text = str(w.get("word", "")).strip()
                if not text:
                    continue
                start = ass_time(float(w["start"]) - offset)
                end = ass_time(float(w["end"]) - offset)
                lines.append(f"Dialogue: 0,{start},{end},Caption,60,60,90,{text}")
        else:
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            start = ass_time(float(seg["start"]) - offset)
            end = ass_time(float(seg["end"]) - offset)
            lines.append(f"Dialogue: 0,{start},{end},Caption,60,60,90,{text}")
    return header + "\n".join(lines) + ("\n" if lines else "")


def srt(segments: list[dict[str, Any]], offset: float) -> str:
    def ts(t: float) -> str:
        t = max(t - offset, 0.0)
        h, r = divmod(t, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"
    return "\n".join(f"{n}\n{ts(s['start'])} --> {ts(s['end'])}\n{s['text']}\n" for n, s in enumerate(segments, 1))


def run(source: Path, lang: str = "en", max_clips: int = 5, layout: str | None = None,
        face_box: layouts.FaceBox | None = None, end_text: str | None = None) -> dict[str, Any]:
    """Cut the live into clips. `layout` (chart_full, chart_face, blurred_fill) makes them 1080x1920;
    `end_text` (the risk line) is made into a 3 second card and joined on every clip."""
    if layout is not None:
        layouts.filter_graph(layout, face_box)  # refuse a bad layout or face box before any work is done
    ff = _ffmpeg()
    out = source.parent / "clips" / source.stem
    out.mkdir(parents=True, exist_ok=True)
    audio = out / "audio.wav"
    subprocess.run([ff, "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)],
                   check=True, capture_output=True, timeout=EXTRACT_TIMEOUT_S)
    segments = transcribe(audio, lang)
    picks = pick_highlights(segments, max_clips)
    card = out / "end_card.mp4"
    if end_text and picks:
        subprocess.run(layouts.end_card_command(ff, end_text, str(card)), check=True, capture_output=True,
                       timeout=RENDER_TIMEOUT_S)
    clips = []
    for n, p in enumerate(picks, 1):
        clip = out / f"clip_{n}.mp4"
        if layout:
            cut = layouts.clip_command(ff, str(source), p["start"], p["end"], str(clip), layout, face_box)
        else:
            cut = [ff, "-y", "-ss", f"{p['start']:.2f}", "-to", f"{p['end']:.2f}", "-i", str(source),
                   "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", str(clip)]
        subprocess.run(cut, check=True, capture_output=True, timeout=CUT_TIMEOUT_S)
        if end_text:
            joined = out / f"clip_{n}_card.mp4"
            subprocess.run(layouts.append_card_command(ff, str(clip), str(card), str(joined)), check=True,
                           capture_output=True, timeout=CUT_TIMEOUT_S)
            if joined.exists():
                joined.replace(clip)
        inside = [s for s in segments if s["start"] >= p["start"] and s["end"] <= p["end"]]
        (out / f"clip_{n}.srt").write_text(srt(inside, p["start"]), encoding="utf-8")
        clips.append({"file": clip.name, "start": p["start"], "end": p["end"], "cover": p["cover"],
                      "layout": layout, "end_card": bool(end_text),
                      "risk_line_needed": not end_text})  # plan §9.G.58: spoken/on-screen risk line is Jack's call in CapCut
    (out / "clips.json").write_text(json.dumps({"source": str(source), "clips": clips}, indent=2), encoding="utf-8")
    return {"out_dir": str(out), "clips": len(clips), "transcript_segments": len(segments)}
