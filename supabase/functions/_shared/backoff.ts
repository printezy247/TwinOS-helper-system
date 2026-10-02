/**
 * Publisher retry policy (plan §9.E.32): how a failed send is classified and
 * how long before the next attempt.
 *
 * Kept out of `publish/index.ts` so the policy can be tested on its own —
 * importing that module starts an HTTP server (`serve()` calls `Deno.serve`).
 *
 *   throttled → try again after backoffMs(attempts), up to MAX_ATTEMPTS
 *   permanent → fail the job and alert, no retry
 *   unknown   → try again, like throttled
 */
import * as tg from "./tg.ts";

export const MAX_ATTEMPTS = 4;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 15 * 60_000;

export type Kind = "success" | "throttled" | "permanent" | "unknown";

/** Ported from the ops dashboard's classifyMetaError, adapted to Bot API codes. */
export function classify(err: unknown): { kind: Kind; reason: string } {
  if (err instanceof tg.TgError) {
    if (err.code === 429) return { kind: "throttled", reason: err.message };
    if (err.code >= 500) return { kind: "throttled", reason: err.message };
    if (err.code === 401 || err.code === 403) return { kind: "permanent", reason: err.message };
    if (/chat not found|message to reply not found|wrong file identifier|too long|can't parse/i.test(err.message)) {
      return { kind: "permanent", reason: err.message };
    }
    return { kind: "permanent", reason: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/permanent:/.test(msg)) return { kind: "permanent", reason: msg };
  return { kind: "unknown", reason: msg };
}

/** 30 s, 60 s, 120 s, 240 s … capped at 15 min. `attempts` is 1-based. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_CAP_MS);
}
