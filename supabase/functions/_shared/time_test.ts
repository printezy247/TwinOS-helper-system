import { assertEquals } from "std/assert/mod.ts";
import { startOfDayInTz, weekStartMyt } from "./time.ts";

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
