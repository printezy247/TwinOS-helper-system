"""Friday scorecard image — a port of the sales bot's `receipt.py` (plan §9.L).

`friday` enqueues a `scorecard_image` job; the PC worker calls
`render(scoreboard, week)` and gets back where the PNG landed. Pillow is an
optional extra (`pip install "Pillow>=10"`), imported inside `render` so the
worker still runs without it.

The palette is the one in docs/LOVABLE-KNOWLEDGE.md, so the image and the
dashboard look like the same product.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# EzyMap palette (docs/LOVABLE-KNOWLEDGE.md)
BG = (11, 15, 20)       # #0B0F14
PANEL = (18, 24, 32)    # #121820
TEXT = (230, 237, 243)  # #E6EDF3
MUTED = (139, 152, 165)  # #8B98A5
GREEN = (25, 195, 125)  # #19C37D
RED = (229, 72, 77)     # #E5484D
GOLD = (227, 179, 65)   # #E3B341

WIDTH, HEIGHT = 1080, 1350

# (key, label, kind) — kind decides formatting and colour.
ROWS: list[tuple[str, str, str]] = [
    ("channel_members", "Members", "int"),
    ("net_joins", "Net joins", "signed"),
    ("signals_posted", "Signals posted", "int"),
    ("results_posted", "Results posted", "int"),
    ("strict_win_rate_4w", "Strict win rate (4w)", "pct"),
    ("total_r_4w", "Total R (4w)", "r"),
    ("tiktok_followers", "TikTok followers", "int"),
    ("vantage_first_time_depositors", "First-time depositors", "int"),
]


def _font(size: int):
    from PIL import ImageFont

    for name in ("Inter-Regular.ttf", "Inter.ttf", "DejaVuSans.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _fmt(value: Any, kind: str) -> str:
    if value is None or value == "":
        return "–"
    if kind == "pct":
        return f"{float(value):.0f}%"
    if kind == "r":
        return f"{float(value):+.1f}R"
    if kind == "signed":
        n = int(value)
        return f"{n:+d}"
    return f"{int(value):,}"


def _colour(key: str, value: Any, kind: str):
    if value is None or value == "":
        return MUTED
    if kind == "pct":
        return GREEN if float(value) >= 50 else RED
    if kind == "r":
        return GREEN if float(value) >= 0 else RED
    if kind == "signed":
        return GREEN if int(value) >= 0 else RED
    return TEXT


def render(scoreboard: dict[str, Any] | None, week: str = "", out_dir: str | Path | None = None) -> dict[str, Any]:
    """Draw the scorecard and return {path, bytes, width, height}.

    `scoreboard` is a `v_friday_scoreboard` row (any missing key renders as –).
    """
    from PIL import Image, ImageDraw

    sb = scoreboard or {}
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)

    pad = 72
    # Header
    d.text((pad, pad), "WEEKLY SCORECARD", font=_font(34), fill=GOLD)
    d.text((pad, pad + 58), f"week of {week or sb.get('week_start') or '—'}", font=_font(40), fill=TEXT)
    d.text((pad, pad + 118), "EzyMap", font=_font(30), fill=MUTED)

    # Panel
    top = pad + 200
    bottom = HEIGHT - pad - 120
    d.rounded_rectangle([pad, top, WIDTH - pad, bottom], radius=24, fill=PANEL)

    y = top + 56
    line_h = 104
    for key, label, kind in ROWS:
        value = sb.get(key)
        d.text((pad + 48, y + 16), label, font=_font(38), fill=MUTED)
        val = _fmt(value, kind)
        f = _font(52)
        w = d.textlength(val, font=f)
        d.text((WIDTH - pad - 48 - w, y), val, font=f, fill=_colour(key, value, kind))
        y += line_h

    # Footer
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    d.text((pad, HEIGHT - pad - 78), "Past performance is not indicative of future results.", font=_font(26), fill=MUTED)
    d.text((pad, HEIGHT - pad - 40), f"Generated {stamp}", font=_font(24), fill=MUTED)

    target = Path(out_dir) if out_dir else Path("~/EzyMap/backups/scorecards").expanduser()
    target.mkdir(parents=True, exist_ok=True)
    name = f"scorecard-{(week or sb.get('week_start') or 'week')}.png"
    out = target / name
    img.save(out, "PNG")
    return {"path": str(out), "bytes": out.stat().st_size, "width": WIDTH, "height": HEIGHT}
