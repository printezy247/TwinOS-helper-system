/**
 * research — what people ask and what to film next (Phase 5, plan §9.J).
 *
 *   POST /research/expand   (cron, weekly) every persona's seed questions through Google autocomplete
 *                           (Malaysia, English / Malay / Manglish) → queries + a scored topic_clusters row per seed
 *   POST /research/brief    (cron, Monday 07:00 MYT) next week's 28-day calendar slots with the best fitting
 *                           scored topic for each → briefs, and a short note in the Desk
 *   POST /research/feeds  { feed_id? } poll every active RSS/Atom feed (cron, 6-hourly) → new items into
 *                           feed_items; one dead feed records why and the run continues
 *   POST /research/article  { topic | cluster_id, lang? } a search-article brief (BM first) from the autocomplete suggestions
 *   POST /research/csi      { topic, category?, metric?, value?, trend?, note? } one TikTok Creator Search
 *                           Insights reading Jack typed in → csi_captures
 *
 * Autocomplete is an unofficial public endpoint: a failed lookup is skipped, never retried in a loop.
 * No AI reads anything here, and nothing is posted: the brief is a note for Jack.
 */
import { bad, json, readJson, routeOf, serve } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { remember, replay } from "_shared/idempotency.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";
import { sendMessage } from "_shared/tg.ts";
import { cycleWeek, nextMonday } from "_shared/batch.ts";
import { similarity } from "_shared/moderation.ts";
import { articleBrief } from "_shared/articles.ts";
import { buildBrief, coreTerms, csiRow, demandScore, parseSuggest, queryVariants, topicRisk } from "_shared/research.ts";
import { nextHook } from "_shared/hooks.ts";
import { parseFeed } from "_shared/feed.ts";

