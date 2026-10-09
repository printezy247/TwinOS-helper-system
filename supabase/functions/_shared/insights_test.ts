import { assert, assertEquals } from "std/assert/mod.ts";
import { bestHours, channelStage, channelStale, CHANNEL_STALE_MS, engagementRate, feedStale, FEED_STALE_MS, hookWinner } from "./insights.ts";

Deno.test("channel stage: a heads-up at 30 h, the alert at 36 h", () => {
  // The nudge exists so the quiet mark never surprises anyone: Jack hears
  // "queue something" while there is still time, not after the fade.
  const posted = "2026-10-01T00:00:00Z";
  const at = (hours: number) => Date.parse(posted) + hours * 3600_000;
  assertEquals(channelStage(posted, at(29)), "fresh");
  assertEquals(channelStage(posted, at(31)), "nudge");
  assertEquals(channelStage(posted, at(30.5)), "nudge");
  assertEquals(channelStage(posted, at(37)), "quiet");
  // Nothing ever posted: stale by the helper's contract; the caller treats
  // "never used" as setup, not an outage.
  assertEquals(channelStage(null, at(1)), "quiet");
});

Deno.test("bestHours: the hours with the most views come first, ties by hour", () => {
  assertEquals(bestHours([
    { hour: 8, views: 400 },
    { hour: 13, views: 900 },
    { hour: 19, views: 900 },
    { hour: 3, views: 50 },
  ], 2), [13, 19]);
  assertEquals(bestHours([], 2), []);
  assertEquals(bestHours([{ hour: 8, views: 10 }], 5), [8]);
});

Deno.test("engagementRate: views over members as a percentage, honest about missing halves", () => {
  assertEquals(engagementRate(120, 600), 20);
  assertEquals(engagementRate(1, 3), 33.3);
  assertEquals(engagementRate(null, 600), null);
  assertEquals(engagementRate(120, 0), null);
  assertEquals(engagementRate(120, null), null);
});

Deno.test("hookWinner: the hook whose posts got the most views wins, at least two uses", () => {
  assertEquals(hookWinner([
    { hook_id: 1, views: 300 },
    { hook_id: 1, views: 500 }, // avg 400
    { hook_id: 2, views: 500 },
    { hook_id: 2, views: 100 }, // avg 300
    { hook_id: 3, views: 900 }, // one use only: not enough evidence
    { hook_id: null, views: 5000 }, // untracked hooks never win
  ]), 1);
  assertEquals(hookWinner([{ hook_id: 1, views: 100 }]), null);
  assertEquals(hookWinner([]), null);
});

Deno.test("channelStale: quiet past the gap pages, inside it stays quiet, never posted always pages", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assertEquals(channelStale(new Date(now - 35 * 3600_000).toISOString(), now, CHANNEL_STALE_MS), false);
  assertEquals(channelStale(new Date(now - 37 * 3600_000).toISOString(), now, CHANNEL_STALE_MS), true);
  assertEquals(channelStale(null, now, CHANNEL_STALE_MS), true);
  assertEquals(channelStale("not-a-date", now, CHANNEL_STALE_MS), true);
  assert(channelStale(new Date(now - 37 * 3600_000).toISOString(), now) === true);
});

Deno.test("feedStale: a 6-hourly feed that has not reported in 12 hours is stale", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  assertEquals(feedStale(new Date(now - 11 * 3600_000).toISOString(), now, FEED_STALE_MS), false);
  assertEquals(feedStale(new Date(now - 13 * 3600_000).toISOString(), now, FEED_STALE_MS), true);
  assertEquals(feedStale(null, now, FEED_STALE_MS), true, "never fetched is stale, not healthy");
  assertEquals(feedStale("yesterday", now, FEED_STALE_MS), true);
});
