/**
 * friday — the Friday scoreboard (plan §4.8, §9.L.95).
 *
 *   GET  /friday?week=YYYY-MM-DD   → v_friday_scoreboard row for that week (default: this week)
 *                                   + which manual inputs are still missing
 *   POST /friday/request-inputs    {}  (cron, Friday 09:00 MYT) → asks Jack in the Desk group
 *                                   for the Vantage and TikTok numbers (two-minute form)
 *   POST /friday/manual            { week_start, source: vantage|tiktok|telechurn, metrics: {…} }
 *                                   (jack, abdul) → manual_metrics upsert
 *   POST /friday/post              {}  → drafts the scorecard post (template 7) to the Desk group
 *
 * The scorecard IMAGE (plan §9.D.28) is rendered by the PC worker (Pillow),
 * queued here as a `scorecard_image` job once the numbers are complete.
 */
import { serve, json, readJson, routeOf, reqString, oneOf, bad } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { createDraft, pushToDesk } from "_shared/content.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";
import { fanoutLine, hoursCutLine } from "_shared/hours.ts";
import { campaignRows } from "_shared/campaign.ts";
import { sendMessage } from "_shared/tg.ts";

const MANUAL_SOURCES = ["vantage", "tiktok", "telechurn"] as const;
type ManualSource = (typeof MANUAL_SOURCES)[number];
/** Fields Jack types on Friday (plan §4.8). */
export const MANUAL_FIELDS: Record<ManualSource, string[]> = {
  vantage: ["ib_accounts_opened", "first_time_depositors", "active_funded_clients", "rebates_usd"],
  tiktok: ["followers", "profile_views", "watch_time_min", "pct_watched_full"],
  telechurn: ["joins", "leaves", "retention_7d_pct"],
};

function weekStart(d = new Date()): string {
  const x = new Date(d); x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); // Monday
  return x.toISOString().slice(0, 10);
}

