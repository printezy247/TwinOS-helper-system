/**
 * Request trace ids (UPGRADE-PHASES Phase 4).
 *
 * One id per request: accepted from `x-twinos-trace` when an upstream hop
 * sends it, otherwise generated. The id lives in an AsyncLocalStorage so any
 * log line written while the request is in flight carries it without threading
 * a parameter through every call. Two ways it travels further:
 *
 *   - HTTP: `traceHeaders()` attached to an internal hop (desk approve, cron
 *     calls) — the far side adopts the same id;
 *   - queue: `withTrace(payload)` stamps a job at enqueue time, so the worker's
 *     later `jobs/result` and any replay can be joined back to the request
 *     that caused the job.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Adopt the caller's id when it is a well-formed UUID, else mint one. */
export function traceIdFromReq(req: Request): string {
  const given = req.headers.get("x-twinos-trace") ?? "";
  return UUID.test(given) ? given : crypto.randomUUID();
}

/** Run `fn` with `traceId` as the current trace. Returns whatever fn returns. */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run(traceId, fn);
}

/** The current request's trace id, or null outside a request. */
export function currentTrace(): string | null {
  return storage.getStore() ?? null;
}

/** Headers for an outbound internal hop so both sides log one id. */
export function traceHeaders(): Record<string, string> {
  const t = currentTrace();
  return t ? { "x-twinos-trace": t } : {};
}

/**
 * Stamp the current trace onto a job payload at enqueue time (no-op if the
 * payload already carries one or there is no request context).
 */
export function withTrace<P extends Record<string, unknown>>(payload: P | undefined): (P & { trace_id?: string }) | undefined {
  if (!payload || typeof payload !== "object") return payload;
  if ("trace_id" in payload) return payload;
  const t = currentTrace();
  return t ? ({ ...payload, trace_id: t } as P) : payload;
}
