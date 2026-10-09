import { assertEquals } from "std/assert/mod.ts";
import { FANOUT_STUCK_THRESHOLD, isStuckQueue, parseSignatures, signatureFor } from "./fanout.ts";

Deno.test("platform_signatures: a JSON map selects per platform", () => {
  const map = parseSignatures('{"telegram":"— EzyMap","tiktok":"— Ezy"}');
  assertEquals(signatureFor(map, "telegram"), "— EzyMap");
  assertEquals(signatureFor(map, "tiktok"), "— Ezy");
  assertEquals(signatureFor(map, "youtube"), null);
});

Deno.test("platform_signatures: plain text from the dashboard signs every platform", () => {
  const map = parseSignatures("— EzyMap");
  assertEquals(signatureFor(map, "telegram"), "— EzyMap");
  assertEquals(signatureFor(map, "instagram"), "— EzyMap");
});

Deno.test("platform_signatures: malformed config degrades to silence, never a crash", () => {
  assertEquals(signatureFor(parseSignatures('{"telegram":'), "telegram"), null);
  assertEquals(signatureFor(parseSignatures('["x"]'), "telegram"), null);
  assertEquals(signatureFor(parseSignatures(null), "telegram"), null);
  assertEquals(signatureFor(parseSignatures("   "), "telegram"), null);
  assertEquals(signatureFor(parseSignatures('{"telegram":"  "}'), "telegram"), null);
});

Deno.test("stuck queue: the Desk hears at the threshold, not below it", () => {
  assertEquals(isStuckQueue(0), false);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD - 1), false);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD), true);
  assertEquals(isStuckQueue(FANOUT_STUCK_THRESHOLD + 10), true);
});
