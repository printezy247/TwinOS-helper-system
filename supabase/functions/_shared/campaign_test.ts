import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { campaignRows } from "./campaign.ts";

Deno.test("campaignRows: spend and depositors for a campaign become one row each, kind 'campaign'", () => {
  const rows = campaignRows({ week_start: "2026-10-12", campaign: "tt-live-2610", ad_spend_usd: 150.5, first_time_depositors: 3 });
  assertEquals(rows, [
    { week_start: "2026-10-12", kind: "campaign", metric: "ad_spend_usd", value: 150.5, campaign: "tt-live-2610", source: "campaign" },
    { week_start: "2026-10-12", kind: "campaign", metric: "first_time_depositors", value: 3, campaign: "tt-live-2610", source: "campaign" },
  ]);
});

Deno.test("campaignRows: numbers arrive as text from a form and the name is tidied", () => {
  const rows = campaignRows({ week_start: "2026-10-12", campaign: "  IG-Bio-2610 ", ib_accounts_opened: "7", ad_spend_usd: "0" });
  assertEquals(rows.map((r) => [r.metric, r.value, r.campaign]), [["ad_spend_usd", 0, "ig-bio-2610"], ["ib_accounts_opened", 7, "ig-bio-2610"]]);
});

Deno.test("campaignRows: it refuses a bad week, a bad name, a bad number, or nothing to record", () => {
  const ok = { week_start: "2026-10-12", campaign: "tt-live-2610", ad_spend_usd: 10 };
  assertThrows(() => campaignRows({ ...ok, week_start: "2026-10-14" }), Error, "Monday");
  assertThrows(() => campaignRows({ ...ok, week_start: "12/10/2026" }), Error, "week_start");
  assertThrows(() => campaignRows({ ...ok, campaign: "has space" }), Error, "campaign");
  assertThrows(() => campaignRows({ ...ok, campaign: "" }), Error, "campaign");
  assertThrows(() => campaignRows({ ...ok, ad_spend_usd: -1 }), Error, "ad_spend_usd");
  assertThrows(() => campaignRows({ ...ok, ad_spend_usd: "lots" }), Error, "ad_spend_usd");
  assertThrows(() => campaignRows({ week_start: "2026-10-12", campaign: "tt-live-2610" }), Error, "at least one");
});

Deno.test("campaignRows: first-time depositors and accounts are whole numbers", () => {
  assertThrows(() => campaignRows({ week_start: "2026-10-12", campaign: "tt", first_time_depositors: 2.5 }), Error, "whole");
});
