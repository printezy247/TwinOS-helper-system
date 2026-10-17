import { assertEquals } from "std/assert/mod.ts";
import { bucketByDay, startOfDayInTz, weekStartMyt } from "./time.ts";

const MYT = "Asia/Kuala_Lumpur"; // UTC+8, no DST
const UTC = "UTC";

Deno.test("MYT midnight is 16:00Z the day before", () => {
  assertEquals(startOfDayInTz(MYT, new Date("2026-10-02T08:00:00Z")), "2026-10-01T16:00:00.000Z");
});

Deno.test("a late-evening UTC instant belongs to the next MYT day", () => {
  // 20:00Z on 1 Oct is 04:00 MYT on 2 Oct, so the day started 16:00Z on 1 Oct.
  assertEquals(startOfDayInTz(MYT, new Date("2026-10-01T20:00:00Z")), "2026-10-01T16:00:00.000Z");
});

Deno.test("just before and just after MYT midnight land on different days", () => {
  const before = startOfDayInTz(MYT, new Date("2026-10-01T15:59:59Z")); // 23:59:59 MYT 1 Oct
  const after = startOfDayInTz(MYT, new Date("2026-10-01T16:00:01Z"));  // 00:00:01 MYT 2 Oct
  assertEquals(before, "2026-09-30T16:00:00.000Z");
  assertEquals(after, "2026-10-01T16:00:00.000Z");
});

Deno.test("UTC midnight is just that", () => {
  assertEquals(startOfDayInTz(UTC, new Date("2026-10-02T08:00:00Z")), "2026-10-02T00:00:00.000Z");
});

Deno.test("weekStartMyt is Monday 00:00 Malaysia time (Sunday 16:00Z)", () => {
  // Wed 2026-10-07 03:30 MYT (Mon 19:30Z) belongs to the week of Mon 5 Oct.
  assertEquals(weekStartMyt(new Date("2026-10-06T19:30:00Z")).toISOString(), "2026-10-04T16:00:00.000Z");
});

Deno.test("weekStartMyt rolls over at Monday 00:00 local, not at UTC midnight", () => {
  // Sunday 2026-10-11 23:00 MYT is still the old week.
  assertEquals(weekStartMyt(new Date("2026-10-11T15:00:00Z")).toISOString(), "2026-10-04T16:00:00.000Z");
  // Monday 2026-10-12 01:00 MYT (Sunday 17:00Z) is already the new week:
  // the old UTC-based counter would have kept the old week here.
  assertEquals(weekStartMyt(new Date("2026-10-11T17:00:01Z")).toISOString(), "2026-10-11T16:00:00.000Z");
});

Deno.test("bucketByDay: 23:30 MYT lands on the next MYT day, not the caller's", () => {
  // Monday 5 Oct 2026 00:00 MYT is 2026-10-04T16:00Z.
  const from = "2026-10-04T16:00:00.000Z";
  const rows = [
    { at: "2026-10-05T02:00:00.000Z", id: "early-myt" }, // Mon 05 Oct, 10:00 MYT
    { at: "2026-10-05T15:30:00.000Z", id: "late-myt" },  // Mon 05 Oct, 23:30 MYT
    { at: "2026-10-05T16:30:00.000Z", id: "next-day" },  // Tue 06 Oct, 00:30 MYT
  ];
  const days = bucketByDay(MYT, rows, { from, at: (r) => r.at });
  assertEquals(days.length, 7);
  assertEquals(days[0].key, "2026-10-05");
  assertEquals(days[0].rows.map((r) => r.id), ["early-myt", "late-myt"]);
  assertEquals(days[1].key, "2026-10-06");
  assertEquals(days[1].rows.map((r) => r.id), ["next-day"]);
});

Deno.test("bucketByDay: the same two rows grouped for a UTC reader land the same way", () => {
  const from = "2026-10-04T16:00:00.000Z";
  // 15:30Z is 23:30 MYT on the 5th; 16:30Z is 00:30 MYT on the 6th.
  const rows = [{ at: "2026-10-05T15:30:00.000Z" }, { at: "2026-10-05T16:30:00.000Z" }];
  assertEquals(bucketByDay(MYT, rows, { from, at: (r) => r.at }).map((d) => d.rows.length), [1, 1, 0, 0, 0, 0, 0]);
  // Both are the same UTC date, which is exactly why the split is not left to
  // whatever timezone the reader's browser happens to be in.
  assertEquals(rows.map((r) => new Date(r.at).toISOString().slice(0, 10)), ["2026-10-05", "2026-10-05"]);
});

Deno.test("bucketByDay: a row outside the window is dropped, not wedged into a day", () => {
  const days = bucketByDay(MYT, [{ at: "2026-12-01T00:00:00Z" }], { from: "2026-10-04T16:00:00.000Z", at: (r) => (r as { at: string }).at });
  assertEquals(days.every((d) => d.rows.length === 0), true);
});
