/**
 * health — beats in, stale check out (plan §9.M.102–104).
 *
 *   POST /health            { source, status?: ok|degraded|down, detail? }   → record a beat
 *   GET  /health            → latest beat per source + stale list + open alerts
 *   POST /health/check      {}   (cron, every 5 min) → alert Jack on stale sources and on Meta tokens
 *                                that lapse within 7 days (TWINOS_META_IG_EXPIRES, _PAGE_EXPIRES, TWINOS_THREADS_EXPIRES)
 *
 * Who: beats from ezyai, ops_bot, pc_worker, cron, abdul, jack; reads: all.
 * Expected cadence per source lives in `settings` as `health_stale_<source>`
 * (minutes), defaulting to STALE_DEFAULT_MIN.
 */
import { serve, json, readJson, routeOf, reqString, oneOf, optString, bad } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";
import { tokenWarnings } from "_shared/meta.ts";
import { sendMessage } from "_shared/tg.ts";

const SOURCES = ["ezyai", "ops_bot", "scheduler", "pc_worker", "poller", "abdul", "sales_bot"] as const;
const STALE_DEFAULT_MIN: Record<string, number> = {
  ezyai: 30, ops_bot: 24 * 60, scheduler: 5, pc_worker: 20, poller: 30, abdul: 24 * 60, sales_bot: 24 * 60,
};

async function latestBeats() {
  const db = admin();
  const out: Record<string, { status: string; at: string; detail: unknown; stale: boolean; stale_after_min: number }> = {};
  for (const source of SOURCES) {
    const { data } = await db.from("health_checks").select("status, detail, at").eq("source", source).order("at", { ascending: false }).limit(1).maybeSingle();
    const staleMin = Number((await setting(`health_stale_${source}`)) ?? STALE_DEFAULT_MIN[source]);
    const at = data?.at ?? null;
    const stale = !at || Date.now() - Date.parse(at) > staleMin * 60_000;
    out[source] = { status: data?.status ?? "never", at: at ?? "", detail: data?.detail ?? null, stale, stale_after_min: staleMin };
  }
  return out;
}

/** Meta tokens last 60 days. The expiry dates are function secrets (YYYY-MM-DD) set when a token is made. */
function metaTokenWarnings() {
  return tokenWarnings({
    instagram: Deno.env.get("TWINOS_META_IG_EXPIRES"),
    facebook: Deno.env.get("TWINOS_META_PAGE_EXPIRES"),
    threads: Deno.env.get("TWINOS_THREADS_EXPIRES"),
  });
}

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "health");
  const db = admin();

  if (method === "GET") {
    requireRole(caller.role, "reports.read");
    const beats = await latestBeats();
    const { data: alerts } = await db.from("alerts").select("id, kind, severity, message, at").is("resolved_at", null).order("at", { ascending: false }).limit(20);
    const { data: failed } = await db.from("publish_jobs").select("id", { count: "exact", head: true }).eq("status", "failed");
    const broken = Object.entries(beats).filter(([, b]) => b.stale || b.status === "down").map(([s]) => s);
    // "Anything broken?" one-line answer (plan §9.M.104)
    const tokens = metaTokenWarnings();
    const summary = broken.length || (alerts ?? []).length || tokens.length
      ? `${broken.length ? "stale: " + broken.join(", ") : "beats ok"}; ${(alerts ?? []).length} open alert(s)${tokens.length ? "; " + tokens.map((t) => t.message).join("; ") : ""}`
      : "all good";
    return json({ ok: broken.length === 0 && !tokens.some((t) => t.severity === "high"), summary, beats, tokens, open_alerts: alerts ?? [], failed_jobs: (failed as unknown as { count?: number } | null)?.count ?? null });
  }

  if (method !== "POST") throw bad("method not allowed");
  const body = await readJson(req, true);

  if (tail[0] === "check") {
    requireRole(caller.role, "health.beat");
    const beats = await latestBeats();
    const stale = Object.entries(beats).filter(([, b]) => b.stale && b.status !== "never");
    if (stale.length) {
      // One alert per source per hour, not one per tick.
      const since = new Date(Date.now() - 3600_000).toISOString();
      for (const [source, b] of stale) {
        const { data: recent } = await db.from("alerts").select("id").eq("kind", "stale_beat").contains("payload", { source }).gte("at", since).limit(1).maybeSingle();
        if (recent) continue;
        const message = `${source} has not reported for over ${b.stale_after_min} min (last: ${b.at || "never"})`;
        await db.from("alerts").insert({ kind: "stale_beat", severity: "high", message, payload: { source } });
        try {
          const jack = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
          await sendMessage(Number(jack), `⚠️ ${message}`);
        } catch (err) { console.warn("[health] alert send failed", err); }
      }
    }
    // A Meta token that lapses within 7 days: one alert a day per source.
    for (const t of metaTokenWarnings()) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { data: recent } = await db.from("alerts").select("id").eq("kind", "token_expiry").contains("payload", { source: t.source }).gte("at", since).limit(1).maybeSingle();
      if (recent) continue;
      await db.from("alerts").insert({ kind: "token_expiry", severity: t.severity, message: t.message, payload: { source: t.source, days_left: t.days_left } });
      try {
        const jack = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
        await sendMessage(Number(jack), `⚠️ ${t.message}. Make a new long-lived token and update the function secret.`);
      } catch (err) { console.warn("[health] token alert send failed", err); }
    }
    await db.from("health_checks").insert({ source: "poller", status: "ok", detail: { checked: SOURCES.length, stale: stale.map(([s]) => s) } });
    return json({ ok: true, stale: stale.map(([s]) => s) });
  }

  requireRole(caller.role, "health.beat");
  const source = oneOf(body, "source", SOURCES);
  const status = oneOf(body, "status", ["ok", "degraded", "down"] as const, "ok");
  const detail = body.detail && typeof body.detail === "object" ? body.detail : {};
  const note = optString(body, "note", 300);
  const { error } = await db.from("health_checks").insert({ source, status, detail: { ...(detail as Record<string, unknown>), note } });
  if (error) throw bad(`health_checks insert failed: ${error.message}`);
  if (status === "down") await logAction({ actor: caller.actor, action: "health.down", target: source, payload: detail as Record<string, unknown> });
  return json({ ok: true, source: reqString(body, "source"), status });
});
