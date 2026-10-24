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
 *
 * EzyMap_Pro_V3_3.pine (Alert Payload = JSON, alert condition "Any alert()
 * function call") sends its own format; _shared/tvpine.ts translates it:
 * live → signal + card, tp/sl/be → status update, ready/expired → ignored.
 * Replays of the same alert id are idempotent (merge on external_id).
 */
import { serve, json, bad } from "_shared/http.ts";
import { requireSecret } from "_shared/auth.ts";
import { admin } from "_shared/supabase.ts";
import { upsertSignal, validate } from "_shared/signals.ts";
import { adaptEzyMapAlert, isEzyMapPlainText } from "_shared/tvpine.ts";
import { createDraft, pushToDesk } from "_shared/content.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";
import { weekStartMyt } from "_shared/time.ts";

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
  // The indicator's plain-text alertcondition() messages carry no numbers: never a signal.
  if (isEzyMapPlainText(text)) {
    return json({ ok: true, ignored: "plain-text EzyMap alert; create the alert from 'Any alert() function call' with Alert Payload set to JSON" });
  }
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text); } catch { parsed = { note: text.slice(0, 500) }; }
  if (!parsed || typeof parsed !== "object") throw bad("alert must be a JSON object");

  // EzyMap Pro's own JSON: live → a signal + card; tp/sl/be → status update; ready/expired → ignored.
  const pine = adaptEzyMapAlert(parsed);
  if (pine?.kind === "ignore") return json({ ok: true, ignored: pine.reason });
  if (pine?.kind === "result") {
    const { data: known } = await admin().from("signals").select("id").eq("external_id", pine.entry.external_id).maybeSingle();
    if (!known) return json({ ok: true, ignored: "result for a setup TwinOS never saw go live" });
    const r = await upsertSignal({ ...pine.entry, source: "tradingview" });
    if (!r.ok) throw bad(r.error ?? "signal update failed");
    await logAction({ actor: ACTOR, action: "tv.result", target: r.id, payload: { external_id: pine.entry.external_id, status: pine.entry.status } });
    return json({ ok: true, signal_id: r.id, status_changed: r.status_changed });
  }
  // A LIVE alert reuses the card path below with the indicator's fields mapped to it.
  const alert: Record<string, unknown> = pine?.kind === "signal"
    ? {
      id: pine.entry.external_id, symbol: pine.entry.symbol, side: pine.entry.direction, entry: pine.entry.entry_low,
      sl: pine.entry.stop_price, tp1: pine.entry.tp1, rr: pine.entry.rr, tf: pine.entry.timeframe,
      setup: pine.entry.setup, counter_trend: pine.counterTrend,
    }
    : parsed;

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
    status: pine ? "running" : "pending", raw: parsed,
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

  // Weekly free-signal counter (plan §9.D.29): the channel's Monday, not UTC's.
  const weekStart = weekStartMyt();
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
