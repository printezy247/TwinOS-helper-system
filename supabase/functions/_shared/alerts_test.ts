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

import { STALE_BEAT_COOLDOWN_MS, staleBeatPlan } from "./alerts.ts";

const T0 = Date.parse("2026-10-25T00:00:00Z");
const ago = (ms: number) => new Date(T0 - ms).toISOString();

Deno.test("staleBeatPlan: a newly stale source gets exactly one alert", () => {
  const p = staleBeatPlan([], ["pc_worker"], T0);
  assertEquals(p, { resolve: [], insert: ["pc_worker"], bump: [] });
});

Deno.test("staleBeatPlan: an already-open alert is bumped, not duplicated, and stays quiet inside the cooldown", () => {
  const p = staleBeatPlan([{ id: "a1", source: "ops_bot", at: ago(3600_000), repeats: 2 }], ["ops_bot"], T0);
  assertEquals(p.insert, []);
  assertEquals(p.bump, [{ id: "a1", repeats: 3, notify: false }]);
});

Deno.test("staleBeatPlan: past the cooldown the same row is bumped and notifies again", () => {
  const p = staleBeatPlan([{ id: "a1", source: "ops_bot", at: ago(STALE_BEAT_COOLDOWN_MS + 1), repeats: 0 }], ["ops_bot"], T0);
  assertEquals(p.bump, [{ id: "a1", repeats: 1, notify: true }]);
});

Deno.test("staleBeatPlan: a recovered source has its alerts resolved", () => {
  const p = staleBeatPlan(
    [{ id: "a1", source: "pc_worker", at: ago(1000), repeats: 0 }, { id: "a2", source: "pc_worker", at: ago(5000), repeats: 0 }],
    [],
    T0,
  );
  assertEquals(p.resolve.sort(), ["a1", "a2"]);
  assertEquals(p.insert, []);
  assertEquals(p.bump, []);
});

Deno.test("staleBeatPlan: old duplicates collapse onto the newest open row", () => {
  const p = staleBeatPlan(
    [
      { id: "old", source: "ops_bot", at: ago(9000_000), repeats: 0 },
      { id: "new", source: "ops_bot", at: ago(1000), repeats: 0 },
      { id: "mid", source: "ops_bot", at: ago(5000_000), repeats: 0 },
    ],
    ["ops_bot"],
    T0,
  );
  assertEquals(p.bump.map((b) => b.id), ["new"]);
  assertEquals(p.resolve.sort(), ["mid", "old"]);
});
