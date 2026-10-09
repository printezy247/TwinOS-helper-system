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
import { classifyMeta, MetaError } from "./meta.ts";

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
  if (err instanceof MetaError) return classifyMeta(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (/permanent:/.test(msg)) return { kind: "permanent", reason: msg };
  if (/^capped:/.test(msg)) return { kind: "throttled", reason: msg };
  return { kind: "unknown", reason: msg };
}

/** 30 s, 60 s, 120 s, 240 s … capped at 15 min. `attempts` is 1-based. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_CAP_MS);
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

export function retryPlan(attempts: number, reason: string): { delayMs: number; burnsAttempt: boolean } {
  if (/^capped:/.test(reason)) return { delayMs: CAP_HOLD_MS, burnsAttempt: false };
  return { delayMs: backoffMs(attempts), burnsAttempt: true };
}

/* Telegram re-sends an update on every non-200, so one handler fault can    */
/* replay for hours. After UPDATE_FAIL_LIMIT failures the update is poison:  */
/* tg-webhook answers 200 and drops it instead of retrying the same fault.   */

export const UPDATE_FAIL_LIMIT = 3;

export function isPoisonedUpdate(failures: number, limit = UPDATE_FAIL_LIMIT): boolean {
  return failures >= limit;
}

/** What a re-sent update deserves. `null` = never seen (the first delivery). */
export type UpdateDisposition = "fresh" | "duplicate" | "retry" | "poison";

export function updateDisposition(failures: number | null | undefined): UpdateDisposition {
  if (failures === null || failures === undefined) return "fresh";
  if (failures <= 0) return "duplicate";
  if (isPoisonedUpdate(failures)) return "poison";
  return "retry";
}

/**
 * The failure count after a handler run. A handled update is marked done
 * (count 0) so Telegram's later re-sends are duplicates — otherwise a
 * successful retry leaves failures > 0 behind and every re-send re-runs the
 * handler, creating duplicate drafts and cards.
 */
export function failuresAfter(outcome: "handled" | "failed", failures: number): number {
  return outcome === "handled" ? 0 : failures + 1;
}
