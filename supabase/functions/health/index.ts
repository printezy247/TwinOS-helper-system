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
import { serve, json, readJson, routeOf, reqString, oneOf, optString, bad, HttpError } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, setting, settingTyped, SETTING_KEYS } from "_shared/supabase.ts";
import { dayAndWeekStart, todaySummary } from "_shared/today.ts";
import { logAction } from "_shared/log.ts";
import { tokenWarnings } from "_shared/meta.ts";
import { escapeHtml, sendMessage } from "_shared/tg.ts";
import { integrationStatus } from "_shared/integrations.ts";
import { runProviderChecks } from "_shared/providers.ts";
import { deskAlert, staleBeatPlan, UPDATE_FAILURE_WINDOW_MS, updateFailuresExceeded } from "_shared/alerts.ts";
import { channelStage, feedStale, FEED_STALE_MS } from "_shared/insights.ts";
import { currentTrace } from "_shared/trace.ts";
import { log } from "_shared/logger.ts";
import { registerGauge, renderProm } from "_shared/metrics.ts";
import { limiterSnapshot } from "_shared/backoff.ts";

/* Phase 4 gauges: read live at scrape time (global by construction), unlike
   the isolate-local request counters metrics.ts accumulates. */
registerGauge("twinos_jobs_queued", "Jobs with status=queued right now.", async () => {
  const { count } = await admin().from("jobs").select("id", { count: "exact", head: true }).eq("status", "queued");
  return count ?? 0;
});
registerGauge("twinos_alerts_open", "Alerts not yet resolved.", async () => {
  const { count } = await admin().from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null);
  return count ?? 0;
});
registerGauge("twinos_ratelimit_available", "Tokens left in the registered limiter; -1 when none is registered/readable.", () => {
  const vals = Object.values(limiterSnapshot());
  return vals.length ? Math.min(...vals) : -1;
});

const SOURCES = ["ezyai", "ops_bot", "scheduler", "pc_worker", "poller", "abdul", "sales_bot"] as const;
const STALE_DEFAULT_MIN: Record<string, number> = {
  ezyai: 30, ops_bot: 24 * 60, scheduler: 5, pc_worker: 20, poller: 30, abdul: 24 * 60, sales_bot: 24 * 60,
};

