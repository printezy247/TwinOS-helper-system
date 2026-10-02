/**
 * Telegram Mini App approval view, server side (plan §17 Wave 4 item 1).
 *
 * The Mini App opens from the Desk menu button and POSTs Telegram's
 * `initData` (tma.js) to `tg-auth/verify`. This module checks the initData
 * HMAC exactly the way Telegram specifies, then mints a short-lived
 * `tma.…` session the edge functions accept as Jack (auth.ts). No Supabase
 * JWT is involved anywhere: the Mini App never sees one.
 */
import { HttpError } from "./http.ts";

export const INITDATA_MAX_AGE_S = 3600; // Telegram suggests about an hour; limits replay
export const SESSION_TTL_MS = 2 * 3600_000;

export interface MiniAppUser {
  id: number;
  first_name?: string;
  username?: string;
}

/** Split initData into decoded fields, with the hash kept apart. */
export function parseInitData(raw: string): { fields: Record<string, string>; hash: string } {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash") ?? "";
  const fields: Record<string, string> = {};
  for (const [k, v] of params) {
    if (k !== "hash") fields[k] = v;
  }
  return { fields, hash };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Local constant-time compare (auth.ts has its own; importing it would cycle). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key: CryptoKey, message: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * Verify Telegram initData (Bot API "Validating data received via the Mini
 * App"): secret = HMAC_SHA256("WebAppData", bot_token), check string = the
 * decoded fields but hash, sorted, joined `key=<value>` with newlines.
 * Throws 401 on a bad signature or shape, 403 on a stale auth_date.
 */
export async function verifyInitData(
  raw: string,
  botToken: string,
  nowMs = Date.now(),
): Promise<{ user: MiniAppUser; auth_date: number }> {
  if (!botToken) throw new HttpError(503, "not_configured", "ops bot token is not set");
  const { fields, hash } = parseInitData(raw);
  if (!hash) throw new HttpError(401, "unauthorized", "initData has no hash");
  // Telegram: secret = HMAC_SHA256(key = "WebAppData", message = bot token).
  const tokenKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const secretBytes = await crypto.subtle.sign("HMAC", tokenKey, new TextEncoder().encode(botToken));
  const secret = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const calc = await hmacHex(secret, check);
  if (!timingSafeEqual(calc, hash.toLowerCase())) {
    throw new HttpError(401, "unauthorized", "initData signature mismatch");
  }
  const authDate = Number(fields["auth_date"] ?? NaN);
  const nowS = Math.floor(nowMs / 1000);
  if (!Number.isFinite(authDate) || nowS - authDate > INITDATA_MAX_AGE_S || authDate - nowS > 300) {
    throw new HttpError(403, "forbidden", "initData is stale");
  }
  let user: MiniAppUser;
  try {
    user = JSON.parse(fields["user"] ?? "null") as MiniAppUser;
  } catch {
    throw new HttpError(401, "unauthorized", "initData has no user");
  }
  if (!user || typeof user.id !== "number") throw new HttpError(401, "unauthorized", "initData has no user");
  return { user, auth_date: authDate };
}

async function sessionCryptoKey(botToken: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`twinos-tma:${botToken}`));
  return await crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** Mint `tma.<user>.<exp>.<sig>`: bound to one Telegram id, 24 h life. */
export async function mintSession(
  userId: number,
  botToken: string,
  nowMs = Date.now(),
  ttlMs = SESSION_TTL_MS,
): Promise<{ token: string; expires_at: string }> {
  const exp = nowMs + ttlMs;
  const sig = await hmacHex(await sessionCryptoKey(botToken), `${userId}.${exp}`);
  return { token: `tma.${userId}.${exp}.${sig}`, expires_at: new Date(exp).toISOString() };
}

/** Check a session: signature, shape, expiry. Throws 401 on anything off. */
export async function verifySession(
  token: string,
  botToken: string,
  nowMs = Date.now(),
): Promise<{ user_id: number }> {
  const m = /^tma\.(\d+)\.(\d+)\.([0-9a-f]{64})$/.exec(token);
  if (!m) throw new HttpError(401, "unauthorized", "malformed mini-app session");
  const calc = await hmacHex(await sessionCryptoKey(botToken), `${m[1]}.${m[2]}`);
  if (!timingSafeEqual(calc, m[3].toLowerCase())) {
    throw new HttpError(401, "unauthorized", "bad mini-app session signature");
  }
  if (Number(m[2]) <= nowMs) throw new HttpError(401, "unauthorized", "mini-app session expired");
  return { user_id: Number(m[1]) };
}
