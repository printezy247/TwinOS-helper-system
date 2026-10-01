/**
 * signals-ingest — EzyAi pushes signals and outcomes (plan §9.B.10, §9.D.23).
 * Port of printezy's /api/public/ezyai/signals contract:
 *
 *   POST /signals-ingest   { ...one signal }  |  { signals: [ … ] }   (batch ≤ 50)
 *   GET  /signals-ingest   → signals still on the board
 *   GET  /signals-ingest?diagnose=1 → key fingerprint check (auth'd here, unlike printezy)
 *
 * Auth: `Authorization: Bearer twk_ezyai_…` (api_keys table, role ezyai).
 * Every row is a merge on external_id. Per-row results; 200 all ok, 207 mixed,
 * 400 none ok. Demo/shadow rows are stored but flagged `quality` so the
 * publisher never posts them (plan §9.D.27). A status change to tp/be/sl
 * enqueues a result reply through the results function.
 */
import { serve, json, bad } from "_shared/http.ts";
import { apiKeyFrom, authenticate, bearer, fingerprint } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin } from "_shared/supabase.ts";
import { upsertSignal, validate, type RowResult } from "_shared/signals.ts";
import { logAction } from "_shared/log.ts";

const MAX_BATCH = 50;
const CLOSED = ["tp", "tp1", "tp2", "be", "sl"];

async function queueResultReply(signalId: string, status: string, actor: string) {
  // The results function does the posting; here we only enqueue, so EzyAi's
  // push returns fast even if Telegram is slow.
  await admin().from("jobs").insert({
    kind: "result_reply", payload: { signal_id: signalId, status }, status: "queued",
    priority: 10, run_at: new Date().toISOString(), created_by: actor,
  });
}

serve(async (req) => {
  const caller = await authenticate(req);
  requireRole(caller.role, "signals.ingest");
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("diagnose") === "1") {
      return json({ configured: true, role: caller.role, key: caller.keyName, presented_fingerprint: await fingerprint(apiKeyFrom(req) || bearer(req)) });
    }
    const { data } = await admin().from("signals")
      .select("external_id, symbol, direction, status, entry_low, entry_high, stop_price, tp1, tp2, rr, opened_at, updated_at")
      .in("status", ["pending", "running"]).order("opened_at", { ascending: false }).limit(100);
    return json({ signals: data ?? [] });
  }
  if (req.method !== "POST") throw bad("method not allowed");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("expected a JSON object");
  const batch = Array.isArray(body.signals) ? body.signals : [body];
  if (batch.length === 0) throw bad("no signals in the payload");
  if (batch.length > MAX_BATCH) throw bad(`at most ${MAX_BATCH} signals per request`);

  const results: RowResult[] = [];
  for (const entry of batch) {
    if (!entry || typeof entry !== "object") { results.push({ ok: false, error: "each signal must be an object" }); continue; }
    const v = validate(entry as Record<string, unknown>);
    if (!v.ok) { results.push({ ok: false, external_id: String((entry as Record<string, unknown>).external_id ?? ""), error: v.error }); continue; }
    const r = await upsertSignal({ ...v.value, external_id: v.value.external_id!, source: "ezyai" });
    results.push(r);
    const quality = (v.value.quality ?? "live").toLowerCase();
    if (r.ok && r.id && r.status_changed && CLOSED.includes(r.status_changed.to) && quality === "live") {
      await queueResultReply(r.id, r.status_changed.to, caller.actor);
    }
  }

  const accepted = results.filter((r) => r.ok).length;
  await logAction({
    actor: caller.actor, action: "signals.ingest",
    payload: { accepted, total: results.length, first: results[0]?.external_id ?? null },
  });
  await admin().from("health_checks").insert({ source: "ezyai", status: "ok", detail: { accepted, total: results.length } });
  const status = accepted === results.length ? 200 : accepted === 0 ? 400 : 207;
  return json({ accepted, results }, status);
});
