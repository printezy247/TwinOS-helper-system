import { assertEquals } from "std/assert/mod.ts";
import { benchmarkStats, parseCount, parsePage, snapshotsDue } from "./tme.ts";

/** HTML in the shape t.me/s/<channel> serves (synthetic text, real structure). */
function page(subs: string | null, posts: Array<{ id: number; views: string | null; at: string }>): string {
  const counter = subs === null ? "" :
    `<div class="tgme_channel_info_counter"><span class="counter_value">${subs}</span> <span class="counter_type">subscribers</span></div>
     <div class="tgme_channel_info_counter"><span class="counter_value">12</span> <span class="counter_type">photos</span></div>`;
  const msgs = posts.map((p) => `
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="somechannel/${p.id}" data-view="abc">
  <div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text">hello</div>
  <div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">
    ${p.views === null ? "" : `<span class="tgme_widget_message_views">${p.views}</span><span class="copyonly"> views</span>`}<span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/somechannel/${p.id}"><time datetime="${p.at}" class="time">00:36</time></a></span>
  </div></div></div></div></div>`).join("\n");
  return `<html><body>${counter}<section class="tgme_channel_history js-message_history">${msgs}</section></body></html>`;
}

Deno.test("parseCount reads plain numbers and K / M suffixes", () => {
  assertEquals(parseCount("101"), 101);
  assertEquals(parseCount("1 234"), 1234);
  assertEquals(parseCount("1.2K"), 1200);
  assertEquals(parseCount("12K"), 12000);
  assertEquals(parseCount("3.4M"), 3_400_000);
  assertEquals(parseCount(" 597 "), 597);
  assertEquals(parseCount(""), null);
  assertEquals(parseCount("lots"), null);
});

Deno.test("parsePage: subscribers, and each post's id, views and time", () => {
  const html = page("1.5K", [
    { id: 3046, views: "101", at: "2026-08-21T00:36:30+00:00" },
    { id: 3047, views: "1.2K", at: "2026-08-21T00:43:25+00:00" },
  ]);
  const p = parsePage(html);
  assertEquals(p.subscribers, 1500);
  assertEquals(p.posts, [
    { id: 3046, views: 101, at: "2026-08-21T00:36:30.000Z" },
    { id: 3047, views: 1200, at: "2026-08-21T00:43:25.000Z" },
  ]);
});

Deno.test("parsePage: a post with no view counter keeps views null; a page with no posts is empty", () => {
  const p = parsePage(page("597", [{ id: 5, views: null, at: "2026-08-21T00:00:00+00:00" }]));
  assertEquals(p.posts[0].views, null);
  assertEquals(parsePage("<html>This channel is private</html>"), { subscribers: null, posts: [] });
});

Deno.test("benchmarkStats: size, average views (posts with a counter), view rate and posts per day", () => {
  const posts = [
    { id: 1, views: 100, at: "2026-10-01T00:00:00.000Z" },
    { id: 2, views: 200, at: "2026-10-01T12:00:00.000Z" },
    { id: 3, views: null, at: "2026-10-02T00:00:00.000Z" }, // no counter: left out of the average
    { id: 4, views: 300, at: "2026-10-02T12:00:00.000Z" },
    { id: 5, views: null, at: "2026-10-03T00:00:00.000Z" },
    { id: 6, views: null, at: "2026-10-04T00:00:00.000Z" },
  ];
  const s = benchmarkStats({ subscribers: 1000, posts })!;
  assertEquals(s.size_members, 1000);
  assertEquals(s.avg_views, 200);
  assertEquals(s.view_rate_pct, 20);
  assertEquals(s.posts_per_day, 2); // 6 posts over a 3 day span
});

Deno.test("benchmarkStats: nothing honest to say without a subscriber count or any views", () => {
  assertEquals(benchmarkStats({ subscribers: null, posts: [{ id: 1, views: 5, at: "2026-10-01T00:00:00.000Z" }] }), null);
  assertEquals(benchmarkStats({ subscribers: 100, posts: [{ id: 1, views: null, at: "2026-10-01T00:00:00.000Z" }] }), null);
  assertEquals(benchmarkStats({ subscribers: 100, posts: [] }), null);
});

Deno.test("snapshotsDue: 1 hour, 24 hours and 7 days after a post, once each, never as a late catch-up", () => {
  const posted = "2026-10-20T00:00:00Z";
  const posts = [{ message_id: 10, posted_at: posted }];
  const due = (nowIso: string, taken: Array<{ message_id: number; offset_label: string }> = []) =>
    snapshotsDue(posts, taken, new Date(nowIso)).map((d) => d.label);
  assertEquals(due("2026-10-20T00:30:00Z"), []); // too early
  assertEquals(due("2026-10-20T01:30:00Z"), ["1h"]);
  assertEquals(due("2026-10-20T01:30:00Z", [{ message_id: 10, offset_label: "1h" }]), []); // already taken
  assertEquals(due("2026-10-20T05:00:00Z"), []); // the 1 hour window (3 h of grace) has gone
  assertEquals(due("2026-10-21T02:00:00Z"), ["24h"]);
  assertEquals(due("2026-10-27T05:00:00Z"), ["7d"]);
  assertEquals(due("2026-10-29T00:00:00Z"), []); // long gone
});

Deno.test("snapshotsDue: several posts, each judged on its own clock", () => {
  const posts = [
    { message_id: 1, posted_at: "2026-10-20T00:00:00Z" },
    { message_id: 2, posted_at: "2026-10-20T01:00:00Z" },
  ];
  const got = snapshotsDue(posts, [], new Date("2026-10-20T02:30:00Z"));
  assertEquals(got.map((g) => `${g.message_id}:${g.label}`), ["1:1h", "2:1h"]);
});
