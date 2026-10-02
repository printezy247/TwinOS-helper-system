import { assertEquals } from "std/assert/mod.ts";
import { cooldownDue } from "./alerts.ts";

Deno.test("cooldown: the first alert always sends, repeats wait out the cooldown", () => {
  const now = Date.now();
  const hour = 3600_000;
  assertEquals(cooldownDue(null, hour, now), true);
  assertEquals(cooldownDue(undefined, hour, now), true);
  assertEquals(cooldownDue(new Date(now - 5 * hour).toISOString(), hour, now), true);
  assertEquals(cooldownDue(new Date(now - 30 * 60_000).toISOString(), hour, now), false);
  assertEquals(cooldownDue("not-a-date", hour, now), true);
});
