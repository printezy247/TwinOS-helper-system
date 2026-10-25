/**
 * The health payload contract (plan B4, C1, C2).
 *
 * Three endpoints feed the Health page: `GET /health` (beats, alerts, failed
 * jobs), `GET /health/today` (summary tiles) and `GET /health/stats` (the
 * request table + queue watch). The dashboard reads fixed key names out of
 * all three. This module pins those names as types, and the lists the test
 * checks against, so a rename fails `deno check` here instead of blanking a
 * tile in production.
 *
 * request_stats is one UPSERTed row per (route, status-class): counts, error
 * counts, latency sum and max. There are no per-request samples, so the table
 * below is deliberately honest — average and worst, never invented percentiles.
 * The rolling prune (20261024000300) keeps 24 h; a 7 d view would need a new
 * writer in http.ts and is out of this file's reach.
 */
import { FANOUT_STUCK_THRESHOLD, isStuckQueue } from "./fanout.ts";

/* ---- GET /health ---- */

export type BeatRow = {
  status: string;
  at: string;
  detail: unknown;
  stale: boolean;
  stale_after_min: number;
};

/** The exact shape `GET /health` answers. health/index.ts builds it typed. */
export type HealthGetPayload = {
  ok: boolean;
  summary: string;
  beats: Record<string, BeatRow>;
  tokens: unknown[];
  integrations: unknown[];
  providers: Record<string, unknown>;
  open_alerts: unknown[];
  failed_jobs: number | null;
};

export const HEALTH_GET_KEYS = [
  "ok",
  "summary",
  "beats",
  "tokens",
  "integrations",
  "providers",
  "open_alerts",
  "failed_jobs",
] as const;

/* ---- GET /health/today (todaySummary in _shared/today.ts) ---- */

export const HEALTH_TODAY_KEYS = [
  "summary",
  "publish",
  "failed",
  "next",
  "pending_approval",
  "minutes_saved_week",
] as const;

/* ---- GET /health/stats ---- */

/** One persisted request_stats row as the service-role read returns it. */
export type RequestStatRow = {
  route: string;
  cls: string;
  count: number;
  errors: number;
  ms_sum: number;
  ms_max: number;
};

export type RouteLatency = {
  route: string;
  requests: number;
  errors: number;
  /** Fraction of requests that were 4xx or 5xx, rounded to 4 decimals. */
  error_rate: number;
  avg_ms: number;
  max_ms: number;
};

/**
 * Collapse (route, class) rows to one line per route, worst average first.
 * Pure: the vitest contract on the dashboard side feeds the same fixture.
 */
export function summarizeRoutes(rows: RequestStatRow[], limit = 10): RouteLatency[] {
  const byRoute = new Map<string, RequestStatRow>();
  for (const r of rows) {
    const acc = byRoute.get(r.route);
    if (!acc) byRoute.set(r.route, { ...r });
    else {
      acc.count += r.count;
      acc.errors += r.errors;
      acc.ms_sum += r.ms_sum;
      acc.ms_max = Math.max(acc.ms_max, r.ms_max);
    }
  }
  const out: RouteLatency[] = [];
  for (const [route, a] of byRoute) {
    const requests = a.count || 0;
    out.push({
      route,
      requests,
      errors: a.errors,
      error_rate: requests ? Math.round((a.errors / requests) * 10_000) / 10_000 : 0,
      avg_ms: requests ? Math.round(a.ms_sum / requests) : 0,
      max_ms: a.ms_max,
    });
  }
  out.sort((x, y) => y.avg_ms - x.avg_ms || y.requests - x.requests || x.route.localeCompare(y.route));
  return out.slice(0, limit);
}

/** Jobs backlog watch. `stuck` reuses the fanout watchdog number, one source. */
export type QueueWatch = {
  queued: number;
  oldest_queued_min: number | null;
  stuck: boolean;
  stuck_threshold: number;
};

export function queueWatch(input: {
  queued: number;
  oldest_queued_at: string | null;
  now: number;
  threshold?: number;
}): QueueWatch {
  const threshold = input.threshold ?? FANOUT_STUCK_THRESHOLD;
  const oldestMs = input.oldest_queued_at ? Date.parse(input.oldest_queued_at) : NaN;
  return {
    queued: input.queued,
    oldest_queued_min: Number.isNaN(oldestMs) ? null : Math.max(0, Math.floor((input.now - oldestMs) / 60_000)),
    stuck: isStuckQueue(input.queued, threshold),
    stuck_threshold: threshold,
  };
}

export type HealthStatsPayload = {
  window: "24h";
  routes: RouteLatency[];
  queue: QueueWatch;
};

export const HEALTH_STATS_KEYS = ["window", "routes", "queue"] as const;
