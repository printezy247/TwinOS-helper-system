/**
 * results — result reply under the original signal (plan §9.D.24–26).
 *
 *   POST /results            { signal_id | external_id, status?: tp1|tp2|be|sl, dry_run? }
 *   POST /results/stop-if    {}   → alert for signals past expiry with no result reply
 *
 * Who: abdul, cron, ezyai, jack. Looks up `signal_posts` for the channel
 * message id of the signal card, renders template 4 (result_reply) from the
 * board row, and publishes immediately as a reply (approval_rule=auto for
 * board-sourced results: ABDUL may post result replies that come straight
 * from the board, plan §9.N.107). Strict win rate = W / (W + L), BE excluded.
 */
import { serve, json, readJson, routeOf, bad, notFound, optString, oneOf } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import { createDraft, enqueuePublish, setStatus } from "_shared/content.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";
import { sendMessage } from "_shared/tg.ts";

const RESULT_STATUSES = ["tp", "tp1", "tp2", "be", "sl"] as const;

/** Strict win rate and total R over the last `days` (plan §9.D.26). */
export async function strictStats(days = 28): Promise<{ wins: number; losses: number; be: number; win_rate: number | null; total_r: number }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await admin().from("signals").select("status, result_r")
    .in("status", [...RESULT_STATUSES]).gte("closed_at", since);
  let wins = 0, losses = 0, be = 0, total_r = 0;
  for (const s of data ?? []) {
    if (s.status === "sl") losses += 1; else if (s.status === "be") be += 1; else wins += 1;
    total_r += Number(s.result_r ?? 0);
  }
  return { wins, losses, be, win_rate: wins + losses ? wins / (wins + losses) : null, total_r: Number(total_r.toFixed(2)) };
}

serve(async (req) => {
  const caller = await authenticate(req);
  requireRole(caller.role, "results.reply");
  if (req.method !== "POST") throw bad("POST only");
  const { tail } = routeOf(req, "results");
  const body = await readJson(req, true);
  const db = admin();

  if (tail[0] === "stop-if") {
    // Signals closed (or past expiry) without a result reply → alert now (§1 Q4 stop-if).
    const hours = Number((await setting(SETTING_KEYS.signalExpiryHours)) ?? 48);
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data: posted } = await db.from("signal_posts").select("signal_id, kind");
    const withCard = new Set((posted ?? []).filter((p) => p.kind === "signal").map((p) => p.signal_id));
    const withResult = new Set((posted ?? []).filter((p) => p.kind === "result").map((p) => p.signal_id));
    const { data: closed } = await db.from("signals").select("id, external_id, status, closed_at, opened_at")
      .or(`closed_at.not.is.null,opened_at.lt.${cutoff}`);
    const missing = (closed ?? []).filter((s) => withCard.has(s.id) && !withResult.has(s.id));
    if (missing.length) {
      await db.from("alerts").insert(missing.map((s) => ({
        kind: "stop_if_missing_result", severity: "critical",
        message: `signal ${s.external_id} (${s.status}) has no result reply`, payload: { signal_id: s.id },
      })));
      const jack = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
      await sendMessage(Number(jack), `🚨 STOP-IF: ${missing.length} signal(s) without a result reply:\n` + missing.map((s) => `• ${s.external_id} (${s.status})`).join("\n"));
    }
    await logAction({ actor: caller.actor, action: "results.stop_if", payload: { missing: missing.length } });
    return json({ ok: true, missing: missing.map((s) => s.external_id) });
  }

  // Resolve the signal
  const signalId = optString(body, "signal_id", 64);
  const externalId = optString(body, "external_id", 120);
  if (!signalId && !externalId) throw bad("signal_id or external_id is required");
  const q = db.from("signals").select("id, external_id, symbol, direction, status, entry_low, entry_high, stop_price, tp1, tp2, rr, result_r, result_pips, quality, closed_at");
  const { data: sig } = signalId ? await q.eq("id", signalId).maybeSingle() : await q.eq("external_id", externalId!).maybeSingle();
  if (!sig) throw notFound("signal");
  const status = oneOf(body, "status", RESULT_STATUSES, sig.status as typeof RESULT_STATUSES[number]);
  if (!RESULT_STATUSES.includes(status)) throw bad(`signal is ${sig.status}; nothing to reply yet`);
  if ((sig.quality ?? "live") !== "live") throw bad("demo/shadow signals never reach the channel");

  const idem = await idemFrom(req, { signal_id: sig.id, status }, "results.reply");
  const hit = await replay(idem);
  if (hit) return hit;

  // The original card in the channel
  const { data: card } = await db.from("signal_posts").select("chat_id, message_id").eq("signal_id", sig.id).eq("kind", "signal").limit(1).maybeSingle();
  if (!card) throw new (await import("_shared/http.ts")).HttpError(409, "conflict", "signal card not posted yet; cannot reply under it");
  const { data: already } = await db.from("signal_posts").select("message_id").eq("signal_id", sig.id).eq("kind", "result").eq("status_posted", status).limit(1).maybeSingle();
  if (already) return remember(idem, 200, { ok: true, duplicate: true, message_id: already.message_id });

  const stats = await strictStats(28);
  const outcomeWord = { tp: "TP hit", tp1: "TP1 hit", tp2: "TP2 hit", be: "Break-even", sl: "Stop-loss hit" }[status];
  const draft = await createDraft({
    post_type: "result_reply", lang: "en",
    fields: {
      symbol: sig.symbol, direction: String(sig.direction ?? "").toUpperCase(), outcome: outcomeWord, status: status.toUpperCase(),
      result_r: sig.result_r ?? "", result_pips: sig.result_pips ?? "",
      entry: sig.entry_low ?? "", sl: sig.stop_price ?? "", tp1: sig.tp1 ?? "", tp2: sig.tp2 ?? "",
      win_rate: stats.win_rate === null ? "n/a" : `${Math.round(stats.win_rate * 100)}%`,
      wins: stats.wins, losses: stats.losses, total_r: stats.total_r,
    },
    allowed_numbers: [sig.entry_low, sig.entry_high, sig.stop_price, sig.tp1, sig.tp2, sig.result_r, sig.result_pips, stats.total_r, stats.wins, stats.losses].filter((x): x is number => typeof x === "number"),
    source: { via: "board", signal_id: sig.id, status },
    signal_id: sig.id,
    actor: caller.actor,
  });
  if (!draft.compliance.ok) {
    return remember(idem, 409, { ok: false, error: "conflict", message: "result reply failed checks", findings: draft.compliance.findings, content_id: draft.content_id });
  }
  await db.from("content_items").update({ reply_to_message_id: card.message_id, target_chat_id: card.chat_id, result_status: status }).eq("id", draft.content_id);
  // Board-sourced result: auto-approved by rule (no price/offer claim, numbers from the board).
  await db.from("approvals").insert({ content_id: draft.content_id, decision: "approve", by_actor: caller.actor, by_subject: caller.subject, via: "board_rule", note: `result ${status}` });
  await setStatus(draft.content_id, "approved", caller.actor);
  if (body.dry_run === true) return remember(idem, 200, { ok: true, dry_run: true, content_id: draft.content_id, body: draft.body });
  const jobs = await enqueuePublish(draft.content_id, new Date().toISOString(), caller.actor);
  await logTimeSaved(caller.actor, "results.reply", draft.content_id);
  return remember(idem, 201, { ok: true, content_id: draft.content_id, jobs, reply_to: card.message_id, stats });
});
