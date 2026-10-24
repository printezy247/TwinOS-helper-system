import { assert, assertEquals } from "std/assert/mod.ts";
import { HEALTH_SOURCES, STALE_DEFAULT_MIN } from "./health_sources.ts";

Deno.test("health only watches sources that really report", () => {
  assertEquals([...HEALTH_SOURCES], ["ops_bot", "scheduler", "pc_worker", "poller", "abdul"]);
});

Deno.test("removed sources are not monitored (ezyai, sales_bot had only made-up beats)", () => {
  for (const gone of ["ezyai", "sales_bot"]) {
    assert(!(HEALTH_SOURCES as readonly string[]).includes(gone), `${gone} must not be a source`);
    assert(!(gone in STALE_DEFAULT_MIN), `${gone} must have no stale default`);
  }
});

Deno.test("every watched source has a stale threshold", () => {
  for (const s of HEALTH_SOURCES) assert(typeof STALE_DEFAULT_MIN[s] === "number", `${s} needs a threshold`);
});
