/**
 * B4 — contract test for the health payload.
 *
 * The dashboard reads a fixed set of keys out of GET /health, GET /health/today
 * and GET /health/stats. A rename on the backend must fail HERE, at the gate,
 * instead of silently blanking a tile. Two enforcement layers:
 *
 *  1. compile-time: every payload type's keys are listed exactly in the
 *     coverage objects below; `deno check` fails if a key is added, renamed or
 *     dropped on either side.
 *  2. runtime: the pure builders (todaySummary, summarizeRoutes, queueWatch)
 *     are called with fixtures and their key sets asserted.
 */
import { assertEquals } from "std/assert/mod.ts";
import {
  HEALTH_GET_KEYS,
  HEALTH_STATS_KEYS,
  HEALTH_TODAY_KEYS,
  type HealthGetPayload,
  type HealthStatsPayload,
  type QueueWatch,
  type RequestStatRow,
  summarizeRoutes,
  queueWatch,
} from "./health_contract.ts";
import { todaySummary } from "./today.ts";

/* ---- compile-time key pins: a rename breaks `deno check`, not the dashboard ---- */

// The keys the client types (mirror-hub/src/lib/health.tsx HealthData and
// lib/queries.ts TodayData) read. One entry per key, so an extra or renamed
// key on the backend is a missing/unknown property here.
const _getCoverage: Record<keyof HealthGetPayload, true> = {
  ok: true,
  summary: true,
  beats: true,
  tokens: true,
  integrations: true,
  providers: true,
  open_alerts: true,
  failed_jobs: true,
};
const _statsCoverage: Record<keyof HealthStatsPayload, true> = {
  window: true,
  routes: true,
  queue: true,
};
const _todayCoverage: Record<keyof ReturnType<typeof todaySummary>, true> = {
  summary: true,
  publish: true,
  failed: true,
  next: true,
  pending_approval: true,
  minutes_saved_week: true,
};
void _getCoverage;
void _statsCoverage;
void _todayCoverage;

Deno.test("the pinned key lists match the payload names exactly", () => {
  assertEquals([...HEALTH_GET_KEYS].sort(), Object.keys(_getCoverage).sort());
  assertEquals([...HEALTH_STATS_KEYS].sort(), Object.keys(_statsCoverage).sort());
  assertEquals([...HEALTH_TODAY_KEYS].sort(), Object.keys(_todayCoverage).sort());
});

Deno.test("todaySummary returns the keys the dashboard tile reads", () => {
  const out = todaySummary(
    [{ platform: "telegram", run_at: "2026-10-26T04:00:00Z", status: "queued" }],
    [3, 4],
    2,
  );
  assertEquals(Object.keys(out).sort(), [...HEALTH_TODAY_KEYS].sort());
  assertEquals(out.pending_approval, 2);
  assertEquals(out.minutes_saved_week, 7);
});

/* ---- C1: route summary math ---- */

const row = (route: string, cls: string, count: number, errors: number, msSum: number, msMax: number): RequestStatRow =>
  ({ route, cls, count, errors, ms_sum: msSum, ms_max: msMax });

Deno.test("summarizeRoutes groups by route and sorts by worst avg first", () => {
  const rows = [
    row("content", "2xx", 10, 0, 100, 10),
    row("content", "5xx", 2, 2, 400, 300), // avg 50 with the 2xx rows
    row("slow", "2xx", 4, 0, 4000, 1500),
    row("fast", "2xx", 100, 0, 100, 3),
  ];
  const out = summarizeRoutes(rows);
  assertEquals(out.map((r) => r.route), ["slow", "content", "fast"]);
  assertEquals(out[0], { route: "slow", requests: 4, errors: 0, error_rate: 0, avg_ms: 1000, max_ms: 1500 });
  assertEquals(out[1].requests, 12);
  assertEquals(out[1].errors, 2);
  assertEquals(out[1].error_rate, 0.1667);
  assertEquals(out[1].avg_ms, 42); // 500 / 12, rounded
  assertEquals(out[1].max_ms, 300);
});

Deno.test("summarizeRoutes keeps the worst ten and survives empty input", () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`r${String(i).padStart(2, "0")}`, "2xx", 1, 0, i * 100, i * 100));
  const out = summarizeRoutes(many);
  assertEquals(out.length, 10);
  assertEquals(out[0].route, "r24");
  assertEquals(out[9].route, "r15");
  assertEquals(summarizeRoutes([]), []);
});

/* ---- C2: queue watch ---- */

Deno.test("queueWatch flags a backlog at or past the fanout watchdog threshold", () => {
  const now = Date.parse("2026-10-26T04:00:00Z");
  const empty: QueueWatch = queueWatch({ queued: 0, oldest_queued_at: null, now });
  assertEquals(empty, { queued: 0, oldest_queued_min: null, stuck: false, stuck_threshold: empty.stuck_threshold });

  const four = queueWatch({ queued: 4, oldest_queued_at: new Date(now - 95_000).toISOString(), now });
  assertEquals(four.oldest_queued_min, 1);
  assertEquals(four.stuck, false);

  const five = queueWatch({ queued: 5, oldest_queued_at: new Date(now - 12 * 60_000).toISOString(), now });
  assertEquals(five.oldest_queued_min, 12);
  assertEquals(five.stuck, true);
});

Deno.test("GET /health/stats carries window, routes and queue — the keys the panel reads", () => {
  const payload: HealthStatsPayload = {
    window: "24h",
    routes: summarizeRoutes([row("a", "2xx", 1, 0, 5, 5)]),
    queue: queueWatch({ queued: 0, oldest_queued_at: null, now: Date.now() }),
  };
  assertEquals(Object.keys(payload).sort(), [...HEALTH_STATS_KEYS].sort());
});
