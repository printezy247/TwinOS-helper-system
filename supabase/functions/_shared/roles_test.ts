import { assert, assertEquals } from "std/assert/mod.ts";
import { can, PERMISSIONS } from "./roles.ts";

// EzyAI was removed: signals arrive from TradingView (tv-webhook) or are entered by hand.
Deno.test("no permission grants anything to the removed ezyai role", () => {
  const roles = new Set(Object.values(PERMISSIONS).flat() as string[]);
  assert(!roles.has("ezyai"), "ezyai must not appear in any permission list");
});

Deno.test("the EzyAI ingest action is gone and TradingView alerts still work", () => {
  assertEquals("signals.ingest" in PERMISSIONS, false);
  assert(can("tradingview", "tv.alert"));
  assert(!can("jack", "tv.alert"));
});

Deno.test("health beats still come from the remaining sources", () => {
  for (const r of ["sales_bot", "ops_bot", "pc_worker", "cron", "abdul", "jack"] as const) {
    assert(can(r, "health.beat"), `${r} must still be able to beat`);
  }
});
