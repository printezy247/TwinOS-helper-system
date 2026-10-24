/**
 * Prometheus-style metrics (UPGRADE-PHASES Phase 4).
 *
 * Honest scoping: Supabase Edge Functions run as isolates whose count and
 * lifetime belong to the platform, so REQUEST counters here are per-isolate —
 * useful for shape (which route, how slow, how many errors) and multiplied up
 * by the platform only if scraping ever gets real. GAUGES registered with
 * registerGauge() are read live from the database on every render, so those
 * are global regardless of isolate.
 *
 * Exposed by `GET /health/metrics` as text/plain; version=0.0.4.
 * Duration is exposed as sum/count/max per route+status-class: honest with a
 * single number per scrape and enough for averages and error rates; exact
 * p95 would need client-side bucketing and a scrape interval this project
 * does not have.
 */

type Bucket = { count: number; errors: number; sumMs: number; maxMs: number };

const requests = new Map<string, Bucket>();
const counters = new Map<string, number>();
const gauges: Array<{ name: string; help: string; fn: () => number | Promise<number> }> = [];

/** A persisted request row (global across isolates — see persist hook). */
export type RequestStat = { route: string; cls: string; count: number; errors: number; ms_sum: number; ms_max: number };

/*
 * Persistence hook. Isolate-local counters looked clean in unit tests but
 * proved unscrapeable in production: consecutive requests can land on
 * different isolates, so the scrape almost never sees earlier observations.
 * http.ts registers a fire-and-forget writer into `request_stats` (one atomic
 * RPC, never awaited, errors swallowed); renderProm() prefers those global
 * rows and falls back to the local map when no rows are passed.
 */
let persist: ((route: string, cls: string, ms: number) => void) | null = null;

export function setRequestPersist(fn: (route: string, cls: string, ms: number) => void): void {
  persist = fn;
}

const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapse ids so route labels stay bounded (`/content/<uuid>/fanout` → `/content/:id/fanout`). */
export function normalizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((s) => (UUID_SEG.test(s) || /^\d{6,}$/.test(s) ? ":id" : s))
    .join("/");
}

/** Record one request: always in the local map, plus the persist hook. */
export function observe(method: string, pathname: string, status: number, ms: number): void {
  const cls = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
  const route = `${method} ${normalizePath(pathname)}`;
  const key = `${route}|${cls}`;
  const b = requests.get(key) ?? { count: 0, errors: 0, sumMs: 0, maxMs: 0 };
  b.count++;
  if (status >= 400) b.errors++;
  b.sumMs += ms;
  b.maxMs = Math.max(b.maxMs, ms);
  requests.set(key, b);
  try {
    persist?.(route, cls, ms);
  } catch { /* metrics must never fail a request */ }
}

/** Plain counter (queue retries drained, alerts sent, …). */
export function inc(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/**
 * Register a live gauge. `fn` runs at render time (DB reads belong to the
 * request that scrapes). Re-registering the same name replaces it, so module
 * re-evaluation in tests does not duplicate series.
 */
export function registerGauge(name: string, help: string, fn: () => number | Promise<number>): void {
  const i = gauges.findIndex((g) => g.name === name);
  const g = { name, help, fn };
  if (i >= 0) gauges[i] = g;
  else gauges.push(g);
}

/** Test/reset hook — not used on the request path. */
export function resetMetrics(): void {
  requests.clear();
  counters.clear();
  gauges.length = 0;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/**
 * Render the exposition text. Pass the persisted `request_stats` rows to get
 * the global request series (what /health/metrics does); without them the
 * isolate-local map is rendered, which is what unit tests assert.
 */
export async function renderProm(dbStats?: RequestStat[]): Promise<string> {
  const out: string[] = [];
  out.push("# HELP twinos_request_count Requests handled (global, from request_stats).");
  out.push("# TYPE twinos_request_count counter");
  out.push("# HELP twinos_request_errors Requests that returned 4xx/5xx.");
  out.push("# TYPE twinos_request_errors counter");
  out.push("# HELP twinos_request_duration_ms_total Cumulative request duration in ms (pair with _count for the mean).");
  out.push("# TYPE twinos_request_duration_ms_total gauge");
  out.push("# HELP twinos_request_duration_ms_max Longest single request in ms for the key.");
  out.push("# TYPE twinos_request_duration_ms_max gauge");
  const rows: Array<{ key: string; b: Bucket }> = dbStats
    ? dbStats.map((r) => ({
        key: `${r.route}|${r.cls}`,
        b: { count: Number(r.count), errors: Number(r.errors), sumMs: Number(r.ms_sum), maxMs: Number(r.ms_max) },
      }))
    : [...requests.entries()].map(([key, b]) => ({ key, b }));
  for (const { key, b } of rows.sort((a, z) => a.key.localeCompare(z.key))) {
    const [route, cls] = key.split("|");
    const labels = `route="${escapeLabel(route)}",status="${cls}"`;
    out.push(`twinos_request_count{${labels}} ${b.count}`);
    out.push(`twinos_request_errors{${labels}} ${b.errors}`);
    out.push(`twinos_request_duration_ms_total{${labels}} ${Math.round(b.sumMs)}`);
    out.push(`twinos_request_duration_ms_max{${labels}} ${Math.round(b.maxMs)}`);
  }
  for (const [name, v] of [...counters.entries()].sort()) {
    out.push(`# HELP ${name} Application counter.`);
    out.push(`# TYPE ${name} counter`);
    out.push(`${name} ${v}`);
  }
  for (const g of gauges) {
    let v: number;
    try {
      v = await g.fn();
    } catch {
      v = -1; // -1 = gauge could not be read; the scrape itself still succeeds.
    }
    out.push(`# HELP ${g.name} ${g.help}`);
    out.push(`# TYPE ${g.name} gauge`);
    out.push(`${g.name} ${v}`);
  }
  return out.join("\n") + "\n";
}
