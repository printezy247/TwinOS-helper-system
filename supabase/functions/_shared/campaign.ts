/**
 * Per-campaign numbers for cost per first-time depositor (Phase 6, plan §9.H.69).
 *
 * The Friday form takes the week's totals. A campaign (a TikTok live, a
 * Telegram swap, an ad set) gets its own rows: kind 'campaign', one row per
 * metric, the campaign name in `campaign`. They are a separate kind so they
 * never add to the weekly totals in v_funnel / v_friday_scoreboard;
 * v_campaign_cost reads them.
 */
import { mondayOf } from "./batch.ts";

export interface CampaignRow {
  week_start: string;
  kind: "campaign";
  metric: string;
  value: number;
  campaign: string;
  source: "campaign";
}

const FIELDS = ["ad_spend_usd", "first_time_depositors", "ib_accounts_opened"] as const;
const WHOLE = new Set<string>(["first_time_depositors", "ib_accounts_opened"]);
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function campaignRows(b: Record<string, unknown>): CampaignRow[] {
  const week = typeof b.week_start === "string" ? b.week_start : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error("week_start must be YYYY-MM-DD");
  if (mondayOf(week) !== week) throw new Error("week_start must be a Monday");
  const campaign = typeof b.campaign === "string" ? b.campaign.trim().toLowerCase() : "";
  if (!SLUG.test(campaign)) throw new Error("campaign must be 2-40 characters: letters, digits and dashes (e.g. tt-live-2610)");

  const rows: CampaignRow[] = [];
  for (const metric of FIELDS) {
    const raw = b[metric];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${metric} must be a number of zero or more`);
    if (WHOLE.has(metric) && !Number.isInteger(value)) throw new Error(`${metric} must be a whole number`);
    rows.push({ week_start: week, kind: "campaign", metric, value, campaign, source: "campaign" });
  }
  if (!rows.length) throw new Error("give at least one of ad_spend_usd, first_time_depositors, ib_accounts_opened");
  return rows;
}
