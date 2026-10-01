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
    const source = oneOf(body, "source", MANUAL_SOURCES);
    const metrics = body.metrics && typeof body.metrics === "object" ? body.metrics as Record<string, unknown> : null;
    if (!metrics) throw bad("metrics object is required");
    const clean: Record<string, number> = {};
    for (const f of MANUAL_FIELDS[source]) {
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

  if (tail[0] === "post") {
    requireRole(caller.role, "content.draft");
    const week = weekStart();
    const missing = await missingInputs(week);
    const { data: sb } = await db.from("v_friday_scoreboard").select("*").eq("week_start", week).maybeSingle();
    if (!sb) throw bad("no scoreboard row for this week yet");
    const fields: Record<string, unknown> = { week, ...sb };
    const nums = Object.values(sb).map(Number).filter(Number.isFinite);
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
