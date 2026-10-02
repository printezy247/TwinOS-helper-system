/**
 * Annual-plan offer variants (Phase 7, plan §9.E.41).
 *
 * Every number comes from the products table: a monthly sku (`*_1m`) is paired
 * with its twelve-month sibling (`*_1y`) and the saving is worked out, never
 * typed. An annual price that is not cheaper than twelve months at the monthly
 * price is no offer and is skipped, and so is a product with no twin or an
 * inactive one. A price is a claim, so the drafted post always needs Jack's
 * approval; max one offer post a week still applies (settings.offer_posts_per_week_max).
 */

export interface ProductRow {
  sku: string;
  name: string;
  billing: string;
  price_usd: string | number | null;
  term_months: number | null;
  active: boolean;
}

export interface AnnualOffer {
  name: string;
  monthlySku: string;
  annualSku: string;
  monthly: number;
  annual: number;
  twelveMonths: number;
  saves: number;
  savesPct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;
const num = (v: string | number | null): number => (v === null ? NaN : Number(v));

/** "EzyAI PRO — 1 Month" -> "EzyAI PRO"; "Auto TPSL (1 Year)" -> "Auto TPSL". */
function baseName(name: string): string {
  return name
    .replace(/\s*[—–-]\s*\d+\s*(?:months?|years?|yr)s?\b.*$/i, "")
    .replace(/\s*\(\s*\d+\s*(?:months?|years?|yr)s?\s*\)\s*$/i, "")
    .trim();
}

export function annualOffers(rows: ProductRow[]): AnnualOffer[] {
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const out: AnnualOffer[] = [];
  for (const m of rows) {
    const match = /^(.+)_1m$/.exec(m.sku);
    if (!match || !m.active || m.billing !== "monthly") continue;
    const y = bySku.get(`${match[1]}_1y`);
    if (!y || !y.active || y.term_months !== 12) continue;
    const monthly = num(m.price_usd);
    const annual = num(y.price_usd);
    if (!(monthly > 0) || !(annual > 0)) continue;
    const twelve = round2(monthly * 12);
    const saves = round2(twelve - annual);
    if (saves <= 0) continue;
    out.push({
      name: baseName(m.name), monthlySku: m.sku, annualSku: y.sku, monthly, annual: round2(annual),
      twelveMonths: twelve, saves, savesPct: Math.round((saves / twelve) * 100),
    });
  }
  return out;
}

/** The offer_text for the offer template. Plain facts and the sums behind them. */
export function offerText(o: AnnualOffer): string {
  return `${o.name}, annual plan: ${money(o.annual)} for 12 months. ` +
    `Month by month it is ${money(o.monthly)} x 12 = ${money(o.twelveMonths)}, so the annual plan saves ${money(o.saves)} (${o.savesPct}%).`;
}
