import { assertEquals } from "std/assert/mod.ts";
import { validate } from "./signals.ts";

/**
 * The payload contract EzyAi's signal bot relies on (docs/SIGNAL-BOT.md,
 * docs/API.md). If any of these change, the bot's push breaks.
 */

Deno.test("a full signal row passes and keeps its numbers", () => {
  const r = validate({
    external_id: "auto-8842",
    symbol: "XAUUSD",
    direction: "buy",
    status: "running",
    entry_low: 4590.2,
    entry_high: 4593.0,
    stop_price: 4585.0,
    tp1: 4604.0,
    tp2: 4612.0,
    rr: 2.4,
    setup: "London continuation",
    timeframe: "M15",
    quality: "live",
    counter_trend: true,
  });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.value.external_id, "auto-8842");
  assertEquals(r.value.direction, "buy");
  assertEquals(r.value.status, "running");
  assertEquals(r.value.entry_low, 4590.2);
  assertEquals(r.value.counter_trend, true);
  assertEquals(r.value.quality, "live");
});

Deno.test("an outcome-only row is valid: just the id and the new status", () => {
  const r = validate({ external_id: "auto-8841", status: "tp1", result_r: 1.2, result_pips: 70 });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.value.status, "tp1");
  assertEquals(r.value.result_r, 1.2);
  assertEquals(r.value.result_pips, 70);
});

Deno.test("every documented status is accepted", () => {
  for (const status of ["pending", "running", "tp", "tp1", "tp2", "be", "sl", "cancelled"]) {
    assertEquals(validate({ external_id: "x", status }).ok, true, status);
  }
});

Deno.test("external_id is the one hard requirement", () => {
  assertEquals(validate({}).ok, false);
  assertEquals(validate({ external_id: "" }).ok, false);
  assertEquals(validate({ external_id: "   " }).ok, false);
  assertEquals(validate({ external_id: "x".repeat(121) }).ok, false);
});

Deno.test("a bad status or direction is refused, not silently dropped", () => {
  assertEquals(validate({ external_id: "x", status: "won" }).ok, false);
  assertEquals(validate({ external_id: "x", direction: "long" }).ok, false);
});

Deno.test("a non-numeric price is refused", () => {
  assertEquals(validate({ external_id: "x", tp1: "soon" }).ok, false);
  assertEquals(validate({ external_id: "x", entry_low: {} }).ok, false);
});

Deno.test("numbers arrive as strings from JSON bridges and are coerced", () => {
  const r = validate({ external_id: "x", tp1: "4604.5" });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value.tp1, 4604.5);
});

Deno.test("demo and shadow are carried through so the publisher can exclude them", () => {
  const demo = validate({ external_id: "x", quality: "demo" });
  const shadow = validate({ external_id: "x", quality: "shadow" });
  assertEquals(demo.ok && demo.value.quality, "demo");
  assertEquals(shadow.ok && shadow.value.quality, "shadow");
});

Deno.test("free-text fields are capped at 120 characters", () => {
  const r = validate({ external_id: "x", setup: "s".repeat(300) });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value.setup!.length, 120);
});

Deno.test("the raw alert is kept for the audit trail", () => {
  const r = validate({ external_id: "x", raw: { from: "ezyai", score: 3 } });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value.raw, { from: "ezyai", score: 3 });
});
