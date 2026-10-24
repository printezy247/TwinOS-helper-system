import { assertEquals } from "std/assert/mod.ts";
import { adaptEzyMapAlert, isEzyMapPlainText } from "./tvpine.ts";

// Payloads shaped exactly like EzyMap_Pro_V3_3.pine emits with Alert Payload = JSON.
const live = {
  action: "live", symbol: "XAUUSD", setup_id: "XAUUSD-15-BUY-1761000000", tf: "15",
  direction: "BUY", setup_type: "Trend pullback", risk: "Normal", entry: 4015.5,
  tp: 4046.0, sl: 4006.0, rr: 1.5, confluences: 7, confidence: "High", countertrend: false, why: "EMA bounce",
};

Deno.test("a non-EzyMap payload is left alone (null)", () => {
  assertEquals(adaptEzyMapAlert({ symbol: "XAUUSD", side: "buy", entry: 1 }), null);
});

Deno.test("LIVE becomes a signal keyed by setup_id with the indicator's numbers", () => {
  const e = adaptEzyMapAlert(live);
  if (e?.kind !== "signal") throw new Error("expected a signal");
  assertEquals(e.entry.external_id, "XAUUSD-15-BUY-1761000000");
  assertEquals(e.entry.symbol, "XAUUSD");
  assertEquals(e.entry.direction, "buy");
  assertEquals(e.entry.entry_low, 4015.5);
  assertEquals(e.entry.entry_high, 4015.5);
  assertEquals(e.entry.stop_price, 4006.0);
  assertEquals(e.entry.tp1, 4046.0);
  assertEquals(e.entry.rr, 1.5);
  assertEquals(e.entry.timeframe, "15");
  assertEquals(e.entry.setup, "Trend pullback");
  assertEquals(e.entry.status, "running");
  assertEquals(e.entry.counter_trend, false);
  assertEquals(e.counterTrend, false);
});

Deno.test("a counter-trend LIVE keeps the warning flag", () => {
  const e = adaptEzyMapAlert({ ...live, direction: "SELL", countertrend: true });
  if (e?.kind !== "signal") throw new Error("expected a signal");
  assertEquals(e.entry.direction, "sell");
  assertEquals(e.entry.counter_trend, true);
  assertEquals(e.counterTrend, true);
});

Deno.test("TP / SL / BE update the same setup's status and never open a new one", () => {
  const base = { symbol: "XAUUSD", setup_id: "XAUUSD-15-BUY-1761000000", tf: "15", direction: "BUY", risk: "Normal", entry: 4015.5, exit: 4046, pips: 305, confluences: 7 };
  const tp = adaptEzyMapAlert({ ...base, action: "tp" });
  const sl = adaptEzyMapAlert({ ...base, action: "sl", exit: 4006, pips: -95 });
  const be = adaptEzyMapAlert({ ...base, action: "be", exit: 4015.5, pips: 0 });
  if (tp?.kind !== "result" || sl?.kind !== "result" || be?.kind !== "result") throw new Error("expected results");
  assertEquals([tp.entry.status, sl.entry.status, be.entry.status], ["tp", "sl", "be"]);
  assertEquals(tp.entry.external_id, "XAUUSD-15-BUY-1761000000");
  assertEquals(tp.entry.result_pips, 305);
  assertEquals(sl.entry.result_pips, -95);
});

Deno.test("READY and EXPIRED are acknowledged but ignored", () => {
  for (const action of ["ready", "expired"]) {
    const e = adaptEzyMapAlert({ action, symbol: "XAUUSD", setup_id: "S1", direction: "BUY" });
    assertEquals(e?.kind, "ignore");
  }
});

Deno.test("an unknown action or a missing setup_id is ignored, never turned into a signal", () => {
  assertEquals(adaptEzyMapAlert({ action: "weird", setup_id: "S1" })?.kind, "ignore");
  assertEquals(adaptEzyMapAlert({ action: "live", symbol: "XAUUSD" }), null);
});

Deno.test("the indicator's plain-text alertcondition messages are recognised so they can be ignored", () => {
  assertEquals(isEzyMapPlainText("🚀 EZYMAP TRADE ALERT\n\n🟢 LIVE SIGNAL"), true);
  assertEquals(isEzyMapPlainText('{"symbol":"XAUUSD"}'), false);
});
