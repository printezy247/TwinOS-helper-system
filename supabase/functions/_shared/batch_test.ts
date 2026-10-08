import { assert, assertEquals } from "std/assert/mod.ts";
import {
  type BatchSlot, cycleWeek, mondayOf, nextMonday, planBatch, readyToApprove, runAtToInstant, slotToInstant,
  summaryLines, sweepPlan, topicTitle,
  isAlreadyOut, isEditable, isOpenBatchItem, parseNumberedEdit,
} from "./batch.ts";

const TZ = "Asia/Kuala_Lumpur";

// The channel rhythm as seeded in calendar_slots (dow 1 = Monday, null = every day).
const SLOTS: BatchSlot[] = [
  { dow: null, time_local: "13:00:00", post_type: "lesson" },
  { dow: 1, time_local: "09:00:00", post_type: "poll" },
  { dow: 3, time_local: "13:00:00", post_type: "channel_audit" },
  { dow: 6, time_local: "12:00:00", post_type: "offer" },
  // not part of the batch
  { dow: null, time_local: "08:00:00", post_type: "gold_map" },
  { dow: 5, time_local: "18:00:00", post_type: "scorecard" },
];

Deno.test("nextMonday: the Monday strictly after today, in the channel's timezone", () => {
  assertEquals(nextMonday(new Date("2026-10-07T06:30:00Z"), TZ), "2026-10-12"); // Wednesday 14:30 MYT
  assertEquals(nextMonday(new Date("2026-10-05T02:00:00Z"), TZ), "2026-10-12"); // a Monday -> the next one
  assertEquals(nextMonday(new Date("2026-10-11T10:00:00Z"), TZ), "2026-10-12"); // Sunday
  // 17:00Z on Sunday is already Monday 01:00 in KL: the next Monday is a week on
  assertEquals(nextMonday(new Date("2026-10-11T17:00:00Z"), TZ), "2026-10-19");
});

Deno.test("slotToInstant: wall-clock time in KL becomes the right UTC instant", () => {
  assertEquals(slotToInstant("2026-10-12", 1, "13:00:00", TZ), "2026-10-12T05:00:00.000Z");
  assertEquals(slotToInstant("2026-10-12", 7, "20:00", TZ), "2026-10-18T12:00:00.000Z");
});

Deno.test("planBatch: 7 lessons (5 skill + 2 Start Safe), audit, poll, offer", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ });
  assertEquals(plan.length, 10);
  assertEquals(plan.filter((i) => i.post_type === "lesson").length, 7);
  assertEquals(plan.filter((i) => i.pillar === "skill").length, 5);
  assertEquals(plan.filter((i) => i.pillar === "start_safe").length, 2);
  for (const t of ["channel_audit", "poll", "offer"]) assertEquals(plan.filter((i) => i.post_type === t).length, 1);
});

Deno.test("planBatch: numbered 1..10 in posting order, at the seeded times", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ });
  assertEquals(plan.map((i) => i.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const times = plan.map((i) => i.when);
  assertEquals(times, [...times].sort());
  assertEquals(plan[0].post_type, "poll"); // Monday 09:00
  assertEquals(plan[0].when, "2026-10-12T01:00:00.000Z");
  const audit = plan.find((i) => i.post_type === "channel_audit")!;
  assertEquals(audit.when, "2026-10-14T05:00:00.000Z"); // Wednesday 13:00 KL
  const offer = plan.find((i) => i.post_type === "offer")!;
  assertEquals(offer.when, "2026-10-17T04:00:00.000Z"); // Saturday 12:00 KL
});

Deno.test("planBatch: Start Safe on the weekend, labelled in order", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ });
  const lessons = plan.filter((i) => i.post_type === "lesson");
  assertEquals(lessons.map((l) => l.label), [
    "Lesson 1", "Lesson 2", "Lesson 3", "Lesson 4", "Lesson 5", "Start Safe 1", "Start Safe 2",
  ]);
  assertEquals(lessons.filter((l) => l.pillar === "start_safe").map((l) => l.dow), [6, 7]);
});

