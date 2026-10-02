import { assert, assertEquals } from "std/assert/mod.ts";
import { backoffMs, duplicateLanded, isUnknownOutcome, UNKNOWN_HOLD_MS } from "./backoff.ts";
import { classify } from "./backoff.ts";

// Wave 3 item 4: after a timeout the send may already have landed, so the
// retry is held (not fired after a 30 s backoff) and checked before posting.

Deno.test("timeout and network errors are unknown outcomes, verdicts are not", () => {
  for (const reason of [
    "socket hang up",
    "Timeout after 30000ms",
    "fetch failed",
    "connection reset by peer",
    "the request was aborted",
  ]) assert(isUnknownOutcome(reason), reason);
  for (const reason of [
    "Too Many Requests: retry after 40",
    "permanent: instagram is not configured",
    "capped: instagram has reached 100 posts in 24 h",
    "Bad Request: chat not found",
    "item status rejected",
  ]) assert(!isUnknownOutcome(reason), reason);
});

Deno.test("the unknown-outcome hold is ten minutes, well past the first backoff", () => {
  assertEquals(UNKNOWN_HOLD_MS, 10 * 60_000);
  assert(UNKNOWN_HOLD_MS > backoffMs(1));
});

Deno.test("a fetch-level failure classifies as unknown, never permanent", () => {
  assertEquals(classify(new TypeError("fetch failed")).kind, "unknown");
  assertEquals(classify(new Error("socket hang up")).kind, "unknown");
});

Deno.test("a post that landed after the hold began suppresses the retry", () => {
  const held = new Date("2026-10-02T08:00:00Z").toISOString();
  assert(duplicateLanded(held, new Date("2026-10-02T08:00:05Z").toISOString()));
  assert(!duplicateLanded(held, new Date("2026-10-02T07:59:00Z").toISOString()));
  assert(!duplicateLanded(held, null));
  assert(!duplicateLanded(null, new Date("2026-10-02T08:00:05Z").toISOString()));
});
