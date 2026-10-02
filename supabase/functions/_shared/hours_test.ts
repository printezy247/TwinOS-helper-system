import { assertEquals } from "std/assert/mod.ts";
import { formatMinutes, HOUR_TASKS, mondayOf, parseHoursCommand, fanoutLine, hoursCutLine } from "./hours.ts";

Deno.test("/hours <task> <minutes> logs it", () => {
  assertEquals(parseHoursCommand("/hours map 45"), { kind: "log", task: "map", minutes: 45, note: null });
});

Deno.test("a note is kept, spaces and all", () => {
  assertEquals(parseHoursCommand("/hours tiktok_replies 20 answered 12 DMs"), {
    kind: "log", task: "tiktok_replies", minutes: 20, note: "answered 12 DMs",
  });
});

Deno.test("/hours and /hours today both mean today", () => {
  assertEquals(parseHoursCommand("/hours").kind, "today");
  assertEquals(parseHoursCommand("/hours today").kind, "today");
  assertEquals(parseHoursCommand("/hours@EzyOps_bot today").kind, "today");
});

Deno.test("an unknown task is refused with the vocabulary", () => {
  const r = parseHoursCommand("/hours emails 30");
  assertEquals(r.kind, "bad");
  if (r.kind === "bad") assertEquals(r.error.includes("unknown task"), true);
});

Deno.test("minutes must be a whole number", () => {
  assertEquals(parseHoursCommand("/hours map").kind, "bad");
  assertEquals(parseHoursCommand("/hours map abc").kind, "bad");
  assertEquals(parseHoursCommand("/hours map -5").kind, "bad");
  assertEquals(parseHoursCommand("/hours map 12.5").kind, "bad");
  // zero is a real answer, not a missing field
  assertEquals(parseHoursCommand("/hours map 0"), { kind: "log", task: "map", minutes: 0, note: null });
});

Deno.test("every task in the 0001 vocabulary is accepted", () => {
  for (const t of HOUR_TASKS) {
    assertEquals(parseHoursCommand(`/hours ${t} 10`).kind, "log", t);
  }
});

Deno.test("the week starts on Monday", () => {
  assertEquals(mondayOf("2026-10-05"), "2026-10-05"); // a Monday
  assertEquals(mondayOf("2026-10-02"), "2026-09-28"); // Friday -> that Monday
  assertEquals(mondayOf("2026-10-04"), "2026-09-28"); // Sunday -> the same Monday
  assertEquals(mondayOf("2026-10-11"), "2026-10-05"); // next Sunday
});

Deno.test("minutes format for a human", () => {
  assertEquals(formatMinutes(45), "45m");
  assertEquals(formatMinutes(60), "1h 00m");
  assertEquals(formatMinutes(185), "3h 05m");
  assertEquals(formatMinutes(0), "0m");
});

Deno.test("hoursCutLine: what TwinOS saved against the baseline week, as a percentage", () => {
  assertEquals(hoursCutLine(600, 360), "Hours: TwinOS saved *6.0h* against a *10.0h* baseline week, a *60%* cut.");
  assertEquals(hoursCutLine(600, 0), "Hours: TwinOS saved *0.0h* against a *10.0h* baseline week, a *0%* cut.");
  assertEquals(hoursCutLine(0, 120), null); // no baseline logged: nothing honest to compare with
  assertEquals(hoursCutLine(-5, 120), null);
});

Deno.test("hoursCutLine: a cut over 100% is shown as it is, never clipped", () => {
  assertEquals(hoursCutLine(100, 150), "Hours: TwinOS saved *2.5h* against a *1.7h* baseline week, a *150%* cut.");
});

Deno.test("fanoutLine: how many posts reached every platform this week", () => {
  assertEquals(fanoutLine(3, 2), "All platforms posted: *2 of 3* posts reached every platform.");
  assertEquals(fanoutLine(1, 1), "All platforms posted: *1 of 1* posts reached every platform.");
  assertEquals(fanoutLine(0, 0), null); // nothing was fanned out
});
