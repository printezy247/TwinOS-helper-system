import { assertEquals } from "std/assert/mod.ts";
import { checkMetaToken, checkTelegram, redactSecrets } from "./providers.ts";

const json = (body: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const fetchOf = (fn: () => Promise<Response>) => fn as unknown as typeof fetch;

Deno.test("telegram: getMe ok is up", async () => {
  const r = await checkTelegram("tok", fetchOf(json({ ok: true, result: { username: "EzyOps_bot" } })));
  assertEquals(r, { provider: "telegram", ok: true, detail: "getMe ok" });
});

Deno.test("telegram: a 401 is down, not a throw", async () => {
  const r = await checkTelegram(
    "tok",
    fetchOf(json({ ok: false, error_code: 401, description: "Unauthorized" }, 401)),
  );
  assertEquals(r.ok, false);
});

Deno.test("providers: no token means needs-credentials and no fetch at all", async () => {
  let called = 0;
  const never = (() => {
    called++;
    throw new Error("must not fetch without a token");
  }) as unknown as typeof fetch;
  assertEquals((await checkTelegram(undefined, never)).detail, "needs-credentials");
  assertEquals((await checkMetaToken("instagram", undefined, never)).detail, "needs-credentials");
  assertEquals(called, 0);
});

Deno.test("meta: a good token is up, a bad one names the failure", async () => {
  const up = await checkMetaToken(
    "instagram",
    "tok",
    fetchOf(json({ id: "123" })),
  );
  assertEquals(up.ok, true);
  const down = await checkMetaToken(
    "threads",
    "tok",
    fetchOf(json({ error: { message: "Invalid OAuth access token." } }, 400)),
  );
  assertEquals(down, { provider: "threads", ok: false, detail: "Invalid OAuth access token." });
});

// A network error message carries the request URL, and both URLs hold a token.
// What health stores, returns and sends to the Desk must never include it.
const throwsWithUrl: typeof fetch = (input) =>
  Promise.reject(new TypeError(`error sending request for url (${String(input)}): dns error`));

Deno.test("a failed Telegram check never echoes the bot token", async () => {
  const token = "123456789:AAH-secretPart_xyz";
  const r = await checkTelegram(token, throwsWithUrl);
  assertEquals(r.ok, false);
  assertEquals(r.detail.includes("secretPart"), false, r.detail);
  assertEquals(r.detail.includes("123456789:"), false, r.detail);
});

Deno.test("a failed Meta check never echoes the access token", async () => {
  const r = await checkMetaToken("instagram", "EAAGsecretTokenValue123", throwsWithUrl);
  assertEquals(r.ok, false);
  assertEquals(r.detail.includes("secretTokenValue"), false, r.detail);
});

Deno.test("redactSecrets strips bot tokens and access_token values", () => {
  const s = redactSecrets("x https://api.telegram.org/bot1:AB-c_d/getMe y ?access_token=EAAx&z=1");
  assertEquals(/AB-c_d|EAAx/.test(s), false, s);
});

import { checkWebhook, webhookHealth } from "./providers.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const URL_OK = "https://x.supabase.co/functions/v1/tg-webhook";

Deno.test("webhookHealth: registered, quiet and clean is ok", () => {
  assertEquals(webhookHealth({ url: URL_OK, pending_update_count: 0 }, NOW).status, "ok");
});

Deno.test("webhookHealth: no webhook registered is down", () => {
  const r = webhookHealth({ url: "" }, NOW);
  assertEquals(r.status, "down");
});

Deno.test("webhookHealth: unreadable info is down", () => {
  assertEquals(webhookHealth(null, NOW).status, "down");
});

Deno.test("webhookHealth: pointing at another URL is degraded", () => {
  assertEquals(webhookHealth({ url: "https://elsewhere.example/hook" }, NOW).status, "degraded");
});

Deno.test("webhookHealth: a delivery error in the last hour is degraded, an old one is not", () => {
  const recent = Math.floor((NOW - 10 * 60_000) / 1000);
  const old = Math.floor((NOW - 3 * 3600_000) / 1000);
  assertEquals(webhookHealth({ url: URL_OK, last_error_date: recent, last_error_message: "timeout" }, NOW).status, "degraded");
  assertEquals(webhookHealth({ url: URL_OK, last_error_date: old, last_error_message: "timeout" }, NOW).status, "ok");
});

Deno.test("webhookHealth: a big backlog is degraded", () => {
  assertEquals(webhookHealth({ url: URL_OK, pending_update_count: 120 }, NOW).status, "degraded");
});

Deno.test("checkWebhook: no token means no check and no fetch", async () => {
  const never = (() => {
    throw new Error("must not fetch without a token");
  }) as unknown as typeof fetch;
  assertEquals(await checkWebhook(undefined, never), null);
});

Deno.test("checkWebhook: reads getWebhookInfo and never leaks the token", async () => {
  const ok = await checkWebhook("SECRET_TOK", fetchOf(json({ ok: true, result: { url: URL_OK, pending_update_count: 0 } })));
  assertEquals(ok?.status, "ok");
  const failing = (() => Promise.reject(new Error("failed https://api.telegram.org/botSECRET_TOK/getWebhookInfo"))) as unknown as typeof fetch;
  const bad = await checkWebhook("SECRET_TOK", failing);
  assertEquals(bad?.status, "down");
  assertEquals(bad?.detail.includes("SECRET_TOK"), false);
});
