"""The Friday scorecard renderer draws a real PNG (P1/Phase 2).

Pillow is an optional extra, so these skip where it is not installed (CI).
Run locally with:  cd workers/pc && python3 -m unittest test_scorecard -v
"""
import tempfile
import unittest
from pathlib import Path

try:
    import PIL  # noqa: F401
    HAVE_PIL = True
except ImportError:  # pragma: no cover - CI without the studio extras
    HAVE_PIL = False

SAMPLE = {
    "week_start": "2026-10-05",
    "channel_members": 1284,
    "net_joins": 37,
    "signals_posted": 9,
    "results_posted": 9,
    "strict_win_rate_4w": 67,
    "total_r_4w": 8.4,
    "tiktok_followers": 4210,
    "vantage_first_time_depositors": 3,
}


@unittest.skipUnless(HAVE_PIL, "Pillow (studio extras) not installed")
class ScorecardTest(unittest.TestCase):
    def test_render_writes_a_png(self):
        from studio import scorecard

        with tempfile.TemporaryDirectory() as d:
            info = scorecard.render(SAMPLE, week="2026-10-05", out_dir=d)
            out = Path(info["path"])
            self.assertTrue(out.exists())
            self.assertEqual(out.suffix, ".png")
            self.assertEqual(info["width"], scorecard.WIDTH)
            self.assertEqual(info["height"], scorecard.HEIGHT)
            self.assertGreater(info["bytes"], 1000)
            self.assertEqual(out.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_missing_keys_render_as_a_dash_not_a_crash(self):
        from studio import scorecard

        with tempfile.TemporaryDirectory() as d:
            info = scorecard.render({}, week="2026-10-05", out_dir=d)
            self.assertTrue(Path(info["path"]).exists())

    def test_the_colours_follow_the_sign(self):
        from studio import scorecard

        self.assertEqual(scorecard._colour("total_r_4w", 8.4, "r"), scorecard.GREEN)
        self.assertEqual(scorecard._colour("total_r_4w", -2.0, "r"), scorecard.RED)
        self.assertEqual(scorecard._colour("strict_win_rate_4w", 67, "pct"), scorecard.GREEN)
        self.assertEqual(scorecard._colour("strict_win_rate_4w", 40, "pct"), scorecard.RED)
        self.assertEqual(scorecard._colour("net_joins", None, "signed"), scorecard.MUTED)

    def test_formatting(self):
        from studio import scorecard

        self.assertEqual(scorecard._fmt(1284, "int"), "1,284")
        self.assertEqual(scorecard._fmt(37, "signed"), "+37")
        self.assertEqual(scorecard._fmt(-4, "signed"), "-4")
        self.assertEqual(scorecard._fmt(67, "pct"), "67%")
        self.assertEqual(scorecard._fmt(8.4, "r"), "+8.4R")
        self.assertEqual(scorecard._fmt(None, "int"), "–")


if __name__ == "__main__":
    unittest.main()
