"""Unit tests for studio/moments.py: no ffmpeg, no model, no network."""

from __future__ import annotations

import unittest

from studio import moments


class ScenesTests(unittest.TestCase):
    LOG = (
        "[Parsed_showinfo_1 @ 0x123] n:  10 pts:  600 pts_time:10.0\n"
        "garbage line\n"
        "[Parsed_showinfo_1 @ 0x123] n:  20 pts: 1200 pts_time:20.5\n"
    )

    def test_pts_times_become_splits(self):
        self.assertEqual(moments.parse_scenes(self.LOG, 60.0), [10.0, 20.5])

    def test_splits_are_sorted_clamped_and_unique(self):
        self.assertEqual(moments.parse_scenes("[x] pts_time:99.0\n[x] pts_time:99.0\n", 60.0), [59.0])
        self.assertEqual(moments.parse_scenes("[x] pts_time:-3.0\n", 60.0), [])

    def test_the_scene_command_watches_without_writing(self):
        cmd = moments.scene_command("/tmp/live.mp4")
        joined = " ".join(cmd)
        self.assertIn("showinfo", joined)
        self.assertIn("scene", joined)
        self.assertTrue(joined.rstrip().endswith("-"), joined)


class ScoreTests(unittest.TestCase):
    SEGS = [
        {"start": 0.0, "end": 30.0, "text": "welcome everyone to the live session"},
        {"start": 30.0, "end": 70.0, "text": "stop loss gold entry here, risk one percent, my zone held"},
        {"start": 70.0, "end": 120.0, "text": "thanks for watching, bye"},
    ]

    def test_the_dense_burst_wins_with_its_reason(self):
        top = moments.score_moments(self.SEGS, scenes=[28.0], max_moments=2)
        self.assertEqual(top[0]["start"], 30.0)
        self.assertGreater(top[0]["score"], 0)
        self.assertIn("stop loss", top[0]["reason"].lower())

    def test_a_scene_cut_on_the_edge_lifts_the_score(self):
        plain = moments.score_moments(self.SEGS, scenes=[], max_moments=3)
        cut = moments.score_moments(self.SEGS, scenes=[29.0], max_moments=3)
        burst = [m for m in cut if m["start"] == 30.0][0]
        other = [m for m in plain if m["start"] == 30.0][0]
        self.assertGreater(burst["score"], other["score"])

    def test_no_keywords_no_moments(self):
        self.assertEqual(moments.score_moments([{"start": 0.0, "end": 10.0, "text": "hello"}], scenes=[]), [])


class ReframeTests(unittest.TestCase):
    def test_vertical_crop_follows_the_face_box(self):
        f = moments.reframe_filter(1920, 1080, face_box=(1400, 200, 300, 300))
        self.assertIn("1080", f)
        self.assertIn("1920", f)
        self.assertIn("1550", f)  # face centre x

    def test_without_a_box_the_centre_holds_the_chart(self):
        f = moments.reframe_filter(1920, 1080, face_box=None)
        self.assertIn("960", f)

    def test_a_bad_box_is_refused(self):
        with self.assertRaises(ValueError):
            moments.reframe_filter(1920, 1080, face_box=(0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