async function latestBeats() {
  const db = admin();
  const out: Record<string, { status: string; at: string; detail: unknown; stale: boolean; stale_after_min: number }> = {};
  for (const source of SOURCES) {
    const { data } = await db.from("health_checks").select("status, detail, at").eq("source", source).order("at", { ascending: false }).limit(1).maybeSingle();
    // Decision 1 (Phase 1): per-source minutes win; a source without a row
    // falls back to the global hours setting, then to the hardcoded default.
    const globalHours = Number(await settingTyped("health_stale_threshold_hours"));
    const fallback = Number.isFinite(globalHours) && globalHours > 0 ? globalHours * 60 : STALE_DEFAULT_MIN[source];
    const staleMin = Number((await settingTyped(`health_stale_${source}`)) ?? fallback);
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

/** The secret names integrationStatus reads; values never leave the function. */
function functionEnv(): Record<string, string | undefined> {
  return {
    TWINOS_OPS_BOT_TOKEN: Deno.env.get("TWINOS_OPS_BOT_TOKEN"),
    TWINOS_TV_SECRET: Deno.env.get("TWINOS_TV_SECRET"),
    TWINOS_META_IG_USER_ID: Deno.env.get("TWINOS_META_IG_USER_ID"),
    TWINOS_META_IG_TOKEN: Deno.env.get("TWINOS_META_IG_TOKEN"),
    TWINOS_META_PAGE_ID: Deno.env.get("TWINOS_META_PAGE_ID"),
    TWINOS_META_PAGE_TOKEN: Deno.env.get("TWINOS_META_PAGE_TOKEN"),
    TWINOS_THREADS_USER_ID: Deno.env.get("TWINOS_THREADS_USER_ID"),
    TWINOS_THREADS_TOKEN: Deno.env.get("TWINOS_THREADS_TOKEN"),
    TWINOS_YT_REFRESH_TOKEN: Deno.env.get("TWINOS_YT_REFRESH_TOKEN"),
  };
}

const LIVE_PROVIDERS = ["telegram", "instagram", "facebook", "threads"] as const;

async function latestProviders() {
  const db = admin();
  const out: Record<string, { status: string; at: string; detail: unknown }> = {};
  for (const name of LIVE_PROVIDERS) {
    const { data } = await db.from("health_checks").select("status, detail, at")
      .eq("source", `provider_${name}`).order("at", { ascending: false }).limit(1).maybeSingle();
    out[name] = { status: data?.status ?? "never", at: data?.at ?? "", detail: data?.detail ?? null };
  }
  return out;
}

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "health");
  const db = admin();

  // GET /health/today — ABDUL's read-only status line (any reports.read caller, the viewer key included).
  if (method === "GET" && tail[0] === "today") {
    requireRole(caller.role, "reports.read");
    const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
    const { day, week } = dayAndWeekStart(tz);
    const end = new Date(Date.parse(day) + 86_400_000).toISOString();
    const [pub, saved, pending] = await Promise.all([
      db.from("publish_jobs").select("platform, run_at, status, last_error").gte("run_at", day).lt("run_at", end).order("run_at").limit(200),
      db.from("time_saved").select("minutes_saved").gte("occurred_at", week).limit(5000),
      db.from("content_items").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
    ]);
    const err = pub.error ?? saved.error ?? pending.error;
    if (err) throw new HttpError(503, "upstream_failed", err.message);
    return json({ day, week, ...todaySummary(pub.data ?? [], (saved.data ?? []).map((r) => r.minutes_saved), pending.count ?? 0) });
  }

  // GET /health/check — the deep readiness probe (UPGRADE-PHASES Phase 4):
  // five live checks in one payload, { ok, checks: { db, realtime,
  // openrouter, telegram, storage } }. It spends real provider calls, so it
  // is a button/poll target, not something to spam.
  if (method === "GET" && tail[0] === "check") {
    requireRole(caller.role, "reports.read");
    const checks: Record<string, { ok: boolean; detail: string }> = {};

    const { error: dbErr } = await db.from("settings").select("key").limit(1);
    checks.db = dbErr ? { ok: false, detail: dbErr.message } : { ok: true, detail: "postgrest query ok" };

    const { data: pubCount, error: pubErr } = await db.rpc("twinos_realtime_publication_count");
    checks.realtime = pubErr
      ? { ok: false, detail: pubErr.message }
      : { ok: Number(pubCount) > 0, detail: `${Number(pubCount)} tables in supabase_realtime` };

    const orKey = Deno.env.get("TWINOS_OPENROUTER_API_KEY") || Deno.env.get("OPENROUTER_API_KEY");
    if (!orKey) checks.openrouter = { ok: false, detail: "OPENROUTER_API_KEY not set" };
    else {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${orKey}` },
          signal: AbortSignal.timeout(4000),
        });
        checks.openrouter = r.ok
          ? { ok: true, detail: "models endpoint reachable" }
          : { ok: false, detail: `openrouter HTTP ${r.status}` };
      } catch (e) {
        checks.openrouter = { ok: false, detail: `openrouter unreachable: ${(e as Error).message}` };
      }
    }

    const bot = Deno.env.get("TWINOS_OPS_BOT_TOKEN");
    if (!bot) checks.telegram = { ok: false, detail: "TWINOS_OPS_BOT_TOKEN not set" };
    else {
      try {
        const r = await fetch(`https://api.telegram.org/bot${bot}/getWebhookInfo`, { signal: AbortSignal.timeout(4000) });
        const j = await r.json() as { ok: boolean; result?: { url?: string; last_error_message?: string } };
        checks.telegram = j.ok
          ? {
              ok: !j.result?.last_error_message,
              detail: j.result?.url
                ? `webhook set${j.result.last_error_message ? ` (last error: ${j.result.last_error_message})` : ""}`
                : "no webhook (pull mode)",
            }
          : { ok: false, detail: "telegram API refused the call" };
      } catch (e) {
        checks.telegram = { ok: false, detail: `telegram unreachable: ${(e as Error).message}` };
      }
    }

    const { error: stErr } = await db.storage.from("assets").list("", { limit: 1 });
    checks.storage = stErr ? { ok: false, detail: stErr.message } : { ok: true, detail: "assets bucket listable" };

    const ok = Object.values(checks).every((c) => c.ok);
    log(ok ? "info" : "warn", "health.check.deep", { ok });
    return json({ ok, checks, trace_id: currentTrace() });
  }

  // GET /health/metrics — Prometheus exposition (Phase 4): the global
  // request series (request_stats) plus the live DB gauges registered at
  // module load. Isolate-local counters are deliberately not shown — they
  // depend on which isolate the scrape lands on.
  if (method === "GET" && tail[0] === "metrics") {
    requireRole(caller.role, "reports.read");
    const { data: stats, error: statsErr } = await db
      .from("request_stats")
      .select("route, cls, count, errors, ms_sum, ms_max");
    if (statsErr) throw new HttpError(503, "upstream_failed", statsErr.message);
    const body = await renderProm((stats ?? []) as Array<{
      route: string; cls: string; count: number; errors: number; ms_sum: number; ms_max: number
    }>);
    return new Response(body, {
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  }

  // GET /health/ratelimit — registered token buckets (Phase 4). Honest empty
  // state: backoff.ts RateLimiter exists but is not yet wired to a request
  // path, so this reports none active instead of inventing headroom.
  if (method === "GET" && tail[0] === "ratelimit") {
    requireRole(caller.role, "reports.read");
    const limiters = limiterSnapshot();
    return json({
      limiters,
      active: Object.keys(limiters).length,
      ...(Object.keys(limiters).length
        ? {}
        : { note: "No request-path limiters registered yet — the bucket (backoff.ts RateLimiter) activates once /health/metrics shows real saturation." }),
    });
  }

  if (method === "GET") {
    requireRole(caller.role, "reports.read");
    const beats = await latestBeats();
    const { data: alerts } = await db.from("alerts").select("id, kind, severity, message, at").is("resolved_at", null).order("at", { ascending: false }).limit(20);
    const { count: failedCount } = await db.from("publish_jobs").select("id", { count: "exact", head: true }).eq("status", "failed");
    const broken = Object.entries(beats).filter(([, b]) => b.stale || b.status === "down").map(([s]) => s);
    // "Anything broken?" one-line answer (plan §9.M.104)
    const tokens = metaTokenWarnings();
    const integrations = integrationStatus(functionEnv());
    const providers = await latestProviders();
    const provDown = Object.entries(providers).filter(([, p]) => p.status === "down").map(([s]) => s);
    const summary = broken.length || (alerts ?? []).length || tokens.length || provDown.length
      ? `${broken.length ? "stale: " + broken.join(", ") : "beats ok"}; ${(alerts ?? []).length} open alert(s)${tokens.length ? "; " + tokens.map((t) => t.message).join("; ") : ""}${provDown.length ? "; provider down: " + provDown.join(", ") : ""}`
      : "all good";
    return json({ ok: broken.length === 0 && provDown.length === 0 && !tokens.some((t) => t.severity === "high"), summary, beats, tokens, integrations, providers, open_alerts: alerts ?? [], failed_jobs: failedCount ?? null });
  }

  if (method !== "POST") throw bad("method not allowed");
  const body = await readJson(req, true);

  if (tail[0] === "check") {
    requireRole(caller.role, "health.beat");
    const beats = await latestBeats();
    const stale = Object.entries(beats).filter(([, b]) => b.stale && b.status !== "never");
    // One open alert per stale source (see staleBeatPlan): bump it, close it on
    // recovery, raise one only when none is open. Runs even with nothing stale,
    // so a recovered source stops showing as an open alert.
    const { data: openRows } = await db.from("alerts").select("id, at, payload").eq("kind", "stale_beat").is("resolved_at", null);
    const open = (openRows ?? []).map((r) => ({
      id: r.id as string,
      at: r.at as string,
      source: String((r.payload as { source?: string } | null)?.source ?? ""),
      repeats: Number((r.payload as { repeats?: number } | null)?.repeats ?? 0),
    })).filter((r) => r.source);
    const plan = staleBeatPlan(open, stale.map(([source]) => source));
    if (plan.resolve.length) await db.from("alerts").update({ resolved_at: new Date().toISOString() }).in("id", plan.resolve);
    const staleMessage = (source: string) => {
      const b = beats[source];
      return `${source} has not reported for over ${b?.stale_after_min} min (last: ${b?.at || "never"})`;
    };
    const nudge = async (message: string) => {
      try {
        const jack = await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID");
        await sendMessage(Number(jack), `⚠️ ${message}`);
      } catch (err) { console.warn("[health] alert send failed", err); }
    };
    for (const bump of plan.bump) {
      const row = open.find((o) => o.id === bump.id)!;
      const message = staleMessage(row.source);
      await db.from("alerts").update({
        message,
        payload: { source: row.source, repeats: bump.repeats },
        ...(bump.notify ? { at: new Date().toISOString() } : {}),
      }).eq("id", bump.id);
      if (bump.notify) await nudge(message);
    }
    for (const source of plan.insert) {
      const message = staleMessage(source);
      await db.from("alerts").insert({ kind: "stale_beat", severity: "high", message, payload: { source, repeats: 0 }, dedupe_key: `stale_beat:${source}` });
      await nudge(message);
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
    // Live provider checks: record every run, alert only on a change or a recovery.
    const live = await runProviderChecks(functionEnv());
    const changed: string[] = [];
    for (const r of live) {
      if (r.detail === "needs-credentials") continue;
      const src = `provider_${r.provider}`;
      const { data: prev } = await db.from("health_checks").select("status").eq("source", src).order("at", { ascending: false }).limit(1).maybeSingle();
      const next = r.ok ? "ok" : "down";
      await db.from("health_checks").insert({ source: src, status: next, detail: { check: r.detail } });
      if (!prev || prev.status === next) continue;
      changed.push(r.provider);
      if (r.ok) {
        await deskAlert({ db, key: src, kind: "provider_recovery", severity: "info", message: `✅ ${r.provider} is back.` });
      } else {
        await deskAlert({ db, key: src, kind: "provider_down", severity: "high", message: `⚠️ ${r.provider} check failed: ${escapeHtml(r.detail)}` });
      }
    }
    // A channel that goes quiet loses members (2026 research): past the gap,
    // tell the Desk once per cooldown instead of letting it fade silently.
    const { data: lastPost } = await db.from("tg_posts")
      .select("posted_at").order("posted_at", { ascending: false }).limit(1).maybeSingle();
    // A channel with no post on record is not quiet, it is not in use yet —
    // the same rule the beats use above (never reported is setup, not an
    // outage). Before this, a project that had not published once warned
    // every cooldown forever. Once there is a first post, it behaves as before.
    if (lastPost) {
      const stage = channelStage(lastPost.posted_at as string, Date.now());
      if (stage === "quiet") {
        await deskAlert({
          db,
          key: "channel-quiet",
          kind: "channel_stale",
          severity: "high",
          message: "\u26A0\uFE0F Nothing has posted to the channel in over 36 hours. A quiet channel loses members \u2014 queue a map or a lesson.",
        });
        // The 30 h heads-up is obsolete once the real alert stands: close it
        // so the Desk log keeps one live thread per problem.
        await db.from("alerts").update({ resolved_at: new Date().toISOString() })
          .eq("dedupe_key", "err:channel-quiet-soon").is("resolved_at", null);
      } else if (stage === "nudge") {
        await deskAlert({
          db,
          key: "channel-quiet-soon",
          kind: "channel_stale",
          severity: "info",
          message: "\u23F0 Nothing has posted in about 30 hours. If today's map or lesson is ready, queue it \u2014 the quiet alert fires at 36.",
        });
      }
    }
    // The research feeds are polled every 6 hours: when the newest run is
    // older than two cycles the cron itself is the thing that broke, and
    // Monday's brief plus the idea list quietly age out if nobody says so.
    const { data: newestFeed } = await db.from("feeds")
      .select("name, last_fetched_at").eq("active", true)
      .order("last_fetched_at", { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    if (feedStale((newestFeed?.last_fetched_at as string | null) ?? null, Date.now(), FEED_STALE_MS)) {
      await deskAlert({
        db,
        key: "research-feeds",
        kind: "feeds_stale",
        severity: "medium",
        message: `\u26A0\uFE0F The research feeds have not been polled in over 12 hours (last run: ${newestFeed?.name ? escapeHtml(String(newestFeed.name)) : "never"}). Monday's brief and the idea list age out while this is broken.`,
      });
    }
    // Webhook handler failures cluster when Telegram or the database misbehaves:
    // past the threshold the Desk hears once (deskAlert dedupes inside cooldown).
    const { count: updateFailures } = await db.from("action_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "tg.update_failed")
      .gte("created_at", new Date(Date.now() - UPDATE_FAILURE_WINDOW_MS).toISOString());
    if (updateFailuresExceeded(updateFailures ?? 0)) {
      await deskAlert({
        db,
        key: "tg-update-failures",
        kind: "webhook_failures",
        severity: "high",
        message: `\u26A0\uFE0F The Desk webhook failed ${updateFailures} times in the last hour. Check the tg-webhook logs.`,
      });
    }
    await db.from("health_checks").insert({ source: "poller", status: "ok", detail: { checked: SOURCES.length, stale: stale.map(([s]) => s) } });
    return json({ ok: true, stale: stale.map(([s]) => s), providers: live, changed });
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