Deno.test("planBatch: titles come from the topics given, the rest stay open", () => {
  const plan = planBatch({
    monday: "2026-10-12", slots: SLOTS, tz: TZ,
    topics: { lesson: "where your stop goes on gold", start_safe: "3 scam red flags" },
  });
  const lessons = plan.filter((i) => i.post_type === "lesson");
  assertEquals(lessons[0].title, "where your stop goes on gold");
  assertEquals(lessons[1].title, null);
  assertEquals(lessons.find((l) => l.label === "Start Safe 1")!.title, "3 scam red flags");
  assertEquals(lessons.find((l) => l.label === "Start Safe 2")!.title, null);
});

Deno.test("planBatch: only keeps the numbers stable, so 'N: instruction' means the same thing", () => {
  const all = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ });
  const some = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ, only: ["offer", "poll"] });
  assertEquals(some.map((i) => i.post_type).sort(), ["offer", "poll"]);
  for (const i of some) assertEquals(i.n, all.find((a) => a.post_type === i.post_type)!.n);
});

Deno.test("planBatch: no second offer in a week that already has one", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ, offerAlready: true });
  assertEquals(plan.some((i) => i.post_type === "offer"), false);
  assertEquals(plan.length, 9);
});

Deno.test("planBatch: a post type with no slot is left out, not invented", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS.filter((s) => s.post_type !== "poll"), tz: TZ });
  assertEquals(plan.some((i) => i.post_type === "poll"), false);
});

Deno.test("summaryLines: one numbered line per item, with what is still open, HTML-safe", () => {
  const plan = planBatch({ monday: "2026-10-12", slots: SLOTS, tz: TZ, topics: { lesson: "stops <and> risk" } });
  const lines = summaryLines(plan, new Map([[2, ["text"]], [1, []]]), TZ);
  assertEquals(lines.length, 10);
  assert(lines[0].startsWith("1."));
  assert(lines[0].includes("Mon"));
  assert(lines[0].includes("09:00"));
  assert(lines[1].includes("needs: text"));
  assert(lines[1].includes("stops &lt;and&gt; risk"));
});

Deno.test("mondayOf: any day snaps to that week's Monday", () => {
  assertEquals(mondayOf("2026-10-14"), "2026-10-12");
  assertEquals(mondayOf("2026-10-12"), "2026-10-12");
  assertEquals(mondayOf("2026-10-18"), "2026-10-12");
});

Deno.test("cycleWeek: the 28-day TikTok calendar's week (1-4) for a Monday", () => {
  assertEquals(cycleWeek("2026-10-05"), 1); // ISO week 41
  assertEquals(cycleWeek("2026-10-12"), 2);
  assertEquals(cycleWeek("2026-10-19"), 3);
  assertEquals(cycleWeek("2026-11-02"), 1); // week 45 wraps round
});

Deno.test("topicTitle: drops the calendar's pillar prefix", () => {
  assertEquals(topicTitle("L: where your stop goes on gold"), "where your stop goes on gold");
  assertEquals(topicTitle("L (Start Safe): 3 scam red flags"), "3 scam red flags");
  assertEquals(topicTitle("no prefix here"), "no prefix here");
  assertEquals(topicTitle(null), null);
});

Deno.test("readyToApprove: only a claim-free, unblocked, complete draft", () => {
  const ok = { status: "draft", needed: [] as string[], claims: [] as string[], blocked: false };
  assertEquals(readyToApprove(ok), true);
  assertEquals(readyToApprove({ ...ok, status: "pending_approval" }), true);
  assertEquals(readyToApprove({ ...ok, needed: ["text"] }), false); // [NEEDED] means not ready
  assertEquals(readyToApprove({ ...ok, claims: ["level"] }), false); // claims are Jack's own tap
  assertEquals(readyToApprove({ ...ok, blocked: true }), false);
  assertEquals(readyToApprove({ ...ok, status: "approved" }), false);
  assertEquals(readyToApprove({ ...ok, status: "rejected" }), false);
});

