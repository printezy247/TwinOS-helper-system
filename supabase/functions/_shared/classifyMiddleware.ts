/**
 * Middleware-style error classification pipeline (plan §1.1, grammY handle-Error pattern).
 *
 * Each middleware owns one error type and decides `throttled` / `permanent` /
 * `unknown` for it. `classify()` in backoff.ts chains them in order; the first
 * one that returns a result wins, the rest are skipped. This keeps every tier
 * independently testable (5 cases each in classifyMiddleware_test.ts).
 *
 * Order matters:
 *   TgError -> MetaError -> Transport -> Generic
 * TgError and MetaError are concrete classes, so `instanceof` is decisive and
 * they never reach the regex-based tiers. TransportMiddleware catches transport
 * failures (timeout, reset) before GenericMiddleware's `permanent:` / `capped:`
 * prefixes could misread them.
 *
 * Files that call this module:
 *   - backoff.ts  (classify() chains the middlewares)
 *   - classifyMiddleware_test.ts  (unit tests, 5 per tier)
 *
 * No data file reads/writes — pure function classification only.
 */
import { classifyMeta, MetaError } from "./meta.ts";
import { TgError } from "./tg.ts";
import { UNKNOWN_OUTCOME_RE, type Kind } from "./backoff.ts";

/** A single layer in the classification chain. */
export interface ErrorMiddleware {
  /**
   * Decide the outcome for `err`, or return `null` to defer to the next layer.
   */
  classify(err: unknown): ClassifyResult | null;
}

export interface ClassifyResult {
  kind: Kind;
  reason: string;
}

/**
 * Telegram Bot API errors. 429 and 5xx are throttled (retry); 401/403 are
 * permanent (bad token / blocked); all other codes are permanent (bad payload).
 *
 * Any TgError is claimed here — the regex for "chat not found" etc. in the
 * old monolithic classify() was redundant since those are 400s, which were
 * already permanent.
 */
export class TgErrorMiddleware implements ErrorMiddleware {
  classify(err: unknown): ClassifyResult | null {
    if (!(err instanceof TgError)) return null;
    if (err.code === 429) return { kind: "throttled", reason: err.message };
    if (err.code >= 500) return { kind: "throttled", reason: err.message };
    if (err.code === 401 || err.code === 403) return { kind: "permanent", reason: err.message };
    return { kind: "permanent", reason: err.message };
  }
}

/**
 * Meta Graph API errors. Delegates to classifyMeta(): 429 / 5xx / throttled
 * subcodes are throttled, auth subcodes (10, 102, 190) are permanent with an
 * "auth:" prefix, everything else is permanent.
 */
export class MetaErrorMiddleware implements ErrorMiddleware {
  classify(err: unknown): ClassifyResult | null {
    if (!(err instanceof MetaError)) return null;
    const r = classifyMeta(err);
    return { kind: r.kind, reason: r.reason };
  }
}

/**
 * Transport-level failures: timeouts, socket resets, DNS errors, fetch aborts.
 * These may have reached the platform, so they are classified as `unknown`
 * (held for manual check, not auto-retried on a short backoff).
 *
 * Errors explicitly tagged `permanent:` or `capped:` by callers (Meta's
 * waitFinished, publish functions) are NOT intercepted — they fall through to
 * GenericMiddleware so the caller's intent wins.
 */
export class TransportMiddleware implements ErrorMiddleware {
  classify(err: unknown): ClassifyResult | null {
    if (err instanceof TgError || err instanceof MetaError) return null;
    const msg = err instanceof Error ? err.message : String(err);
    if (/permanent:/.test(msg) || /^capped:/.test(msg)) return null;
    if (UNKNOWN_OUTCOME_RE.test(msg)) return { kind: "unknown", reason: msg };
    return null;
  }
}

/**
 * Fallback for everything else: errors with a `permanent:` or `capped:` prefix
 * (used by the Meta and kit-publish paths), and any remaining throw that is
 * not a transport error is `unknown` — never a silent success.
 */
export class GenericMiddleware implements ErrorMiddleware {
  classify(err: unknown): ClassifyResult | null {
    const msg = err instanceof Error ? err.message : String(err);
    if (/permanent:/.test(msg)) return { kind: "permanent", reason: msg };
    if (/^capped:/.test(msg)) return { kind: "throttled", reason: msg };
    return { kind: "unknown", reason: msg };
  }
}

/** The default pipeline: TgError -> MetaError -> Transport -> Generic. */
export const defaultMiddlewares: ErrorMiddleware[] = [
  new TgErrorMiddleware(),
  new MetaErrorMiddleware(),
  new TransportMiddleware(),
  new GenericMiddleware(),
];
