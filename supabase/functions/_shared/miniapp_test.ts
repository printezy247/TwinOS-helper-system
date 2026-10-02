import { assert, assertEquals, assertRejects } from "std/assert/mod.ts";
import { mintSession, parseInitData, SESSION_TTL_MS, verifyInitData, verifySession } from "./miniapp.ts";

// Wave 4 item 1: the Mini App proves Jack's Telegram id (initData HMAC) and
// gets a short-lived session the functions accept as Jack.

const BOT_TOKEN = "test-bot-token-123";
const NOW = new Date("2026-10-03T12:00:00Z").getTime();

async function signedInitData(userId: number, authDate: number): Promise<string> {
  // Telegram's algorithm (mirrored, not imported: the test must pin it).
  const tokenKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const secretBytes = await crypto.subtle.sign("HMAC", tokenKey, new TextEncoder().encode(BOT_TOKEN));
  const secret = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const user = encodeURIComponent(JSON.stringify({ id: userId, first_name: "Jack" }));
  const check = `auth_date=${authDate}\nuser=${decodeURIComponent(user)}`;
  const sig = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(check));
  const hash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `user=${user}&auth_date=${authDate}&hash=${hash}`;
}

Deno.test("a signed initData verifies, a flipped bit does not", async () => {
  const authDate = Math.floor(NOW / 1000) - 60;
  const raw = await signedInitData(6282941580, authDate);
  const v = await verifyInitData(raw, BOT_TOKEN, NOW);
  assertEquals(v.user.id, 6282941580);
  const last = raw.slice(-1);
  const flipped = raw.slice(0, -1) + (last === "a" ? "b" : "a"); // same length, surely a mismatch
  await assertRejects(() => verifyInitData(flipped, BOT_TOKEN, NOW));
  await assertRejects(() => verifyInitData(raw, "wrong-token", NOW));
});

Deno.test("a stale auth_date is refused", async () => {
  const raw = await signedInitData(1, Math.floor(NOW / 1000) - 25 * 3600);
  await assertRejects(() => verifyInitData(raw, BOT_TOKEN, NOW));
});

Deno.test("sessions round-trip, expire, and bind one user", async () => {
  const { token, expires_at } = await mintSession(6282941580, BOT_TOKEN, NOW);
  assert(token.startsWith("tma."), token);
  assertEquals((await verifySession(token, BOT_TOKEN, NOW)).user_id, 6282941580);
  assert(new Date(expires_at).getTime() > NOW);
  await assertRejects(() => verifySession(token, BOT_TOKEN, NOW + 25 * 3600_000));
  await assertRejects(() => verifySession(token.slice(0, -2) + "ff", BOT_TOKEN, NOW));
});

Deno.test("parse keeps every field and the hash apart", () => {
  const { fields, hash } = parseInitData("user=%7B%7D&auth_date=1&hash=abc");
  assertEquals(hash, "abc");
  assertEquals(fields["auth_date"], "1");
  assert(!("hash" in fields));
});

// Independent vector: signed with Python's hmac module per Telegram's spec
// (secret = HMAC_SHA256(key="WebAppData", msg=bot_token)), not with this file's
// helper, so a mirrored mistake in both cannot pass.
const PY_VECTOR =
  "user=%7B%22id%22%3A6282941580%2C%22first_name%22%3A%22Jack%22%7D&auth_date=1790942340&hash=e6df2ff6dc5b289f7bcfdac5c9ae974426a1ab48fbea6432bbf0d7140c89968b";

Deno.test("initData signed by Telegram's own algorithm (Python vector) verifies", async () => {
  const v = await verifyInitData(PY_VECTOR, BOT_TOKEN, 1790942400_000);
  assertEquals(v.user.id, 6282941580);
});

Deno.test("initData older than an hour is refused (replay window)", async () => {
  await assertRejects(() => verifyInitData(PY_VECTOR, BOT_TOKEN, (1790942340 + 3601) * 1000));
});

Deno.test("a Mini App session lasts at most two hours", () => {
  assert(SESSION_TTL_MS <= 2 * 3600_000);
});
