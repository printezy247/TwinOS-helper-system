/**
 * results — result reply under the original signal (plan §9.D.24–26).
 *
 *   POST /results            { signal_id | external_id, status?: tp1|tp2|be|sl, dry_run? }
 *   POST /results/run        { limit? }   → drain queued result_reply jobs (cron)
 *   POST /results/stop-if    {}   → alert for signals past expiry with no result reply
 *
 * Who: abdul, cron, ezyai, jack. Looks up `signal_posts` for the channel
 * message id of the signal card, renders template 4 (result_reply) from the
 * board row, and publishes immediately as a reply (approval_rule=auto for
 * board-sourced results: ABDUL may post result replies that come straight
 * from the board, plan §9.N.107). Strict win rate = W / (W + L), BE excluded.
 *
 * A board status change queues a `result_reply` job (signals-ingest); the
 * `run` route is what posts those, so "a result posts by itself" needs no one
 * at the keyboard (plan §13, Phase 1 exit). The job claim is atomic, so two
 * cron ticks can never post the same result twice.
 */
import { serve, json, readJson, routeOf, bad, notFound, optString, oneOf } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember, type IdemContext } from "_shared/idempotency.ts";
import { admin, requireSetting, settingTyped, SETTING_KEYS } from "_shared/supabase.ts";
import { createDraft, enqueuePublish, setStatus } from "_shared/content.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";
import { sendMessage } from "_shared/tg.ts";

const RESULT_STATUSES = ["tp", "tp1", "tp2", "be", "sl"] as const;
type ResultStatus = (typeof RESULT_STATUSES)[number];

const SIGNAL_COLS =
  "id, external_id, symbol, direction, status, entry_low, entry_high, stop_price, tp1, tp2, rr, result_r, result_pips, quality, closed_at";

interface SignalRow {
  id: string;
  external_id: string;
  symbol: string | null;
  direction: string | null;
  status: string;
  entry_low: number | null;
  entry_high: number | null;
  stop_price: number | null;
  tp1: number | null;
  tp2: number | null;
  rr: number | null;
  result_r: number | null;
  result_pips: number | null;
  quality: string | null;
  closed_at: string | null;
}

interface Caller {
  actor: string;
  subject: string;
}

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

/**
 * Build and post the result reply for one signal. Shared by the explicit
 * route and the cron drain so both behave identically.
 */
async function replyUnderCard(
  sig: SignalRow,
  status: ResultStatus,
  caller: Caller,
  opts: { dryRun?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = admin();
  if ((sig.quality ?? "live") !== "live") {
    return { status: 400, body: { ok: false, error: "bad_request", message: "demo/shadow signals never reach the channel" } };
  }

  // The original card in the channel
  const { data: card } = await db.from("signal_posts").select("chat_id, message_id").eq("signal_id", sig.id).eq("kind", "signal").limit(1).maybeSingle();
  if (!card) {
    return { status: 409, body: { ok: false, error: "conflict", message: "signal card not posted yet; cannot reply under it" } };
  }
  const { data: already } = await db.from("signal_posts").select("message_id").eq("signal_id", sig.id).eq("kind", "result").eq("status_posted", status).limit(1).maybeSingle();
  if (already?.message_id) return { status: 200, body: { ok: true, duplicate: true, message_id: already.message_id } };

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
    return { status: 409, body: { ok: false, error: "conflict", message: "result reply failed checks", findings: draft.compliance.findings, content_id: draft.content_id } };
  }
  await db.from("content_items").update({ reply_to_message_id: card.message_id, target_chat_id: card.chat_id, result_status: status }).eq("id", draft.content_id);
  if (opts.dryRun) return { status: 200, body: { ok: true, dry_run: true, content_id: draft.content_id, body: draft.body } };

  // Atomic claim on (signal_id, status_posted): the unique index from 20261005000001_review_fixes
  // makes a second reply for the same outcome impossible, even when two cron
  // ticks drain duplicate jobs or a manual POST races the queue. The row
  // starts with a null message_id; publish fills it in after the send.
  const claim = await db.from("signal_posts")
    .insert({ signal_id: sig.id, kind: "result", status_posted: status, content_id: draft.content_id })
    .select("id")
    .single();
  if (claim.error) {
    const { data: existing } = await db.from("signal_posts").select("message_id")
      .eq("signal_id", sig.id).eq("kind", "result").eq("status_posted", status).limit(1).maybeSingle();
    return { status: 200, body: { ok: true, duplicate: true, message_id: existing?.message_id ?? null } };
  }

  // Board-sourced result: auto-approved by rule (no price/offer claim, numbers from the board).
  // The DB guard refuses this insert if the variant carries a price/offer claim.
  try {
    await db.from("approvals").insert({ content_id: draft.content_id, decision: "approve", by_actor: caller.actor, by_subject: caller.subject, via: "board_rule", note: `result ${status}` });
    await setStatus(draft.content_id, "approved", caller.actor);
    const jobs = await enqueuePublish(draft.content_id, new Date().toISOString(), caller.actor);
    await logTimeSaved(caller.actor, "results.reply", draft.content_id);
    return { status: 201, body: { ok: true, content_id: draft.content_id, jobs, reply_to: card.message_id, stats } };
  } catch (err) {
    // Release the claim so a retry can try again (the send never happened).
    await db.from("signal_posts").delete()
      .eq("signal_id", sig.id).eq("kind", "result").eq("status_posted", status).is("message_id", null);
    throw err;
  }
}

