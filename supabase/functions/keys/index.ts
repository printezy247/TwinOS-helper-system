/**
 * keys — partner API keys from the dashboard (Phase 7: "Scoped keys +
 * rate limits per key; dashboard manages keys"). Jack only: these routes
 * hand out and retire credentials, so the permission is keys.manage =
 * ["jack"] — the same shape as content.approve and webhooks.manage.
 *
 *   GET  /keys            list every key: prefix, role, scopes, rate, last
 *                         use — never the key or its hash
 *   POST /keys            mint a partner key; the plain key comes back ONCE
 *                         (201), shown once in the dashboard and never again
 *   POST /keys/revoke     { id } → set revoked_at; idempotent
 *
 * Deployed with the default verify_jwt: the dashboard sends Jack's session
 * JWT and authenticate() resolves role jack. mint_api_key() is the RPC from
 * 0011/0034/0035/this phase — the only place a plain key exists.
 */
import { bad, conflict, HttpError, json, notFound, readJson, reqString, routeOf, serve } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin } from "_shared/supabase.ts";
import { validateRate, validateScopes } from "_shared/apikeys.ts";

serve(async (req) => {
  const caller = await authenticate(req);
  requireRole(caller.role, "keys.manage");
  const { method, tail } = routeOf(req, "keys");
  const db = admin();

  if (method === "GET" && tail.length === 0) {
    const { data, error } = await db.from("api_keys")
      .select(
        "id, name, role, key_prefix, scopes, rate_limit_per_min, created_by, created_at, last_used_at, revoked_at, revoke_note",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    return json({ keys: data ?? [] });
  }

  if (method === "POST" && tail.length === 0) {
    const body = await readJson(req);
    const name = reqString(body, "name", { max: 60 });
    const scopes = validateScopes(body.scopes);
    const rate = validateRate(body.rate_limit_per_min);

    const minted = await db.rpc("mint_api_key", { p_name: name, p_role: "partner" });
    if (minted.error) {
      const msg = minted.error.message ?? "mint_api_key failed";
      if (/duplicate|unique/i.test(msg)) throw conflict(`a key named "${name}" already exists`);
      throw new HttpError(503, "upstream_failed", msg);
    }
    const row = minted.data as { id: string; key: string; key_prefix: string; note: string };

    // Scopes + rate ride the row itself; if this update cannot land, remove
    // the fresh key rather than leaving one live without its limits.
    const { error: updErr } = await db.from("api_keys")
      .update({ scopes, rate_limit_per_min: rate, created_by: caller.actor })
      .eq("id", row.id);
    if (updErr) {
      await db.from("api_keys").delete().eq("id", row.id);
      throw new HttpError(503, "upstream_failed", updErr.message);
    }

    return json({
      id: row.id,
      name,
      role: "partner",
      key_prefix: row.key_prefix,
      scopes,
      rate_limit_per_min: rate,
      key: row.key,
      note: row.note,
    }, 201);
  }

  if (method === "POST" && tail[0] === "revoke") {
    const body = await readJson(req);
    const id = reqString(body, "id");
    const now = new Date().toISOString();
    const { data: revoked } = await db.from("api_keys")
      .update({ revoked_at: now })
      .eq("id", id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (revoked) return json({ ok: true, id, revoked_at: now });
    const { data: existing } = await db.from("api_keys").select("id, revoked_at").eq("id", id).maybeSingle();
    if (!existing) throw notFound("api key");
    return json({ ok: true, id, revoked_at: existing.revoked_at, already: true });
  }

  throw bad("unknown route (try GET /keys, POST /keys, POST /keys/revoke)");
});
