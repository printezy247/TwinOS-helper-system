"""studio/longform.py: the long-form pick and the YouTube chapter list. Pure: no ffmpeg, no files."""

from __future__ import annotations

import unittest

from studio import longform


def seg(start, end, text):
    return {"start": float(start), "end": float(end), "text": text}


def talk(minutes, dense_from=None, dense_to=None):
    """One 60 second segment per minute; keyword talk only between dense_from and dense_to (minutes)."""
    out = []
    for m in range(minutes):
        dense = dense_from is not None and dense_from <= m < dense_to
        text = f"now the gold zone and the stop level number {m}" if dense else f"general chat about the week number {m}"
        out.append(seg(m * 60, m * 60 + 60, text))
    return out


class PickLongForm(unittest.TestCase):
    def test_the_window_is_between_8_and_20_minutes_and_holds_the_keyword_talk(self):
        w = longform.pick_long_form(talk(40, 10, 20))
        self.assertGreaterEqual(w["end"] - w["start"], 480)
        self.assertLessEqual(w["end"] - w["start"], 1200)
        self.assertLessEqual(w["start"], 600)
        self.assertGreaterEqual(w["end"], 1200)

    def test_a_talk_shorter_than_8_minutes_has_no_long_form(self):
        self.assertIsNone(longform.pick_long_form(talk(5, 0, 5)))

    def test_a_talk_with_no_keywords_still_gets_its_first_window(self):
        self.assertEqual(longform.pick_long_form(talk(30))["start"], 0)

    def test_an_empty_transcript_is_none(self):
        self.assertIsNone(longform.pick_long_form([]))


class Chapters(unittest.TestCase):
    def test_chapters_start_at_zero_are_at_least_three_and_spaced(self):
        chs = longform.chapters(talk(20, 2, 18), 0.0, 1200.0)
        self.assertEqual(chs[0][0], 0)
        self.assertGreaterEqual(len(chs), 3)
        for a, b in zip(chs, chs[1:]):
            self.assertGreaterEqual(b[0] - a[0], 10)
        self.assertTrue(all(title.strip() for _, title in chs))

    def test_chapter_times_are_relative_to_the_cut(self):
        chs = longform.chapters(talk(40, 10, 30), 600.0, 1800.0)
        self.assertEqual(chs[0][0], 0)
        self.assertLess(chs[-1][0], 1200)

    def test_a_title_is_a_few_words_without_punctuation(self):
        chs = longform.chapters([seg(0, 600, "Today, we look at: the gold zone! And more words after that.")], 0.0, 600.0)
        self.assertEqual(chs[0][1], "Today we look at the")

    def test_format_is_mm_ss_and_h_mm_ss_after_an_hour(self):
        text = longform.format_chapters([(0, "Intro"), (155, "The zone"), (3725, "Q and A")])
        self.assertEqual(text.splitlines(), ["00:00 Intro", "02:35 The zone", "1:02:05 Q and A"])


if __name__ == "__main__":
    unittest.main()