/* ---------- the cron drain ---------- */

interface JobRow {
  id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

async function claimResultJob(): Promise<JobRow | null> {
  const db = admin();
  // A function that died mid-post leaves a claimed job; put it back.
  await db.from("jobs").update({ status: "queued", claimed_by: null, claimed_at: null })
    .eq("kind", "result_reply").eq("status", "claimed")
    .lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { data: due } = await db.from("jobs").select("id, payload, attempts")
    .eq("kind", "result_reply").eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true }).limit(1).maybeSingle();
  if (!due) return null;
  // Atomic claim: two ticks cannot take the same job.
  const { data: claimed } = await db.from("jobs")
    .update({ status: "claimed", claimed_by: "results-run", claimed_at: new Date().toISOString(), attempts: due.attempts + 1 })
    .eq("id", due.id).eq("status", "queued").select("id").maybeSingle();
  if (!claimed) return null;
  return { id: due.id, payload: (due.payload ?? {}) as Record<string, unknown>, attempts: due.attempts + 1 };
}

async function finishJob(job: JobRow, ok: boolean, detail: Record<string, unknown>) {
  const db = admin();
  const now = new Date().toISOString();
  if (ok) {
    await db.from("jobs").update({ status: "done", done_at: now, result: detail, last_error: null }).eq("id", job.id);
  } else {
    await db.from("jobs").update({ status: "failed", last_error: String(detail.message ?? detail.error ?? "failed").slice(0, 500) }).eq("id", job.id);
  }
}

