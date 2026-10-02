/**
 * approve — the publish gate. Jack only (plan §11, §9.N.108).
 *
 *   POST /approve   { content_id, decision: approve|reject|reschedule, note?, run_at?,
 *                     via: dashboard|telegram, telegram?: { user_id, callback_id? } }
 *
 * Two callers reach this function:
 *   - the dashboard with Jack's JWT (role = jack from the login claim)
 *   - tg-webhook, internally, after it verified the callback came from Jack's
 *     Telegram id. It calls with the service-role token and
 *     `x-twinos-actor: cron` is NOT accepted here; instead it passes
 *     `x-twinos-internal: <derived webhook secret>` plus the Telegram user id,
 *     and this function re-checks the id against settings.jack_telegram_user_id.
 *
 * Writes an `approvals` row, flips content_items.status and, on approve with
 * a run_at, enqueues publish jobs. Idempotent per (content_id, decision).
 */
import { serve, readJson, reqString, oneOf, optString, bad } from "_shared/http.ts";
import { authenticate, bearer, isServiceKey, safeEqual } from "_shared/auth.ts";
import { require as requireRole, type Role } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { enqueuePublish, loadContent, setStatus } from "_shared/content.ts";
import { deriveWebhookSecret, editMessageReplyMarkup } from "_shared/tg.ts";
import { logAction } from "_shared/log.ts";
import { HttpError } from "_shared/http.ts";
import { kitRefuses } from "_shared/platforms.ts";

const DECISIONS = ["approve", "reject", "reschedule"] as const;

async function resolveCaller(req: Request, body: Record<string, unknown>) {
  const internal = req.headers.get("x-twinos-internal");
  if (internal) {
    // Internal hop from tg-webhook: service token + derived secret + Jack's TG id.
    if (!(await isServiceKey(bearer(req)))) throw new HttpError(401, "unauthorized", "bad service token");
    if (!safeEqual(internal, await deriveWebhookSecret())) {
      throw new HttpError(401, "unauthorized", "bad internal secret");
    }
    const tg = (body.telegram ?? {}) as Record<string, unknown>;
    const userId = String(tg.user_id ?? "");
    const jackId = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
    if (!userId || !safeEqual(userId, jackId)) {
      throw new HttpError(403, "forbidden", "only Jack's Telegram id may approve");
    }
    return { role: "jack" as Role, actor: "jack", subject: `tg:${userId}`, via: "telegram" };
  }
  const caller = await authenticate(req);
  return { ...caller, via: "dashboard" };
}

serve(async (req) => {
  if (req.method !== "POST") throw bad("POST only");
  const body = await readJson(req);
  const caller = await resolveCaller(req, body);
  requireRole(caller.role, "content.approve");

  const content_id = reqString(body, "content_id", { max: 64 });
  const decision = oneOf(body, "decision", DECISIONS);
  const note = optString(body, "note", 500);
  const run_at = optString(body, "run_at", 64);
  if (run_at && Number.isNaN(Date.parse(run_at))) throw bad("run_at must be an ISO timestamp");

  const idem = await idemFrom(req, body, `approve:${content_id}:${decision}`);
  const hit = await replay(idem);
  if (hit) return hit;

  const item = await loadContent(content_id);
  if (kitRefuses(item.source, decision)) throw bad("a publish kit is a copy-paste post for TikTok, YouTube or X: there is nothing to approve");
  if (!["draft", "pending_approval", "approved", "scheduled"].includes(item.status)) {
    throw bad(`cannot ${decision} an item in status ${item.status}`);
  }

  // A draft with blocking findings cannot be approved; Jack edits first.
  const { data: variant } = await admin()
    .from("content_variants").select("id, compliance, needed_fields").eq("content_id", content_id).limit(1).maybeSingle();
  if (decision === "approve" && variant?.compliance && variant.compliance.ok === false) {
    throw new HttpError(409, "conflict", "blocking compliance findings; fix the draft first", {
      findings: variant.compliance.findings,
    });
  }

  const db = admin();
  const { error } = await db.from("approvals").insert({
    content_id,
    decision,
    by_actor: caller.actor,
    by_subject: caller.subject,
    via: caller.via,
    note,
    run_at: run_at ? new Date(run_at).toISOString() : null,
  });
  if (error) throw new HttpError(503, "upstream_failed", `approvals: ${error.message}`);

  let jobs = 0;
  if (decision === "approve") {
    await setStatus(content_id, "approved", caller.actor, { approved_at: new Date().toISOString() });
    // Default: publish now (the Desk flow is "OK → posts at 08:00"); run_at overrides.
    const when = run_at ? new Date(run_at).toISOString() : item.scheduled_at ?? new Date().toISOString();
    jobs = await enqueuePublish(content_id, when, caller.actor);
  } else if (decision === "reject") {
    await setStatus(content_id, "rejected", caller.actor, { reject_note: note });
  } else {
    if (!run_at) throw bad("reschedule needs run_at");
    await setStatus(content_id, item.status === "scheduled" ? "scheduled" : "pending_approval", caller.actor, {
      scheduled_at: new Date(run_at).toISOString(),
    });
    await db.from("publish_jobs").update({ run_at: new Date(run_at).toISOString() })
      .eq("content_id", content_id).eq("status", "queued");
  }

  // Remove the buttons from the Desk message so a second tap cannot happen.
  // Reschedule keeps them: the item is still waiting and Jack may approve,
  // edit or reschedule again from the same card (Wave 0 fix 2).
  if (decision !== "reschedule" && item.desk_chat_id && item.desk_message_id) {
    try {
      await editMessageReplyMarkup(item.desk_chat_id, item.desk_message_id, null);
    } catch (err) {
      console.warn("[approve] could not clear keyboard", err);
    }
  }

  await logAction({
    actor: caller.actor,
    action: `approval.${decision}`,
    target: content_id,
    payload: { via: caller.via, note, run_at, jobs },
  });
  return remember(idem, 200, { ok: true, content_id, decision, jobs });
});