Deno.test("sweepPlan: queue what is approved but unscheduled, nudge what waits, flag what was missed", () => {
  const now = new Date("2026-10-15T01:00:00Z");
  const base = { needed: [] as string[], claims: [] as string[], blocked: false, hasJob: false };
  const plan = sweepPlan([
    { id: "a", n: 1, status: "approved", when: "2026-10-16T05:00:00Z", ...base },
    { id: "b", n: 2, status: "approved", when: "2026-10-16T05:00:00Z", ...base, hasJob: true },
    { id: "c", n: 3, status: "draft", when: "2026-10-17T05:00:00Z", ...base, needed: ["text"] },
    { id: "d", n: 4, status: "pending_approval", when: "2026-10-17T05:00:00Z", ...base, claims: ["level"] },
    { id: "e", n: 5, status: "draft", when: "2026-10-18T05:00:00Z", ...base },
    { id: "f", n: 6, status: "draft", when: "2026-10-14T05:00:00Z", ...base }, // slot already gone
    { id: "g", n: 7, status: "approved", when: "2026-10-14T05:00:00Z", ...base }, // slot gone, never queued
    { id: "h", n: 8, status: "rejected", when: "2026-10-17T05:00:00Z", ...base },
  ], now);
  assertEquals(plan.enqueue, ["a"]);
  assertEquals(plan.nudge, [
    { n: 3, why: "needs text" },
    { n: 4, why: "needs your tap" },
    { n: 5, why: "ready: /batch ok" },
  ]);
  assertEquals(plan.missed, [6, 7]);
});

Deno.test("isEditable: only a draft or a post waiting for Jack can be rewritten by 'N: text'", () => {
  assertEquals(isEditable("draft"), true);
  assertEquals(isEditable("pending_approval"), true);
  for (const st of ["approved", "scheduled", "publishing", "published", "failed", "rejected"]) assertEquals(isEditable(st), false, st);
});

Deno.test("isOpenBatchItem: a batch is open while any of its posts has not gone out or been dropped", () => {
  for (const st of ["draft", "pending_approval", "approved", "scheduled"]) assertEquals(isOpenBatchItem(st), true, st);
  for (const st of ["publishing", "published", "failed", "rejected"]) assertEquals(isOpenBatchItem(st), false, st);
});

Deno.test("runAtToInstant: a naive wall clock is read in the channel timezone", () => {
  // ABDUL's "schedule 2026-10-06 07:50" means 07:50 Kuala Lumpur, not UTC.
  assertEquals(runAtToInstant("2026-10-06T07:50", TZ), "2026-10-05T23:50:00.000Z");
  assertEquals(runAtToInstant("2026-10-06 07:50:00", TZ), "2026-10-05T23:50:00.000Z");
});

Deno.test("runAtToInstant: an explicit offset is taken as written", () => {
  assertEquals(runAtToInstant("2026-10-06T07:50:00+08:00", TZ), "2026-10-05T23:50:00.000Z");
  assertEquals(runAtToInstant("2026-10-06T07:50:00Z", TZ), "2026-10-06T07:50:00.000Z");
});

Deno.test("runAtToInstant: garbage is null, not NaN", () => {
  assertEquals(runAtToInstant("not a time", TZ), null);
});

Deno.test("isAlreadyOut: only a post that is out or going out is beyond an edit", () => {
  assertEquals(isAlreadyOut("published"), true);
  assertEquals(isAlreadyOut("publishing"), true);
  // approved/scheduled stay editable: an edit holds the queued job and goes back to draft
  for (const st of ["draft", "pending_approval", "approved", "scheduled", "failed", "rejected"]) assertEquals(isAlreadyOut(st), false, st);
});

Deno.test("parseNumberedEdit: 'N: text' is an edit, a typed time is not", () => {
  assertEquals(parseNumberedEdit("3: soften it"), { n: 3, instruction: "soften it" });
  assertEquals(parseNumberedEdit("12 :  make it shorter"), { n: 12, instruction: "make it shorter" });
  assertEquals(parseNumberedEdit("2:BM"), { n: 2, instruction: "BM" });
  assertEquals(parseNumberedEdit("1: 30 pips from entry"), { n: 1, instruction: "30 pips from entry" });
  assertEquals(parseNumberedEdit("4: line one\nline two"), { n: 4, instruction: "line one\nline two" });
  assertEquals(parseNumberedEdit("10:30 meeting"), null);
  assertEquals(parseNumberedEdit("13:00"), null);
  assertEquals(parseNumberedEdit("4590: gold zone"), null);
  assertEquals(parseNumberedEdit("no number here"), null);
});
