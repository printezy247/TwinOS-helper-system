import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { DEFAULT_RATE_LIMIT_PER_MIN, KEY_SCOPES, validateRate, validateScopes } from "./apikeys.ts";
import { HttpError } from "./http.ts";

Deno.test("the key scope vocabulary is exactly the plan's three", () => {
  assertEquals([...KEY_SCOPES], ["read:health", "read:signals", "write:posts"]);
  assertEquals(DEFAULT_RATE_LIMIT_PER_MIN, 60);
});

Deno.test("validateScopes: accepts plan scopes and dedupes", () => {
  assertEquals(
    validateScopes(["read:health", "read:signals", "read:health"]),
    ["read:health", "read:signals"],
  );
  assertEquals(validateScopes(["write:posts"]), ["write:posts"]);
});

Deno.test("validateScopes: refuses empty, unknown and non-array input with a 400", () => {
  for (const bad of [[], ["admin:all"], "read:health", null, undefined, [42], [[]]]) {
    const err = assertThrows(() => validateScopes(bad), HttpError);
    assertEquals(err.status, 400, `should 400: ${JSON.stringify(bad)}`);
  }
});

Deno.test("validateRate: defaults to 60/min and accepts whole numbers 1..100000", () => {
  assertEquals(validateRate(undefined), DEFAULT_RATE_LIMIT_PER_MIN);
  assertEquals(validateRate(null), 60);
  assertEquals(validateRate(""), 60);
  assertEquals(validateRate(1), 1);
  assertEquals(validateRate(30), 30);
  assertEquals(validateRate("900"), 900);
  assertEquals(validateRate(100000), 100000);
});

Deno.test("validateRate: refuses zero, negatives, fractions, junk and overflow with a 400", () => {
  for (const bad of [0, -5, 1.5, "abc", 100001, NaN, Infinity]) {
    const err = assertThrows(() => validateRate(bad), HttpError, undefined, `should 400: ${String(bad)}`);
    assertEquals(err.status, 400, `should 400: ${String(bad)}`);
  }
});
