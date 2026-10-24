/**
 * Structured logging (UPGRADE-PHASES Phase 4).
 *
 * One JSON object per line, pino-style, so the Supabase Dashboard → Functions
 * → Logs view can filter by `trace_id`, `level`, `msg` or any field instead of
 * grepping prose. Every function already funnels through `_shared/http.ts`
 * serve(), which emits the `request` line; modules add their own context lines.
 *
 * Deliberately standalone: it must not import http.ts/log.ts (those import it
 * back) and it must never throw — a logging failure cannot fail the request.
 * Secrets are redacted with the same key pattern action_log uses.
 */
import { currentTrace } from "./trace.ts";

export type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /token|secret|password|authorization|api_key|apikey|key_hash/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string" && v.length > 2000) out[k] = v.slice(0, 2000) + "…";
    else out[k] = v;
  }
  return out;
}

/** Emit one structured line. Never throws. */
export function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      trace_id: currentTrace() ?? undefined,
      ...(fields ? redact(fields) : {}),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* a log line must never break the request */
  }
}

/** Error helper: message + error name/stack folded into the line. */
export function logError(msg: string, err: unknown, fields?: Record<string, unknown>): void {
  const e = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 4).join(" | ") } : { message: String(err) };
  log("error", msg, { ...fields, ...e });
}

/** Start a timer; call the returned function to emit the duration. */
export function startTimer(label: string): (fields?: Record<string, unknown>) => void {
  const t = performance.now();
  return (fields?: Record<string, unknown>) => log("debug", label, { ...fields, ms: Math.round(performance.now() - t) });
}
