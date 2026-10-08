import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { sanitizeError } from "./http.ts";

Deno.test("sanitizeError: keeps the name and hides the value", () => {
  assertEquals(sanitizeError("token=abc123 url=x"), "token=[redacted] url=x");
  assertEquals(sanitizeError("password: hunter2, next"), "password: [redacted], next");
});

Deno.test("sanitizeError: a Bearer value is hidden, not just the word Bearer", () => {
  const out = sanitizeError("401 Authorization: Bearer sekret-value-1");
  assertEquals(out.includes("sekret-value-1"), false);
  assertStringIncludes(out, "Authorization: [redacted]");
});

Deno.test("sanitizeError: a Telegram bot token inside a fetch error URL is hidden", () => {
  const tok = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0";
  const out = sanitizeError(new TypeError(`error sending request for url (https://api.telegram.org/bot${tok}/sendMessage)`));
  assertEquals(out.includes("AAHdq"), false);
  assertStringIncludes(out, "api.telegram.org/bot[redacted]/sendMessage");
});

Deno.test("sanitizeError: scoped API keys and JWTs are hidden wherever they appear", () => {
  const key = "twk_pc_worker_" + "ab12".repeat(10);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";
  const out = sanitizeError(`bad ${key} and ${jwt}`);
  assertEquals(out.includes("ab12ab12"), false);
  assertEquals(out.includes("eyJ"), false);
});

Deno.test("sanitizeError: an ordinary message passes through untouched", () => {
  assertEquals(sanitizeError("message is not modified"), "message is not modified");
});
