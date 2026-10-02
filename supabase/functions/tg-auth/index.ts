/**
 * tg-auth — the Telegram Mini App's door (plan §17 Wave 4 item 1).
 *
 *   POST /tg-auth/verify  { init_data } → { ok, session, expires_at }
 *   GET  /tg-auth/me      (tma session or login JWT) → { ok, role, actor }
 *
 * The Mini App opens from the Desk menu button and carries no Supabase JWT,
 * so this function ships `--no-verify-jwt` like the other webhooks. The
 * initData HMAC (signed by Telegram with the bot token) IS the credential
 * on verify; only Jack's Telegram id gets a session, and the session acts
 * as Jack — approval stays Jack-only, never bulk, never automatic.
 */
import { serve, json, readJson, routeOf, bad, reqString } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { setting, SETTING_KEYS } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";
import { mintSession, verifyInitData } from "_shared/miniapp.ts";

serve(async (req) => {
  const { method, tail } = routeOf(req, "tg-auth");

  if (method === "POST" && tail[0] === "verify") {
    const body = await readJson(req, true);
    const initData = reqString(body, "init_data", { max: 4000 });
    const token = Deno.env.get("TWINOS_OPS_BOT_TOKEN") ?? "";
    const { user } = await verifyInitData(initData, token);
    const jack = await setting(SETTING_KEYS.jackTelegramId);
    if (!jack || String(user.id) !== jack) {
      await logAction({ actor: "ops_bot", action: "miniapp.refused", payload: { user_id: user.id } });
      throw bad("only Jack's Telegram id opens the approval view");
    }
    const session = await mintSession(user.id, token);
    await logAction({ actor: "jack", action: "miniapp.verify", payload: { user_id: user.id } });
    return json({ ok: true, ...session }, 201);
  }

  if (method === "GET" && tail[0] === "me") {
    const caller = await authenticate(req);
    requireRole(caller.role, "reports.read");
    return json({ ok: true, role: caller.role, actor: caller.actor, subject: caller.subject });
  }

  throw bad("unknown route");
});
