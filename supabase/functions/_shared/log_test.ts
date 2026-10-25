import { assertEquals } from "std/assert/mod.ts";
import { redact } from "./log.ts";

/**
 * A2: prove which secret shapes survive `redact()`.
 *
 * The whole point of these tests is that they are written against the fake
 * shapes that leak in practice — a bot token pasted into an error string, a
 * JWT echoed back by a gateway, a URL that carries its credential in the query
 * — not against the happy path that already worked. Each value below is
 * invented; nothing here is a live credential.
 */

const BOT = "123456789:AAHfakeBotTokenValueForTests000";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2Zha2U";
const MARKS = [BOT, BOT.split(":")[1], JWT];

const leaked = (payload: Record<string, unknown>) => {
  const s = JSON.stringify(redact(payload));
  return MARKS.filter((m) => m && s.includes(m));
};

Deno.test("T1 a bot token inside a log value is redacted", () => {
  const rest = leaked({ reason: `getMe failed for bot${BOT}` });
  assertEquals(rest, []);
  // The message around it survives — redaction must not eat the whole payload.
  assertEquals(JSON.stringify(redact({ reason: `failed for bot${BOT}` })).includes("failed for"), true);
});

Deno.test("T2 a JWT-shaped value is redacted", () => {
  assertEquals(leaked({ detail: `token rejected: ${JWT}` }), []);
});

Deno.test("T3 a secret-named key keeps the key and replaces the value", () => {
  const out = redact({ api_key: "sk-live-whatever", nested: { refresh_token: "abc" } });
  assertEquals(out.api_key, "[redacted]");
  const nested = out.nested as Record<string, unknown>;
  assertEquals(nested.refresh_token, "[redacted]");
  // The key survives, so the log line still says what happened.
  assertEquals(Object.keys(out).includes("api_key"), true);
});

Deno.test("T4 a URL keeps its shape and loses the value in the query string", () => {
  const out = redact({ url: "https://api.telegram.org/bot/getMe?token=abc123&x=1" });
  const url = String(out.url);
  assertEquals(url.includes("abc123"), false, url);
  assertEquals(url.includes("https://api.telegram.org/bot/getMe"), true, url);
  assertEquals(url.includes("x=1"), true, url);
});

Deno.test("T5 an ordinary message is untouched", () => {
  const out = redact({ action: "content.draft", minutes: 6, note: "Trade the plan, not the hype" });
  assertEquals(out, { action: "content.draft", minutes: 6, note: "Trade the plan, not the hype" });
});
