import { assertEquals } from "std/assert/mod.ts";
import { FANOUT_STUCK_THRESHOLD, isStuckQueue } from "./fanout.ts";

Deno.test("stuck queue: the Desk hears at the threshold, not below it", () => {
  assertEquals(isStuckQueue(0), false);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD - 1), false);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD), true);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD + 10), true);
});