/** Post every queued result reply, oldest first. */
async function drainResultJobs(limit: number, caller: Caller): Promise<Record<string, unknown>[]> {
  const db = admin();
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await claimResultJob();
    if (!job) break;
    const signalId = typeof job.payload.signal_id === "string" ? job.payload.signal_id : null;
    const wanted = typeof job.payload.status === "string" ? job.payload.status : null;
    if (!signalId) {
      await finishJob(job, false, { error: "job has no signal_id" });
      results.push({ job_id: job.id, ok: false, error: "job has no signal_id" });
      continue;
    }
    const { data: sig } = await db.from("signals").select(SIGNAL_COLS).eq("id", signalId).maybeSingle();
    if (!sig) {
      await finishJob(job, false, { error: "signal not found" });
      results.push({ job_id: job.id, ok: false, error: "signal not found" });
      continue;
    }
    const row = sig as SignalRow;
    const status = (wanted && (RESULT_STATUSES as readonly string[]).includes(wanted))
      ? (wanted as ResultStatus)
      : (row.status as ResultStatus);
    if (!(RESULT_STATUSES as readonly string[]).includes(status)) {
      await finishJob(job, false, { error: `signal is ${row.status}` });
      results.push({ job_id: job.id, ok: false, error: `signal is ${row.status}` });
      continue;
    }
    const r = await replyUnderCard(row, status, caller);
    await finishJob(job, r.status < 300, r.body);
    results.push({ job_id: job.id, ...r.body });
  }
  return results;
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
    const hours = Number((await settingTyped(SETTING_KEYS.signalExpiryHours)) ?? 48);
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const { data: posted } = await db.from("signal_posts").select("signal_id, kind, message_id");
    // 0011 widened the card kind to 'card' | 'signal'; count both, like v_stop_if.
    const withCard = new Set((posted ?? []).filter((p) => p.kind === "signal" || p.kind === "card").map((p) => p.signal_id));
    // Only posted results count: an unclaimed/pending claim row (message_id
    // null until publish fills it) must not silence the stop-if alert.
    const withResult = new Set((posted ?? []).filter((p) => p.kind === "result" && p.message_id !== null).map((p) => p.signal_id));
    const { data: closed } = await db.from("signals").select("id, external_id, status, closed_at, opened_at")
      .or(`closed_at.not.is.null,opened_at.lt.${cutoff}`);
    const missing = (closed ?? []).filter((s) => withCard.has(s.id) && !withResult.has(s.id));

    // One open alert per signal. Without the key this cron tick (every 10 min)
    // would insert a fresh alert and message Jack again for the same signal.
    const keys = missing.map((s) => `stop_if:${s.id}`);
    const { data: open } = keys.length
      ? await db.from("alerts").select("dedupe_key").in("dedupe_key", keys).is("resolved_at", null)
      : { data: [] as Array<{ dedupe_key: string | null }> };
    const known = new Set((open ?? []).map((a) => a.dedupe_key));
    const fresh = missing.filter((s) => !known.has(`stop_if:${s.id}`));
    if (fresh.length) {
      await db.from("alerts").insert(fresh.map((s) => ({
        kind: "stop_if_missing_result", severity: "critical",
        message: `signal ${s.external_id} (${s.status}) has no result reply`,
        dedupe_key: `stop_if:${s.id}`, payload: { signal_id: s.id },
      })));
      const jack = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
      await sendMessage(Number(jack), `🚨 STOP-IF: ${fresh.length} signal(s) without a result reply:\n` + fresh.map((s) => `• ${s.external_id} (${s.status})`).join("\n"));
    }
    await logAction({ actor: caller.actor, action: "results.stop_if", payload: { missing: missing.length, alerted: fresh.length } });
    return json({ ok: true, missing: missing.map((s) => s.external_id), alerted: fresh.map((s) => s.external_id) });
  }

  if (tail[0] === "run") {
    const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 50);
    const results = await drainResultJobs(limit, { actor: caller.actor, subject: caller.subject });
    await logAction({ actor: caller.actor, action: "results.run", payload: { ran: results.length } });
    return json({ ran: results.length, results });
  }

  // Resolve the signal
  const signalId = optString(body, "signal_id", 64);
  const externalId = optString(body, "external_id", 120);
  if (!signalId && !externalId) throw bad("signal_id or external_id is required");
  const q = db.from("signals").select(SIGNAL_COLS);
  const { data: sig } = signalId ? await q.eq("id", signalId).maybeSingle() : await q.eq("external_id", externalId!).maybeSingle();
  if (!sig) throw notFound("signal");
  const status = oneOf(body, "status", RESULT_STATUSES, sig.status as ResultStatus);
  if (!RESULT_STATUSES.includes(status)) throw bad(`signal is ${sig.status}; nothing to reply yet`);

  const idem: IdemContext | null = await idemFrom(req, { signal_id: sig.id, status }, "results.reply");
  const hit = await replay(idem);
  if (hit) return hit;

  const r = await replyUnderCard(sig as SignalRow, status, { actor: caller.actor, subject: caller.subject }, { dryRun: body.dry_run === true });
  return remember(idem, r.status, r.body);
});
