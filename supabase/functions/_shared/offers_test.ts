import { assert, assertEquals } from "std/assert/mod.ts";
import { annualOffers, offerText, type ProductRow } from "./offers.ts";
import { bannedWords, detectClaims } from "./compliance.ts";

const P = (sku: string, name: string, billing: string, price: string | null, term: number | null, active = true): ProductRow =>
  ({ sku, name, billing, price_usd: price, term_months: term, active });

const PRODUCTS: ProductRow[] = [
  P("ezyai_pro_1m", "EzyAI PRO — 1 Month", "monthly", "14.99", 1),
  P("ezyai_pro_6m", "EzyAI PRO — 6 Months", "one_time", "44.99", 6),
  P("ezyai_pro_1y", "EzyAI PRO — 12 Months", "one_time", "99.99", 12),
  P("mt5_bundle_1m", "MT5 Indicator Bundle — 1 Month", "monthly", "99.00", 1),
  P("mt5_bundle_1y", "MT5 Indicator Bundle — 1 Year", "one_time", "999.00", 12),
  P("macro_full_desk", "Full Macro Desk", "monthly", "19.00", 1), // no annual twin
  P("tv_pro", "TradingView — EzyMap Pro", "lifetime", "249.00", null),
  P("mt5_auto_tpsl_1m", "Auto TPSL (1 Month)", "monthly", "9.00", 1),
  P("mt5_auto_tpsl_1y", "Auto TPSL (1 Year)", "one_time", "99.00", 12, false), // inactive: never offered
];

Deno.test("annualOffers: a monthly price paired with its 12-month sibling, savings worked out from the table", () => {
  const offers = annualOffers(PRODUCTS);
  assertEquals(offers.map((o) => o.annualSku), ["ezyai_pro_1y", "mt5_bundle_1y"]);
  const ai = offers[0];
  assertEquals(ai.monthly, 14.99);
  assertEquals(ai.annual, 99.99);
  assertEquals(ai.twelveMonths, 179.88);
  assertEquals(ai.saves, 79.89);
  assertEquals(ai.savesPct, 44);
});

Deno.test("annualOffers: a dearer annual price is no offer, and a product with no twin is skipped", () => {
  const rows = [P("x_1m", "X (1 Month)", "monthly", "5.00", 1), P("x_1y", "X (1 Year)", "one_time", "70.00", 12)];
  assertEquals(annualOffers(rows), []);
  assertEquals(annualOffers([P("solo_1m", "Solo", "monthly", "9.00", 1)]), []);
  assertEquals(annualOffers([P("n_1m", "N", "monthly", null, 1), P("n_1y", "N", "one_time", "9.00", 12)]), []);
});

Deno.test("offerText: only numbers from the table, and nothing the compliance engine bans", () => {
  const o = annualOffers(PRODUCTS)[0];
  const text = offerText(o);
  assert(text.includes("$99.99"));
  assert(text.includes("$14.99"));
  assert(text.includes("$179.88"));
  assert(text.includes("$79.89"));
  assert(text.includes("EzyAI PRO"));
  assertEquals(bannedWords(text), []);
  assert(detectClaims(text).some((c) => c.kind === "price"), "a price is a claim: Jack must approve");
});

Deno.test("offerText: the product name loses its term, so '1 Month' does not appear in an annual offer", () => {
  const text = offerText(annualOffers(PRODUCTS)[1]);
  assert(!/1 Month/i.test(text));
  assert(text.includes("MT5 Indicator Bundle"));
});
