/**
 * tv-webhook — TradingView alert → signal + signal card draft (plan §9.D.22).
 *
 *   POST /tv-webhook?secret=<TWINOS_TV_SECRET>      (or header x-tv-secret)
 *   body: the alert's JSON message, e.g.
 *   {
 *     "id": "{{ticker}}-{{timenow}}", "symbol": "{{ticker}}", "tf": "{{interval}}",
 *     "side": "buy", "entry": {{close}}, "sl": 4585.0, "tp1": 4604.0, "tp2": 4612.0,
 *     "setup": "London continuation", "counter_trend": false, "note": "…"
 *   }
 *
 * TradingView cannot set headers, so the secret rides in the query string
 * (compared constant-time; never logged). The alert becomes a `signals` row
 * (source=tradingview) and a signal_card draft in the Desk group for Jack's
 * tap. A COUNTER-TREND alert keeps the kit's warning line in the card.
 * Replays of the same alert id are idempotent (merge on external_id).
 */
import { serve, json, bad } from "_shared/http.ts";
import { requireSecret } from "_shared/auth.ts";
import { admin } from "_shared/supabase.ts";
import { upsertSignal, validate } from "_shared/signals.ts";
import { createDraft, pushToDesk } from "_shared/content.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";

const ACTOR = "cron"; // alerts arrive unattended; the draft is approved by Jack
export const COUNTER_TREND_LINE = "⚠️ COUNTER-TREND: against the daily bias. Half size or skip.";

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, fn: "tv-webhook" });
  const url = new URL(req.url);
  const presented = url.searchParams.get("secret") ?? req.headers.get("x-tv-secret") ?? "";
  requireSecret(presented, Deno.env.get("TWINOS_TV_SECRET") ?? "", "tradingview");

  // TradingView sends the message as-is; accept JSON, else a plain text line.
  const text = await req.text();
  let alert: Record<string, unknown>;
  try { alert = JSON.parse(text); } catch { alert = { note: text.slice(0, 500) }; }
  if (!alert || typeof alert !== "object") throw bad("alert must be a JSON object");

  const side = String(alert.side ?? alert.direction ?? "").toLowerCase();
  const direction = side === "buy" || side === "long" ? "buy" : side === "sell" || side === "short" ? "sell" : undefined;
  const symbol = String(alert.symbol ?? alert.ticker ?? "XAUUSD").toUpperCase().slice(0, 20);
  const entry = num(alert.entry) ?? num(alert.close) ?? num(alert.price);
  const external_id = String(alert.id ?? `${symbol}-${alert.time ?? alert.timenow ?? Date.now()}`).slice(0, 120);
  const counterTrend = alert.counter_trend === true || /counter[- ]?trend/i.test(String(alert.note ?? alert.message ?? ""));

  const row = validate({
    external_id, symbol, direction,
    entry_low: num(alert.entry_low) ?? entry, entry_high: num(alert.entry_high) ?? entry,
    stop_price: num(alert.sl) ?? num(alert.stop), tp1: num(alert.tp1), tp2: num(alert.tp2),
    rr: num(alert.rr), timeframe: alert.tf ?? alert.interval, setup: alert.setup, counter_trend: counterTrend,
    status: "pending", raw: alert,
  });
  if (!row.ok) throw bad(row.error);
  const sig = await upsertSignal({ ...row.value, external_id, source: "tradingview" });
  if (!sig.ok) throw bad(sig.error ?? "signal upsert failed");

  // One card per alert id: a replayed alert does not make a second draft.
  const { data: existing } = await admin().from("content_items").select("id").eq("signal_id", sig.id).eq("post_type", "signal_card").limit(1).maybeSingle();
  if (existing) {
    await logAction({ actor: ACTOR, action: "tv.alert_replay", target: sig.id, payload: { external_id } });
    return json({ ok: true, signal_id: sig.id, content_id: existing.id, replayed: true });
  }

  // Weekly free-signal counter (plan §9.D.29).
  const weekStart = new Date(); weekStart.setUTCHours(0, 0, 0, 0); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const { count } = await admin().from("content_items").select("id", { count: "exact", head: true })
    .eq("post_type", "signal_card").gte("created_at", weekStart.toISOString());
  const n = (count ?? 0) + 1;

  const v = row.value;
  const draft = await createDraft({
    post_type: "signal_card", lang: "en",
    fields: {
      n, symbol, direction: (direction ?? "").toUpperCase(), direction_emoji: direction === "sell" ? "🔴" : "🟢",
      timeframe: v.timeframe ?? "",
      entry: v.entry_low !== undefined && v.entry_high !== undefined && v.entry_low !== v.entry_high ? `${v.entry_low}–${v.entry_high}` : v.entry_low ?? "",
      sl: v.stop_price ?? "", tp1: v.tp1 ?? "", tp2: v.tp2 ?? "", setup: v.setup ?? "",
      counter_trend_line: counterTrend ? COUNTER_TREND_LINE : "",
    },
    allowed_numbers: [v.entry_low, v.entry_high, v.stop_price, v.tp1, v.tp2, v.rr].filter((x): x is number => typeof x === "number"),
    source: { via: "tradingview", external_id },
    signal_id: sig.id,
    actor: ACTOR,
  });
  const desk = await pushToDesk(draft, { heading: `Signal card #${n}${counterTrend ? " · COUNTER-TREND" : ""}`, actor: ACTOR });
  await logTimeSaved(ACTOR, "signals.card", draft.content_id);
  return json({ ok: true, signal_id: sig.id, content_id: draft.content_id, desk, counter_trend: counterTrend }, 201);
});