async function missingInputs(week: string): Promise<ManualSource[]> {
  const { data } = await admin().from("manual_metrics").select("source").eq("week_start", week);
  const have = new Set((data ?? []).map((r) => r.source));
  return MANUAL_SOURCES.filter((s) => !have.has(s));
}

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "friday");
  const db = admin();

  if (method === "GET") {
    requireRole(caller.role, "reports.read");
    const week = new URL(req.url).searchParams.get("week") ?? weekStart();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw bad("week must be YYYY-MM-DD (a Monday)");
    const { data, error } = await db.from("v_friday_scoreboard").select("*").eq("week_start", week).maybeSingle();
    if (error) throw bad(`v_friday_scoreboard: ${error.message}`);
    return json({ week_start: week, scoreboard: data ?? null, missing_inputs: await missingInputs(week) });
  }
  if (method !== "POST") throw bad("method not allowed");
  const body = await readJson(req, true);

  if (tail[0] === "request-inputs") {
    requireRole(caller.role, "content.draft");
    const week = weekStart();
    const missing = await missingInputs(week);
    const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
    if (missing.length) {
      const lines = missing.map((s) => `• <b>${s}</b>: ${MANUAL_FIELDS[s].join(", ")}`).join("\n");
      await sendMessage(desk, `📋 Friday numbers for week ${week}. Reply in the dashboard (Analytics → Friday) or tell ABDUL "friday vantage 3 2 41 180":\n${lines}`, { parse_mode: "HTML" });
    }
    await logAction({ actor: caller.actor, action: "friday.request_inputs", payload: { week, missing } });
    return json({ ok: true, week_start: week, missing });
  }

  if (tail[0] === "manual") {
    requireRole(caller.role, "metrics.manual");
    const week = reqString(body, "week_start", { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw bad("week_start must be YYYY-MM-DD");
    // "ads" (the week's ad spend) is optional: it is never listed as a missing input, so a week with no ads is not nagged.
    const source = oneOf(body, "source", [...MANUAL_SOURCES, "ads"] as const);
    const metrics = body.metrics && typeof body.metrics === "object" ? body.metrics as Record<string, unknown> : null;
    if (!metrics) throw bad("metrics object is required");
    const clean: Record<string, number> = {};
    for (const f of source === "ads" ? ["ad_spend_usd"] : MANUAL_FIELDS[source]) {
      const n = Number(metrics[f]);
      if (!Number.isFinite(n)) throw bad(`metrics.${f} must be a number`, { field: f });
      clean[f] = n;
    }
    // One summary row per (week, source). The unique index behind it is partial
    // (only rows that carry `metrics`), which ON CONFLICT cannot infer, so look
    // the row up and update it, else insert.
    const { data: existing } = await db.from("manual_metrics").select("id")
      .eq("week_start", week).eq("source", source).not("metrics", "is", null).maybeSingle();
    const { error } = existing
      ? await db.from("manual_metrics").update({ metrics: clean, entered_by: caller.actor }).eq("id", existing.id)
      : await db.from("manual_metrics").insert({ week_start: week, source, metrics: clean, entered_by: caller.actor });
    if (error) throw bad(`manual_metrics: ${error.message}`);
    await logAction({ actor: caller.actor, action: "metrics.manual", target: `${week}/${source}`, payload: clean });
    return json({ ok: true, week_start: week, source, missing_inputs: await missingInputs(week) });
  }

  // POST /friday/campaign { week_start, campaign, ad_spend_usd?, first_time_depositors?, ib_accounts_opened? }
  // One campaign's numbers (a TikTok live, a swap, an ad set) for cost per first-time depositor (v_campaign_cost).
  // They are rows of their own kind, so they never add to the week's totals.
  if (tail[0] === "campaign") {
    requireRole(caller.role, "metrics.manual");
    let rows;
    try {
      rows = campaignRows(body);
    } catch (err) {
      throw bad(err instanceof Error ? err.message : String(err));
    }
    const { error } = await db.from("manual_metrics")
      .upsert(rows.map((r) => ({ ...r, entered_by: caller.actor })), { onConflict: "week_start,kind,metric,campaign" });
    if (error) throw bad(`manual_metrics: ${error.message}`);
    await logAction({ actor: caller.actor, action: "metrics.campaign", target: `${rows[0].week_start}/${rows[0].campaign}`, payload: { metrics: rows.map((r) => r.metric) } });
    return json({ ok: true, week_start: rows[0].week_start, campaign: rows[0].campaign, metrics: rows.length });
  }

  if (tail[0] === "post") {
    requireRole(caller.role, "content.draft");
    const week = weekStart();
    const missing = await missingInputs(week);
    const { data: sb } = await db.from("v_friday_scoreboard").select("*").eq("week_start", week).maybeSingle();
    if (!sb) throw bad("no scoreboard row for this week yet");
    // The kit's scorecard quotes the week's results (v_results_weekly) and links the board.
    const { data: wk } = await db.from("v_results_weekly")
      .select("signals, wins, losses, break_even, strict_win_rate, total_r, best_trade, worst_trade")
      .eq("week_start", week).maybeSingle();
    const { data: boardRow } = await db.from("settings").select("value").eq("key", "board_url").maybeSingle();
    const trade = (t: { pair?: string; direction?: string; r?: number } | null | undefined) =>
      t ? `${t.pair ?? ""} ${t.direction ?? ""} ${Number(t.r) > 0 ? "+" : ""}${t.r}R`.replace(/\s+/g, " ").trim() : "";
    const weekly = wk
      ? {
        signals: wk.signals, wins: wk.wins, losses: wk.losses, break_even: wk.break_even,
        wl: Number(wk.wins) + Number(wk.losses), strict_win_rate: wk.strict_win_rate, total_r: wk.total_r,
        best: trade(wk.best_trade), worst: trade(wk.worst_trade),
      }
      : {};
    const fields: Record<string, unknown> = { week, ...sb, ...weekly, board_url: boardRow?.value ?? "" };
    // The hours lines: TwinOS's saved time against the baseline week (v_hours_cut, Phase 3 exit: 60%
    // or more) and how many fanned-out posts reached every platform (v_fanout_week).
    const [{ data: cut }, { data: fan }] = await Promise.all([
      db.from("v_hours_cut").select("baseline_min, saved_min").eq("week_start", week).maybeSingle(),
      db.from("v_fanout_week").select("providers, published").eq("week_start", week),
    ]);
    const fanRows = (fan ?? []).filter((r) => Number(r.providers) > 0);
    const hoursLines = [
      hoursCutLine(Number(cut?.baseline_min ?? 0), Number(cut?.saved_min ?? 0)),
      fanoutLine(fanRows.length, fanRows.filter((r) => Number(r.published) === Number(r.providers)).length),
    ].filter((l): l is string => !!l);
    if (hoursLines.length) fields.hours = hoursLines.join("\n");
    const nums = [...Object.values(sb), ...Object.values(weekly), wk?.best_trade?.r, wk?.worst_trade?.r].map(Number).filter(Number.isFinite);
    const draft = await createDraft({
      post_type: "scorecard", lang: "en", fields, allowed_numbers: nums,
      source: { via: "friday", week, missing }, actor: caller.actor,
    });
    await db.from("jobs").insert({ kind: "scorecard_image", payload: { content_id: draft.content_id, week, scoreboard: sb }, status: "queued", created_by: caller.actor });
    const desk = await pushToDesk(draft, { heading: `Friday scorecard ${week}${missing.length ? " (inputs missing: " + missing.join(", ") + ")" : ""}`, actor: caller.actor });
    await logTimeSaved(caller.actor, "friday.report", draft.content_id);
    return json({ ok: true, content_id: draft.content_id, desk, missing_inputs: missing }, 201);
  }

  throw bad("unknown route");
});
