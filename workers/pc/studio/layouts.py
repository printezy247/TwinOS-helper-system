"""Vertical layouts and the end card for the live clips (plan §9.G.57-58).

Pure ffmpeg argument builders: nothing here runs ffmpeg, so every command is
tested as data. CapCut stays the editor (plan §5); these only give it clean
1080x1920 clips to start from.

  chart_full    the chart fitted to the width, black above and below
  chart_face    the chart on top, a crop of the camera view underneath
  blurred_fill  the chart fitted to the width over a blurred, enlarged copy of itself
  end card      a black card with one short text (the risk line), joined on the end
"""

from __future__ import annotations

import textwrap

W, H = 1080, 1920
LAYOUTS = ("chart_full", "chart_face", "blurred_fill")

FaceBox = tuple[int, int, int, int]  # x, y, width, height of the face crop in the source frame


def filter_graph(layout: str, face_box: FaceBox | None = None) -> str:
    """The -filter_complex string for a layout. Always ends in the video label [v]."""
    if layout == "chart_full":
        return f"[0:v]scale={W}:-2,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black[v]"
    if layout == "blurred_fill":
        return (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=20:5[bgb];"
            f"[fg]scale={W}:-2[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2[v]"
        )
    if layout == "chart_face":
        if face_box is None:
            crop = "crop=iw/2:ih/2:iw/2:ih/2"  # the lower right quarter, where a webcam usually sits
        else:
            x, y, w, h = face_box
            if w <= 0 or h <= 0 or x < 0 or y < 0:
                raise ValueError(f"face_box must be positive x, y, width, height: {face_box}")
            crop = f"crop={w}:{h}:{x}:{y}"
        return (
            f"[0:v]split=2[c][f];"
            f"[c]scale={W}:-2[cs];"
            f"[f]{crop},scale={W}:-2[fs];"
            f"[cs][fs]vstack=inputs=2[stk];"
            f"[stk]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black[v]"
        )
    raise ValueError(f"unknown layout {layout!r}; choose one of {', '.join(LAYOUTS)}")


def clip_command(ffmpeg: str, source: str, start: float, end: float, out: str,
                 layout: str, face_box: FaceBox | None = None) -> list[str]:
    """Cut start..end out of the source and lay it out vertically."""
    return [
        ffmpeg, "-y", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", source,
        "-filter_complex", filter_graph(layout, face_box),
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ]


def _drawtext_escape(text: str) -> str:
    """drawtext reads backslash, colon and percent as syntax; an apostrophe ends its quoting."""
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("%", "\\%").replace("'", "’")


def end_card_command(ffmpeg: str, text: str, out: str, seconds: int = 3) -> list[str]:
    """A black 1080x1920 card, `seconds` long, with the text centred and a silent track."""
    wrapped = "\n".join(textwrap.wrap(text, width=26)) or text
    vf = (f"drawtext=text='{_drawtext_escape(wrapped)}':fontcolor=white:fontsize=60:"
          f"x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12")
    return [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:d={seconds}:r=30",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf", vf, "-t", str(seconds), "-shortest",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ]


def append_card_command(ffmpeg: str, clip: str, card: str, out: str) -> list[str]:
    """Join the card on the end of a clip. The clip must have an audio track (a live recording does)."""
    return [
        ffmpeg, "-y", "-i", clip, "-i", card,
        "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
    ]
