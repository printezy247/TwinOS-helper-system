/**
 * Idempotency key on every retried write (plan §9.B.12).
 *
 * Callers send `Idempotency-Key: <their id>` (or `idempotency_key` in the
 * body). The first request records (scope, key) → response. A repeat with the
 * same key and the same request hash returns the stored response untouched;
 * the same key with a different body is a 409, because a silent "ok" would
 * hide a bug in the caller.
 *
 *   idempotency_keys(scope text, key text, request_hash text,
 *                    status int, response jsonb, created_at timestamptz,
 *                    primary key (scope, key))
 *
 * Rows older than 7 days can be pruned by cron; nothing here depends on them.
 */
import { admin } from "./supabase.ts";
import { sha256Hex } from "./auth.ts";
import { HttpError, json } from "./http.ts";

export interface IdemContext {
  scope: string;
  key: string;
  requestHash: string;
}

export async function idemFrom(
  req: Request,
  body: Record<string, unknown>,
  scope: string,
): Promise<IdemContext | null> {
  const header = req.headers.get("idempotency-key");
  const fromBody = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
  const key = (header ?? fromBody ?? "").trim();
  if (!key) return null;
  if (key.length > 200) throw new HttpError(400, "bad_request", "idempotency key too long");
  const { idempotency_key: _drop, ...rest } = body;
  const requestHash = await sha256Hex(JSON.stringify(rest, Object.keys(rest).sort()));
  return { scope, key, requestHash };
}

/**
 * Claim the key and return a replayed Response if it was seen before, else
 * null. The claim is the insert itself: two concurrent callers with the same
 * key cannot both win the primary key, so only one ever runs the handler (the
 * old check-then-act lookup let a race through). A claim row that never got
 * its outcome (the function died mid-handler) replays as 425 so the caller
 * retries with the same key.
 */
export async function replay(ctx: IdemContext | null): Promise<Response | null> {
  if (!ctx) return null;
  const { error } = await admin().from("idempotency_keys").insert({
    scope: ctx.scope,
    key: ctx.key,
    request_hash: ctx.requestHash,
    status: 425,
    response: { error: "processing", message: "the first request with this key is still running" },
    created_at: new Date().toISOString(),
  });
  if (!error) return null; // we own the key; run the handler
  if (error.code !== "23505") {
    // Fail open: idempotency storage must never block the Desk.
    console.warn("[idempotency] claim failed", error.message);
    return null;
  }
  const { data, error: selErr } = await admin()
    .from("idempotency_keys")
    .select("request_hash, status, response")
    .eq("scope", ctx.scope)
    .eq("key", ctx.key)
    .maybeSingle();
  if (selErr || !data) {
    console.warn("[idempotency] replay lookup failed", selErr?.message);
    return null;
  }
  if (data.request_hash !== ctx.requestHash) {
    throw new HttpError(409, "conflict", "idempotency key reused with a different body");
  }
  return json({ ...(data.response as Record<string, unknown>), replayed: true }, data.status);
}

/** Store the outcome; the response object is returned unchanged for convenience. */
export async function remember(
  ctx: IdemContext | null,
  status: number,
  response: Record<string, unknown>,
): Promise<Response> {
  if (ctx) {
    // Overwrite the 425 claim row with the real outcome (plain upsert, not
    // ignoreDuplicates — the claim row already exists and must be replaced).
    const { error } = await admin().from("idempotency_keys").upsert(
      {
        scope: ctx.scope,
        key: ctx.key,
        request_hash: ctx.requestHash,
        status,
        response,
        created_at: new Date().toISOString(),
      },
      { onConflict: "scope,key" },
    );
    if (error) console.warn("[idempotency] store failed", error.message);
  }
  return json(response, status);
}
