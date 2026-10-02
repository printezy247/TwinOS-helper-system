"""studio/clipper.py (pure parts) and studio/layouts.py: no ffmpeg, no GPU, no files."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from studio import clipper, layouts, moments


def seg(start, end, text):
    return {"start": float(start), "end": float(end), "text": text}


class PickHighlights(unittest.TestCase):
    def test_a_keyword_run_of_at_least_30_seconds_becomes_a_clip(self):
        segs = [seg(0, 10, "hello everyone"), seg(10, 25, "today the gold zone is 4590"), seg(25, 45, "stop goes below it"), seg(45, 50, "bye")]
        picks = clipper.pick_highlights(segs, 5)
        self.assertEqual(len(picks), 1)
        self.assertEqual(picks[0]["start"], 10.0)
        self.assertGreaterEqual(picks[0]["end"] - picks[0]["start"], 30.0)
        self.assertEqual(picks[0]["cover"], "today the gold zone")

    def test_a_clip_never_runs_past_60_seconds(self):
        segs = [seg(i * 10, i * 10 + 10, "gold level") for i in range(12)]
        for p in clipper.pick_highlights(segs, 5):
            self.assertLessEqual(p["end"] - p["start"], 60.0)

    def test_a_keyword_burst_shorter_than_30_seconds_is_not_a_clip(self):
        self.assertEqual(clipper.pick_highlights([seg(0, 12, "gold zone"), seg(12, 20, "hello")], 5), [])

    def test_max_clips_caps_the_picks(self):
        segs = [seg(i * 35, i * 35 + 35, "gold zone") for i in range(10)]
        self.assertEqual(len(clipper.pick_highlights(segs, 3)), 3)

    def test_no_keyword_no_clip(self):
        self.assertEqual(clipper.pick_highlights([seg(0, 60, "just chatting about lunch")], 5), [])


class Srt(unittest.TestCase):
    def test_times_are_shifted_to_the_clip_start_and_formatted(self):
        out = clipper.srt([seg(100, 103.5, "first"), seg(103.5, 3700.25, "second")], offset=100.0)
        self.assertIn("1\n00:00:00,000 --> 00:00:03,500\nfirst", out)
        self.assertIn("2\n00:00:03,500 --> 01:00:00,250\nsecond", out)

    def test_a_segment_before_the_offset_clamps_to_zero(self):
        self.assertIn("00:00:00,000 -->", clipper.srt([seg(5, 8, "x")], offset=10.0))


class FilterGraphs(unittest.TestCase):
    def test_every_layout_ends_in_a_1080_by_1920_video_labelled_v(self):
        for name in layouts.LAYOUTS:
            g = layouts.filter_graph(name)
            self.assertTrue(g.endswith("[v]"), name)
            self.assertIn("1080", g, name)
            self.assertIn("1920", g, name)

    def test_chart_full_fits_the_width_with_bars(self):
        g = layouts.filter_graph("chart_full")
        self.assertIn("scale=1080:-2", g)
        self.assertIn("pad=1080:1920", g)

    def test_blurred_fill_blurs_a_cropped_copy_behind_the_chart(self):
        g = layouts.filter_graph("blurred_fill")
        self.assertIn("boxblur", g)
        self.assertIn("overlay", g)
        self.assertIn("crop=1080:1920", g)

    def test_chart_face_stacks_the_chart_over_the_face_crop(self):
        g = layouts.filter_graph("chart_face", face_box=(1400, 600, 480, 360))
        self.assertIn("crop=480:360:1400:600", g)
        self.assertIn("vstack", g)

    def test_chart_face_without_a_box_uses_the_lower_right_quarter_of_the_frame(self):
        g = layouts.filter_graph("chart_face")
        self.assertIn("crop=iw/2:ih/2:iw/2:ih/2", g)

    def test_a_bad_face_box_or_an_unknown_layout_is_refused(self):
        with self.assertRaises(ValueError):
            layouts.filter_graph("chart_face", face_box=(0, 0, 0, 10))
        with self.assertRaises(ValueError):
            layouts.filter_graph("chart_face", face_box=(-5, 0, 100, 100))
        with self.assertRaises(ValueError):
            layouts.filter_graph("nope")


class Commands(unittest.TestCase):
    def test_clip_command_cuts_then_applies_the_layout(self):
        cmd = layouts.clip_command("ffmpeg", "/in/live.mp4", 12.5, 48.0, "/out/clip_1.mp4", "blurred_fill")
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-filter_complex", cmd)
        self.assertEqual(cmd[cmd.index("-ss") + 1], "12.50")
        self.assertEqual(cmd[cmd.index("-to") + 1], "48.00")
        self.assertEqual(cmd[cmd.index("-map") + 1], "[v]")
        self.assertEqual(cmd[-1], "/out/clip_1.mp4")
        self.assertIn("0:a?", cmd)  # audio kept when the source has it

    def test_end_card_text_is_escaped_for_drawtext(self):
        cmd = layouts.end_card_command("ffmpeg", "Not advice: 100% yours' own", "/out/card.mp4", seconds=3)
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("drawtext=", vf)
        self.assertNotIn("advice: 100%", vf)           # raw colon / percent would break the filter
        self.assertIn("\\:", vf)
        self.assertIn("\\%", vf)
        self.assertIn("anullsrc", " ".join(cmd))        # a silent track so the card can be joined
        self.assertEqual(cmd[-1], "/out/card.mp4")

    def test_joining_a_card_on_the_end_is_one_concat(self):
        cmd = layouts.append_card_command("ffmpeg", "/out/clip_1.mp4", "/out/card.mp4", "/out/clip_1_card.mp4")
        g = cmd[cmd.index("-filter_complex") + 1]
        self.assertIn("concat=n=2:v=1:a=1", g)
        self.assertEqual(cmd[-1], "/out/clip_1_card.mp4")


class RunWiring(unittest.TestCase):
    """clipper.run with ffmpeg and the GPU model replaced by stand-ins."""

    def run_clipper(self, **kw):
        calls = []
        segs = [seg(0, 40, "today gold zone is here"), seg(40, 80, "stop goes below it")]
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "live.mp4"
            src.write_bytes(b"x")
            with mock.patch.object(clipper, "_ffmpeg", return_value="ffmpeg"), \
                 mock.patch.object(clipper, "transcribe", return_value=segs), \
                 mock.patch.object(clipper.subprocess, "run", side_effect=lambda argv, **_: calls.append(list(argv))):
                result = clipper.run(src, max_clips=1, **kw)
            manifest = (Path(d) / "clips" / "live" / "clips.json").read_text()
        return calls, result, manifest

    def test_without_a_layout_the_clip_is_a_plain_cut_as_before(self):
        calls, result, _ = self.run_clipper()
        self.assertEqual(result["clips"], 1)
        self.assertFalse(any("-filter_complex" in c for c in calls))

    def test_a_layout_is_applied_to_each_clip(self):
        calls, _, manifest = self.run_clipper(layout="blurred_fill")
        graphs = [c[c.index("-filter_complex") + 1] for c in calls if "-filter_complex" in c]
        self.assertEqual(len(graphs), 1)
        self.assertIn("boxblur", graphs[0])
        self.assertIn('"layout": "blurred_fill"', manifest)

    def test_an_end_card_is_made_once_and_joined_on_every_clip(self):
        calls, _, manifest = self.run_clipper(layout="chart_full", end_text="Not financial advice.")
        self.assertEqual(sum(1 for c in calls if any("drawtext=" in a for a in c)), 1)
        self.assertEqual(sum(1 for c in calls if any("concat=n=2" in a for a in c)), 1)
        self.assertIn('"end_card": true', manifest)

    def test_a_bad_layout_stops_before_any_ffmpeg_call(self):
        calls = []
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "live.mp4"
            src.write_bytes(b"x")
            with mock.patch.object(clipper, "_ffmpeg", return_value="ffmpeg"), \
                 mock.patch.object(clipper.subprocess, "run", side_effect=lambda argv, **_: calls.append(list(argv))):
                with self.assertRaises(ValueError):
                    clipper.run(src, layout="nope")
        self.assertEqual(calls, [])


class WordCaptions(unittest.TestCase):
    def test_word_timings_become_ass_events_shifted_by_the_clip_start(self):
        segs = [seg(70, 73, "gold held the zone")]
        segs[0]["words"] = [
            {"start": 70.0, "end": 70.5, "word": "gold"},
            {"start": 70.5, "end": 71.2, "word": "held"},
        ]
        ass = clipper.ass_words(segs, offset=70.0)
        self.assertIn("[Script Info]", ass)
        self.assertIn("Dialogue:", ass)
        self.assertIn("gold", ass)
        # gold 70.0-70.5 and held 70.5-71.2, shifted by the 70.0 clip start:
        # the word events carry 0:00:00.50 and 0:00:01.20, never the raw times.
        self.assertIn("0:00:00.50", ass)
        self.assertIn("0:00:00.00,0:00:00.50", ass)
        self.assertIn("0:00:00.50,0:00:01.20", ass)
        self.assertNotIn("0:01:1", ass)  # unshifted 70 s never leaks through

    def test_without_word_timings_the_segment_text_still_captions(self):
        ass = clipper.ass_words([seg(10, 12, "risk one percent")], offset=10.0)
        self.assertIn("risk one percent", ass)
        self.assertIn("Dialogue:", ass)

    def test_negative_times_are_clamped_to_zero(self):
        segs = [seg(0, 2, "hello")]
        segs[0]["words"] = [{"start": 0.2, "end": 0.9, "word": "hello"}]
        ass = clipper.ass_words(segs, offset=0.5)
        self.assertIn("0:00:00.00", ass)


class CoverThumbnail(unittest.TestCase):
    def test_the_cover_grabs_a_frame_and_draws_the_hook_text(self):
        cmd = moments.cover_command("ffmpeg", "/tmp/live.mp4", 72.5, "/tmp/cover.jpg", "Gold held 4590")
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("72.50", cmd)
        self.assertIn("drawtext", " ".join(cmd))
        self.assertIn("4590", " ".join(cmd))
        self.assertEqual(cmd[-1], "/tmp/cover.jpg")

    def test_the_text_is_escaped_so_a_quote_cannot_break_the_filter(self):
        # ffmpeg does not honour \' inside a quoted drawtext value, and reads
        # ':' and '%' as syntax: the same escaping as the layout overlays.
        cmd = moments.cover_command("ffmpeg", "/tmp/live.mp4", 1, "/tmp/cover.jpg", "Don't chase: 50% off")
        vf = cmd[cmd.index("-vf") + 1]
        self.assertIn("Don’t chase\\: 50\\% off", vf)
        self.assertEqual(vf.count("'"), 2, vf)  # only the two quotes around the text


if __name__ == "__main__":
    unittest.main()
