import { assertEquals } from "std/assert/mod.ts";
import { alertAction, cooldownDue, updateFailuresExceeded } from "./alerts.ts";

Deno.test("cooldown: the first alert always sends, repeats wait out the cooldown", () => {
  const now = Date.now();
  const hour = 3600_000;
  assertEquals(cooldownDue(null, hour, now), true);
  assertEquals(cooldownDue(undefined, hour, now), true);
  assertEquals(cooldownDue(new Date(now - 5 * hour).toISOString(), hour, now), true);
  assertEquals(cooldownDue(new Date(now - 30 * 60_000).toISOString(), hour, now), false);
  assertEquals(cooldownDue("not-a-date", hour, now), true);
});

Deno.test("update failures: the Desk hears only past the threshold, not at it", () => {
  assertEquals(updateFailuresExceeded(0), false);
  assertEquals(updateFailuresExceeded(3), false);
  assertEquals(updateFailuresExceeded(4), true);
});

Deno.test("alertAction: a repeat reuses the open alert instead of opening a second one", () => {
  const now = Date.parse("2026-10-06T10:00:00Z");
  const hour = 3600_000;
  assertEquals(alertAction(null, 6 * hour, now), "insert", "nothing open yet: the first one");
  assertEquals(alertAction(undefined, 6 * hour, now), "insert");
  assertEquals(alertAction(new Date(now - hour).toISOString(), 6 * hour, now), "update",
    "inside the cooldown the Desk stays quiet and the same row grows a repeat");
  assertEquals(alertAction(new Date(now - 7 * hour).toISOString(), 6 * hour, now), "update_and_notify",
    "past the cooldown the Desk hears again — on the same row, not a new one");
  assertEquals(alertAction("not-a-date", 6 * hour, now), "update_and_notify");
});
