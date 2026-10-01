/**
 * Caller identity → twinos_role.
 *
 * Two ways in, both on `Authorization: Bearer …`:
 *
 *  1. A Supabase Auth JWT (dashboard, Lovable). The role comes from the login
 *     claim `app_metadata.twinos_role` (plan §9.B.9 "roles from login claims").
 *     Jack sets his own user to `jack` once (docs/SETUP.md, Phase 0). Any other
 *     verified login is `dashboard`.
 *
 *  2. A scoped API key (ABDUL, PC worker, EzyAi). Format `twk_<role>_<40 hex>`.
 *     Only the SHA-256 of the key is stored, in the `api_keys` table:
 *
 *       api_keys(id uuid pk, name text, role text, key_prefix text,
 *                key_hash text unique, scopes text[] null,
 *                created_at timestamptz, last_used_at timestamptz,
 *                revoked_at timestamptz null)
 *
 *     Decision: a table, not Vault. Vault would hold the plain key (we never
 *     need it back), listing/rotating keys from the dashboard is one UPDATE,
 *     and `last_used_at` doubles as a health beat for each caller. Plain keys
 *     exist only at creation (printed once by `mint_api_key()` RPC, see
 *     docs/SETUP.md) and in Jack's keyring.
 *
 * Internal callers (pg_cron → `net.http_post` with the service-role key) pass
 * `x-twinos-actor: cron`; the service-role JWT is recognised by its `role`
 * claim and the header picks the actor. Nothing else may claim `cron`.
 */
import { admin, anonWithJwt } from "./supabase.ts";
import { HttpError } from "./http.ts";
import type { Role } from "./roles.ts";

export interface Caller {
  role: Role;
  /** auth.users id for logins, api_keys.id for keys, "service" for cron. */
  subject: string;
  /** For action_log.actor: jack | abdul | ops_bot | dashboard | cron | ezyai | pc_worker. */
  actor: string;
  keyName?: string;
}

const KEY_RE = /^twk_([a-z_]+)_([0-9a-f]{40})$/;

export function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return normalise(h.startsWith("Bearer ") ? h.slice(7) : "");
}

/** Trim and drop one matched pair of quotes (ported from printezy). */
export function normalise(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  const quoted =
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")));
  return quoted ? v.slice(1, -1).trim() : v;
}

/** Constant-time compare (ported from printezy). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when `jwt` is this project's service-role key. The key Supabase injects
 * into the function is compared first (constant time). Projects that run both
 * the legacy and the new API-key systems can inject a differently formatted
 * value than the legacy JWT Jack stores in Vault for pg_cron, so a miss falls
 * back to asking the platform: PostgREST accepts a service-role token on a
 * table only the service role can read, and only when its signature is valid.
 */
export async function isServiceKey(jwt: string): Promise<boolean> {
  const injected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (injected && safeEqual(jwt, injected)) return true;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !jwt) return false;
  try {
    const res = await fetch(`${url}/rest/v1/api_keys?select=id&limit=1`, {
      headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** First 4 bytes of SHA-256: enough for "not the same secret" in a bug report. */
export async function fingerprint(value: string): Promise<string> {
  if (!value) return "none";
  return (await sha256Hex(value)).slice(0, 8);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function callerFromKey(token: string): Promise<Caller> {
  const m = KEY_RE.exec(token);
  if (!m) throw new HttpError(401, "unauthorized", "malformed api key");
  const hash = await sha256Hex(token);
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, name, role, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw new HttpError(503, "upstream_failed", "api_keys lookup failed");
  if (!data || data.revoked_at) {
    throw new HttpError(401, "unauthorized", "unknown or revoked api key", {
      presented_fingerprint: await fingerprint(token),
    });
  }
  if (data.role !== m[1]) {
    // The prefix is cosmetic; the table decides. Refuse if they disagree.
    throw new HttpError(401, "unauthorized", "key prefix does not match its role");
  }
  // Fire-and-forget beat; a failed update must not fail the request.
  admin()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {}, () => {});
  return { role: data.role as Role, subject: data.id, actor: data.role, keyName: data.name };
}

async function callerFromJwt(req: Request, jwt: string): Promise<Caller> {
  const payload = decodeJwtPayload(jwt);
  if (!payload) throw new HttpError(401, "unauthorized", "malformed token");

  // Service-role JWT: internal callers only (pg_cron, migrations' smoke tests).
  if (payload.role === "service_role") {
    if (!(await isServiceKey(jwt))) throw new HttpError(401, "unauthorized", "bad service token");
    const actor = req.headers.get("x-twinos-actor") ?? "cron";
    if (actor !== "cron") throw new HttpError(403, "forbidden", "service token may only act as cron");
    return { role: "cron", subject: "service", actor: "cron" };
  }

  // A user JWT: let Supabase Auth verify signature + expiry.
  const { data, error } = await anonWithJwt(jwt).auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "invalid or expired session");
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const claimed = typeof meta.twinos_role === "string" ? meta.twinos_role : "dashboard";
  const role: Role = claimed === "jack" ? "jack" : "dashboard";
  return { role, subject: data.user.id, actor: role };
}

/** Resolve the caller or throw 401. */
export async function authenticate(req: Request): Promise<Caller> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthorized", "no bearer token");
  // `await` on both branches, so a rejected callerFromKey/callerFromJwt surfaces
  // here rather than as an unhandled rejection, and so the stack points at the
  // caller that asked.
  if (token.startsWith("twk_")) return await callerFromKey(token);
  return await callerFromJwt(req, token);
}

/**
 * Shared-secret guard for webhooks that cannot carry a key (TradingView,
 * Telegram). `expected` is derived or read from env; never logged.
 */
export function requireSecret(presented: string, expected: string, who: string): void {
  if (!expected) throw new HttpError(503, "not_configured", `${who} secret is not configured`);
  if (!presented || !safeEqual(normalise(presented), expected)) {
    throw new HttpError(401, "unauthorized", `${who} secret mismatch`);
  }
}
