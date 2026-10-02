import { assertEquals } from "std/assert/mod.ts";
import { startOfDayInTz } from "./time.ts";

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
