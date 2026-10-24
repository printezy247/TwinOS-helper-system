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
import { defaultMiddlewares } from "./classifyMiddleware.ts";

export const MAX_ATTEMPTS = 4;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 15 * 60_000;
export const BACKOFF_JITTER = 0.5;

export type Kind = "success" | "throttled" | "permanent" | "unknown";

/**
 * Classify an error by running it through the middleware pipeline:
 * TgError → MetaError → Transport → Generic. The first tier that claims the
 * error wins; if no tier claims it (impossible: GenericMiddleware is a
 * catch-all), defaults to `unknown`.
 */
export function classify(err: unknown): { kind: Kind; reason: string } {
  for (const m of defaultMiddlewares) {
    const r = m.classify(err);
    if (r) return r;
  }
  return { kind: "unknown", reason: String(err) };
}

/** 30 s, 60 s, 120 s, 240 s … capped at 15 min. `attempts` is 1-based. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_CAP_MS);
}

/** Full jitter backoff: random value in [0, backoffMs(attempts)). */
export function jitteredBackoff(attempts: number): number {
  return backoffMs(attempts) * Math.random();
}

/** Token bucket rate limiter (plan §2.3) */
export class RateLimiter {
  private capacity: number;
  private refillPerTick: number;
  private tokens: number;

  constructor(capacity = 10, refillPerTick = 10) {
    this.capacity = capacity;
    this.refillPerTick = refillPerTick;
    this.tokens = capacity;
  }

  consume(n = 1): boolean {
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  refill(): void {
    this.tokens = Math.min(this.capacity, this.tokens + this.refillPerTick);
  }

  get available(): number {
    return this.tokens;
  }
}

/* ------------------------------------------------------------------------ */
/* Limiter registry (UPGRADE-PHASES Phase 4)                                  */
/*                                                                             */
/* `GET /health/ratelimit` reports these. A limiter is registered by whoever  */
/* puts it on a request path — until then the endpoint honestly reports none  */
/* active rather than inventing headroom.                                     */
/* ------------------------------------------------------------------------ */

const LIMITERS = new Map<string, () => number>();

/** Register a live limiter under a stable per-client/integration name. */
export function registerLimiter(name: string, read: () => number): void {
  LIMITERS.set(name, read);
}

/** Snapshot for /health/ratelimit: name → tokens currently available. */
export function limiterSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, read] of LIMITERS) {
    try {
      out[name] = read();
    } catch {
      out[name] = -1;
    }
  }
  return out;
}

/** A job held back by a platform's daily cap waits half an hour and keeps its attempts; anything else backs off. */
export const CAP_HOLD_MS = 30 * 60_000;

/* ------------------------------------------------------------------------ */
/* Unknown-outcome guard (plan §17 Wave 3 item 4)                            */
/*                                                                           */
/* A transport failure (timeout, reset, fetch abort) may have reached the   */
/* platform: the post can be out there while we hold an error. Retrying     */
/* after a 30 s backoff risks a public duplicate, so unknown outcomes hold  */
/* the retry for UNKNOWN_HOLD_MS and the job is checked for a landed post   */
/* before anything is sent again.                                            */

export const UNKNOWN_HOLD_MS = 10 * 60_000;

/** Transport-level failures: the request may have reached the platform. */
export const UNKNOWN_OUTCOME_RE =
  /timed?\s?out|socket hang up|fetch failed|network(?:[\s_]+(?:error|failure|down|unreachable))?|econnreset|connection (?:reset|refused|aborted|closed)|broken pipe|eai_again|enotfound|abort/i;

export function isUnknownOutcome(reason: string): boolean {
  return UNKNOWN_OUTCOME_RE.test(reason ?? "");
}

/** True when a post record landed after the hold began: the timed-out send
 *  actually went out, so the retry must not send again. */
export function duplicateLanded(
  heldAt: string | null | undefined,
  postedAt: string | null | undefined,
): boolean {
  if (!heldAt || !postedAt) return false;
  const h = Date.parse(heldAt);
  const p = Date.parse(postedAt);
  return !Number.isNaN(h) && !Number.isNaN(p) && p >= h;
}

export function retryPlan(
  attempts: number,
  reason: string,
  opts?: { jitter?: boolean },
): { delayMs: number; burnsAttempt: boolean } {
  if (/^capped:/.test(reason)) return { delayMs: CAP_HOLD_MS, burnsAttempt: false };
  const delayMs = opts?.jitter ? jitteredBackoff(attempts) : backoffMs(attempts);
  return { delayMs, burnsAttempt: true };
}

/* Telegram re-sends an update on every non-200, so one handler fault can    */
/* replay for hours. After UPDATE_FAIL_LIMIT failures the update is poison:  */
/* tg-webhook answers 200 and drops it instead of retrying the same fault.   */

export const UPDATE_FAIL_LIMIT = 3;

export function isPoisonedUpdate(failures: number, limit = UPDATE_FAIL_LIMIT): boolean {
  return failures >= limit;
}

/** What a redelivered update deserves. `null` = never seen (the first delivery). */
export type UpdateDisposition = "fresh" | "duplicate" | "retry" | "poison";

export function updateDisposition(failures: number | null | undefined): UpdateDisposition {
  if (failures === null || failures === undefined) return "fresh";
  if (failures <= 0) return "duplicate";
  if (isPoisonedUpdate(failures)) return "poison";
  return "retry";
}

/**
 * The failure count after a handler run. A handled update is marked done
 * (count 0) so Telegram's later redeliveries are duplicates — otherwise a
 * successful retry leaves failures > 0 behind and the next redelivery
 * re-runs the handler, creating duplicate drafts and cards.
 */
export function failuresAfter(outcome: "handled" | "failed", failures: number): number {
  return outcome === "handled" ? 0 : failures + 1;
}

/**
 * An unknown outcome (timeout, reset) may have posted. The job is parked, not
 * re-sent on a timer: the landed check cannot see a send that never returned
 * a message id. Jack answers on the Desk (It's posted / Send again). Whatever
 * the result held (a first comment's text) is kept.
 */
export function unknownOutcomePatch(prev: Record<string, unknown> | null | undefined, nowIso: string) {
  return {
    status: "failed" as const,
    error_class: "unknown" as const,
    result: { ...(prev ?? {}), unknown_hold: true, held_at: nowIso } as Record<string, unknown>,
  };
}

/** Jack tapped Send again: one clean retry, the hold flags dropped. */
export function resendPatch(prev: Record<string, unknown> | null | undefined, nowIso: string) {
  const { unknown_hold: _h, held_at: _a, ...rest } = (prev ?? {}) as Record<string, unknown>;
  return { status: "queued" as const, attempts: 0, error_class: null, last_error: null, run_at: nowIso, result: rest };
}
