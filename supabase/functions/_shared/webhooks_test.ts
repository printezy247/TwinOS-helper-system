import { assertEquals } from "jsr:@std/assert@1";
import {
  backoffMs,
  matchesEvent,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  signPayload,
  WEBHOOK_EVENTS,
} from "./webhooks.ts";

Deno.test("Decision 6: retries at 1m, 5m, 15m — four attempts total", () => {
  assertEquals([...RETRY_BACKOFF_MS], [60_000, 300_000, 900_000]);
  assertEquals(MAX_ATTEMPTS, 4);
  assertEquals(backoffMs(1), 60_000);
  assertEquals(backoffMs(2), 300_000);
  assertEquals(backoffMs(3), 900_000);
  // A confused caller (attempt 0 or 99) gets a real delay, never NaN.
  assertEquals(backoffMs(0), 60_000);
  assertEquals(backoffMs(99), 900_000);
});

Deno.test("matchesEvent: exact hit, wildcard, and a miss", () => {
  assertEquals(matchesEvent(["post.published"], "post.published"), true);
  assertEquals(matchesEvent(["alert.fired"], "post.published"), false);
  assertEquals(matchesEvent(["*"], "friday.done"), true);
  assertEquals(matchesEvent([], "signal.result"), false);
});

Deno.test("signPayload: stable HMAC-SHA256 vector, hex, 64 chars", async () => {
  // RFC-ish test vector for HMAC-SHA256("key", "The quick brown fox...").
  const sig = await signPayload("key", "The quick brown fox jumps over the lazy dog");
  assertEquals(
    sig,
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
  // The signature depends on the exact bytes: change one char, change the MAC.
  const other = await signPayload("key", "The quick brown fox jumps over the lazy cat");
  assertEquals(other.length, 64);
  assertEquals(other === sig, false);
});

Deno.test("the four roadmap events are the registered ones", () => {
  assertEquals(
    [...WEBHOOK_EVENTS],
    ["post.published", "signal.result", "alert.fired", "friday.done"],
  );
});
