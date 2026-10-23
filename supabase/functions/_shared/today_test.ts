import { assertEquals } from "std/assert/mod.ts";
import { dayAndWeekStart, queueLines, todayLines, todaySummary } from "./today.ts";

const TZ = "Asia/Kuala_Lumpur";

Deno.test("dayAndWeekStart: KL midnight and the Monday before it", () => {
  // Saturday 3 Oct 2026, 10:00 KL = 02:00Z
  const r = dayAndWeekStart(TZ, new Date("2026-10-03T02:00:00Z"));
  assertEquals(r.day, "2026-10-02T16:00:00.000Z");
  assertEquals(r.week, "2026-09-27T16:00:00.000Z"); // Monday 28 Sep 00:00 KL
});

Deno.test("dayAndWeekStart: on a Monday the week starts today", () => {
  const r = dayAndWeekStart(TZ, new Date("2026-09-28T01:00:00Z"));
  assertEquals(r.week, r.day);
});

Deno.test("dayAndWeekStart: the offset at today's midnight, not the one at now", () => {
  // Sunday 1 Nov 2026: New York leaves DST at 06:00Z. Noon local is EST
  // (UTC-5) but midnight local was still EDT (UTC-4) — one offset for both
  // lands an hour late.
  const r = dayAndWeekStart("America/New_York", new Date("2026-11-01T12:00:00Z"));
  assertEquals(r.day, "2026-11-01T04:00:00.000Z");
});

Deno.test("todaySummary: counts, failures, next up, saved minutes", () => {
  const s = todaySummary([
    { platform: "telegram", run_at: "2026-10-03T05:00:00Z", status: "done" },
    { platform: "threads", run_at: "2026-10-03T09:00:00Z", status: "queued" },
    { platform: "instagram", run_at: "2026-10-03T07:00:00Z", status: "queued" },
    { platform: "facebook", run_at: "2026-10-03T04:00:00Z", status: "failed", last_error: "token expired" },
  ], [30, "12.5", null], 2);
  assertEquals(s.publish, { done: 1, queued: 2, failed: 1 });
  assertEquals(s.failed, [{ platform: "facebook", run_at: "2026-10-03T04:00:00Z", error: "token expired" }]);
  assertEquals(s.next.map((n) => n.platform), ["instagram", "threads"]);
  assertEquals(s.minutes_saved_week, 43);
  assertEquals(s.summary, "4 post(s) today (1 done, 2 queued, 1 failed); 2 waiting for approval; 43 min saved this week");
});

Deno.test("todaySummary: a quiet day", () => {
  assertEquals(todaySummary([], [], 0).summary, "0 post(s) today; 0 waiting for approval; 0 min saved this week");
});

// Wave 8 §3.8: the bot's /today screen shapes the same summary in KL time.
Deno.test("todayLines: posts, approvals, failures, next up, minutes saved", () => {
  const s = todaySummary([
    { platform: "telegram", run_at: "2026-10-03T05:00:00Z", status: "done" },
    { platform: "threads", run_at: "2026-10-03T09:00:00Z", status: "queued" },
    { platform: "instagram", run_at: "2026-10-03T07:00:00Z", status: "queued" },
    { platform: "facebook", run_at: "2026-10-03T04:00:00Z", status: "failed", last_error: "token expired" },
  ], [30, "12.5", null], 2);
  assertEquals(todayLines(s, TZ), [
    "📨 4 post(s) today — 1 done, 1 failed, 2 queued",
    "✅ 2 waiting for approval",
    "❌ 1 failed — facebook 12:00",
    "⏭ next — instagram 15:00, threads 17:00",
    "💾 43 min saved this week",
  ]);
});

Deno.test("todayLines: a quiet day has no failure or next line", () => {
  assertEquals(todayLines(todaySummary([], [], 0), TZ), [
    "📨 0 post(s) today",
    "✅ 0 waiting for approval",
    "💾 0 min saved this week",
  ]);
});

// Wave 8 §3.9: the bot's /queue screen, same counts as GET /jobs.
Deno.test("queueLines: one line per kind, statuses sorted, empty queue says so", () => {
  assertEquals(queueLines({}), ["Nothing queued in the last 7 days."]);
  assertEquals(
    queueLines({ llm_variants: { failed: 1, queued: 2 }, clip: { done: 4 } }),
    ["clip: 4 done", "llm_variants: 1 failed, 2 queued"],
  );
});
