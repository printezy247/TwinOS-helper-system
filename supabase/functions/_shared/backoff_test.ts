import { assertEquals } from "std/assert/mod.ts";
import { backoffMs, classify, MAX_ATTEMPTS } from "./backoff.ts";
import { TgError } from "./tg.ts";

Deno.test("backoff doubles from 30 s and caps at 15 min", () => {
  assertEquals(backoffMs(1), 30_000);
  assertEquals(backoffMs(2), 60_000);
  assertEquals(backoffMs(3), 120_000);
  assertEquals(backoffMs(4), 240_000);
  assertEquals(backoffMs(5), 480_000);
  assertEquals(backoffMs(6), 900_000); // 960 s capped to 15 min
  assertEquals(backoffMs(99), 900_000);
});

Deno.test("attempts below 1 are treated as the first attempt", () => {
  assertEquals(backoffMs(0), 30_000);
  assertEquals(backoffMs(-3), 30_000);
});

Deno.test("a 429 or a 5xx is throttled (retry), not permanent", () => {
  assertEquals(classify(new TgError("sendMessage", 429, "Too Many Requests")).kind, "throttled");
  assertEquals(classify(new TgError("sendMessage", 500, "Internal Server Error")).kind, "throttled");
  assertEquals(classify(new TgError("sendMessage", 502, "Bad Gateway")).kind, "throttled");
});

Deno.test("auth failures and bad payloads are permanent", () => {
  assertEquals(classify(new TgError("sendMessage", 401, "Unauthorized")).kind, "permanent");
  assertEquals(classify(new TgError("sendMessage", 403, "Forbidden: bot was blocked")).kind, "permanent");
  assertEquals(classify(new TgError("sendMessage", 400, "Bad Request: chat not found")).kind, "permanent");
  assertEquals(classify(new Error("permanent: instagram provider not enabled")).kind, "permanent");
});

Deno.test("an unrecognised throw is unknown (retry), never a silent success", () => {
  assertEquals(classify(new Error("socket hang up")).kind, "unknown");
  assertEquals(classify("a bare string").kind, "unknown");
});

Deno.test("MAX_ATTEMPTS matches the docs (4 tries, then a failed job + alert)", () => {
  assertEquals(MAX_ATTEMPTS, 4);
});