const LANGS = ["en", "ms", "manglish"] as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function suggest(q: string, lang: string): Promise<string[]> {
  const hl = lang === "ms" ? "ms" : "en";
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=my&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
    return res.ok ? parseSuggest(await res.json()) : [];
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method !== "POST") throw bad("POST only");
  const caller = await authenticate(req);
  const { tail } = routeOf(req, "research");
  const body = await readJson(req, true);
  const db = admin();

  if (tail[0] === "csi") {
    requireRole(caller.role, "research.csi");
    let row;
    try {
      row = csiRow(body);
    } catch (err) {
      throw bad(err instanceof Error ? err.message : String(err));
    }
    const { error } = await db.from("csi_captures").insert({ ...row, captured_by: caller.actor });
    if (error) throw bad(`csi_captures: ${error.message}`);
    await logAction({ actor: caller.actor, action: "research.csi", payload: { topic: row.topic } });
    return json({ ok: true }, 201);
  }

  if (tail[0] === "feeds") {
    requireRole(caller.role, "research.run");
    const only = typeof body.feed_id === "string" ? body.feed_id : null;
    const { data: feeds } = await db.from("feeds")
      .select("id, name, url, lang, items_seen").eq("active", true).order("name");
    const list = only ? (feeds ?? []).filter((f) => f.id === only) : (feeds ?? []);
    if (only && !list.length) throw bad("no active feed with that id");

    const now = new Date().toISOString();
    let items = 0;
    const failed: Array<{ name: string; why: string }> = [];
    for (const feed of list) {
      // One dead feed must not stop the run: it records why and the rest continue.
      let xml = "";
      let added = 0;
      let status: "ok" | "http_error" | "parse_error" | "timeout" = "ok";
      let why: string | null = null;
      try {
        const res = await fetch(feed.url, {
          headers: { "user-agent": "TwinOS/1.0 (+research feed)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          status = "http_error";
          why = `HTTP ${res.status}`;
        } else {
          xml = await res.text();
        }
      } catch (err) {
        const timedOut = err instanceof Error && /timeout/i.test(err.name + err.message);
        status = timedOut ? "timeout" : "http_error";
        why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      }

      if (xml) {
        // Newest first in both shapes; 50 is a day's worth of macro news, and a
        // first run against a ten-year archive should not write ten thousand rows.
        const parsed = parseFeed(xml).slice(0, 50);
        if (!parsed.length && !/<(item|entry)\b/i.test(xml)) {
          status = "parse_error";
          why = "not an RSS or Atom feed";
        } else if (parsed.length) {
          const ids = parsed.map((p) => p.externalId);
          const { data: seenRows } = await db.from("feed_items").select("external_id")
            .eq("feed_id", feed.id).in("external_id", ids);
          const have = new Set((seenRows ?? []).map((r) => String(r.external_id)));
          const fresh = parsed.filter((p) => !have.has(p.externalId));
          if (fresh.length) {
            const { error } = await db.from("feed_items").insert(fresh.map((p) => ({
              feed_id: feed.id, external_id: p.externalId, title: p.title.slice(0, 300),
              summary: p.summary?.slice(0, 2000) ?? null, link: p.link, published_at: p.publishedAt,
            })));
            // A unique violation means another writer stored the same story
            // first; the row exists either way, so the run is not a failure.
            if (error && !/duplicate key/i.test(error.message ?? "")) {
              status = "parse_error";
              why = `feed_items: ${error.message}`.slice(0, 200);
            } else {
              added = fresh.length;
              items += added;
            }
          }
        }
      }

      await db.from("feeds").update({
        last_fetched_at: now, last_status: status, last_error: why,
        items_seen: Number(feed.items_seen ?? 0) + added,
      }).eq("id", feed.id);
      if (status !== "ok") failed.push({ name: feed.name, why: why ?? status });
    }

    await logAction({ actor: caller.actor, action: "research.feeds", payload: { feeds: list.length, items, failed: failed.length } });
    return json({ ok: true, feeds: list.length, items, failed });
  }

  if (tail[0] === "article") {
    requireRole(caller.role, "research.brief");
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const { data: cluster } = body.cluster_id
      ? await db.from("topic_clusters").select("id, name").eq("id", String(body.cluster_id)).maybeSingle()
      : topic
      ? await db.from("topic_clusters").select("id, name").eq("name", topic).limit(1).maybeSingle()
      : { data: null };
    const name = (cluster?.name as string | undefined) ?? topic;
    if (!name) throw bad("topic or cluster_id is required");
    const { data: found } = await db.from("queries").select("term, lang").eq("prefix", name)
      .order("captured_at", { ascending: false }).limit(60);
    const ms = (found ?? []).filter((q) => q.lang === "ms").length;
    const lang = body.lang === "en" || body.lang === "ms" ? body.lang : ms * 2 >= (found ?? []).length ? "ms" : "en";
    const brief = articleBrief({ topic: name, lang, queries: (found ?? []).map((q) => String(q.term)) });
    if (cluster) await db.from("topic_clusters").update({ notes: brief.text }).eq("id", cluster.id as string);
    return json({ ok: true, topic: name, ...brief });
  }

  if (tail[0] === "expand") {
    requireRole(caller.role, "research.run");
    const day = new Date().toISOString().slice(0, 10);
    const idem = { scope: "research.expand", key: day, requestHash: "-" };
    const hit = await replay(idem);
    if (hit) return hit;

    const { data: personas } = await db.from("personas").select("id, key, main_pillar, seed_questions").eq("active", true).order("id");
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: csi } = await db.from("csi_captures").select("topic, value, trend").gte("captured_at", since);
    const now = new Date().toISOString();
    const seen = new Set<string>();
    let seeds = 0;
    let found = 0;
    const limitRaw = Number(body.limit ?? 40);
    // A NaN budget would compare false against everything and remove the cap.
    const budget = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 40, 1), 80);

    for (const persona of personas ?? []) {
      const bag = (persona.seed_questions ?? {}) as Record<string, unknown>;
      for (const lang of LANGS) {
        const list = Array.isArray(bag[lang]) ? (bag[lang] as unknown[]).map(String) : [];
        for (const seed of list) {
          if (seeds >= budget) break;
          seeds += 1;
          // The seed, and its core words: autocomplete knows "stop loss gold", not the whole question.
          const asked = [...new Set([...queryVariants(seed, 1), ...queryVariants(coreTerms(seed), 2)])];
          const terms: string[] = [];
          for (const q of asked) {
            for (const s of await suggest(q, lang)) if (!terms.includes(s)) terms.push(s);
            await new Promise((r) => setTimeout(r, 300));
          }
          const fresh = terms.filter((t) => !seen.has(`${lang}|${t}`));
          for (const t of fresh) seen.add(`${lang}|${t}`);
          if (fresh.length) {
            await db.from("queries").insert(fresh.map((term) => ({
              term, lang, source: "autocomplete", region: "my", prefix: seed, icp: persona.id, captured_at: now, created_by: caller.actor,
            })));
          }
          found += fresh.length;

          // Creator Search Insights readings Jack typed that look like this seed lift its demand.
          const core = coreTerms(seed);
          const lift = (csi ?? []).map((c) => ({ c, sim: similarity(core, coreTerms(String(c.topic))) }))
            .filter((x) => x.sim >= 0.5).sort((a, b) => b.sim - a.sim)[0]?.c;
          const demand = demandScore({ suggestions: terms.length, csiPopularity: lift?.value === null ? null : Number(lift?.value), csiTrend: lift?.trend as string | null });
          const risk = topicRisk(seed);
          // total_score is a generated column (0007): Postgres computes it from
          // demand_score x icp_fit x (1 - compliance_risk) and refuses a write
          // (error 428C9). Writing it here made every insert fail, and the
          // failure was discarded — 260 queries, zero clusters, and a Monday
          // brief with nothing to suggest. The write is checked now.
          const row = {
            name: seed, pillar: persona.main_pillar, icp: persona.id, demand_score: demand, icp_fit: 1,
            compliance_risk: risk, query_count: terms.length,
          };
          const { data: existing, error: findErr } = await db.from("topic_clusters")
            .select("id").eq("name", seed).eq("icp", persona.id).maybeSingle();
          if (findErr) throw bad(`topic_clusters: ${findErr.message}`);
          const { error: writeErr } = existing
            ? await db.from("topic_clusters").update(row).eq("id", existing.id)
            : await db.from("topic_clusters").insert({ ...row, status: "new", created_by: caller.actor });
          if (writeErr) throw bad(`topic_clusters: ${writeErr.message}`);
        }
      }
    }
    await logAction({ actor: caller.actor, action: "research.expand", payload: { seeds, queries: found } });
    return remember(idem, 200, { ok: true, seeds, queries: found });
  }

  if (tail[0] === "brief") {
    requireRole(caller.role, "research.run");
    const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
    const week = typeof body.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : nextMonday(new Date(), tz);
    const { data: prior } = await db.from("briefs").select("id, status").eq("week_start", week).maybeSingle();
    if (prior && (prior.status === "accepted" || prior.status === "edited")) {
      return json({ ok: true, skipped: `the brief for ${week} was already ${prior.status}`, week });
    }

    const cycle = cycleWeek(week);
    const { data: slots } = await db.from("calendar_slots").select("dow, pillar, topic")
      .eq("kind", "tiktok_28day").eq("week_no", cycle).eq("active", true);
    const { data: clusters } = await db.from("topic_clusters").select("id, name, pillar, icp, total_score, status")
      .in("status", ["new", "proposed"]).order("total_score", { ascending: false }).limit(80);
    const { data: personas } = await db.from("personas").select("id, key");
    // Grounded (Wave 3 item 7): one hook-bank line per pillar, rotated LRU.
    const pillars = [...new Set((slots ?? []).map((s) => s.pillar as string | null))];
    const hooks: Array<{ pillar: string | null; text: string }> = [];
    for (const pillar of pillars) {
      const h = await nextHook(db, { pillar, lang: "en" });
      if (h) hooks.push({ pillar, text: h.text });
    }
    const brief = buildBrief({
      week, cycleWeek: cycle,
      slots: (slots ?? []).map((s) => ({ dow: Number(s.dow), pillar: s.pillar as string | null, topic: s.topic as string | null })),
      clusters: (clusters ?? []).map((c) => ({
        name: c.name as string, pillar: c.pillar as string | null, score: Number(c.total_score ?? 0),
        persona: (personas ?? []).find((p) => p.id === c.icp)?.key as string | null ?? null,
      })),
      hooks,
    });

    const row = { week_start: week, body: brief.body, proposed_slots: brief.proposed_slots, status: "sent", created_by: caller.actor };
    const { error } = prior
      ? await db.from("briefs").update(row).eq("id", prior.id)
      : await db.from("briefs").insert(row);
    if (error) throw bad(`briefs: ${error.message}`);
    const chosen = brief.proposed_slots.map((s) => s.suggested).filter((n): n is string => !!n);
    if (chosen.length) await db.from("topic_clusters").update({ status: "proposed" }).in("name", chosen).eq("status", "new");

    const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
    await sendMessage(desk, `<b>Monday brief</b>\n<pre>${esc(brief.body).slice(0, 3500)}</pre>`, { parse_mode: "HTML" });
    await logAction({ actor: caller.actor, action: "research.brief", payload: { week, suggested: chosen.length } });
    return json({ ok: true, week, suggested: chosen.length }, 201);
  }

  throw bad("unknown route");
});
