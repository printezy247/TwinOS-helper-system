import { assert, assertEquals, assertRejects } from "std/assert/mod.ts";
import { mintSession, parseInitData, verifyInitData, verifySession } from "./miniapp.ts";

// Wave 4 item 1: the Mini App proves Jack's Telegram id (initData HMAC) and
// gets a short-lived session the functions accept as Jack.

const BOT_TOKEN = "test-bot-token-123";
const NOW = new Date("2026-10-03T12:00:00Z").getTime();

async function signedInitData(userId: number, authDate: number): Promise<string> {
  const secret = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
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
  await assertRejects(() => verifyInitData(raw.replace(/hash=../, "hash=ff"), BOT_TOKEN, NOW));
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
