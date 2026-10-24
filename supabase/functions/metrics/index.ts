/**
 * metrics — what Telegram's public preview page tells us (plan §9.H.67, §9.I.78).
 *
 *   POST /metrics/snapshots   (cron, every 15 min) views of our own channel posts about 1 h, 24 h and 7 days
 *                             after they went out → post_snapshots
 *   POST /metrics/benchmarks  (cron, weekly) the reference channels' size, average views, view rate and
 *                             posting rhythm → benchmarks
 *   POST /metrics/poll/meta   (cron, every 4 h) Instagram + Facebook Page + Threads per-post insights
 *                             → post_metrics (Phase 8; skips by name without credentials)
 *   POST /metrics/poll/youtube (cron, every 4 h) channel + video statistics (Data API v3)
 *                             → post_metrics (Phase 8)
 *
 * Bots cannot read a channel post's views, so this reads https://t.me/s/<channel>, which anyone can open.
 * Reference-channel handles stay in the benchmarks table: they are never returned, logged or committed.
 */
import { bad, json, readJson, routeOf, serve } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";
import * as tg from "_shared/tg.ts";
import { benchmarkStats, parsePage, snapshotsDue, tmeHandle, type TmePage } from "_shared/tme.ts";
import {
  pickVariant,
  pollFacebook,
  pollHealthStatus,
  pollInstagram,
  pollOutcome,
  type PollOutcome,
  pollThreads,
  pollYouTube,
  type SocialRow,
  type SurfaceResult,
  subscriberDelta,
} from "_shared/socialmetrics.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const HANDLE = /^[A-Za-z0-9_]{4,32}$/;

/**
 * Store what the pollers saw. Each row is joined to the variant that was
 * published under that provider id (content_items.published_ref — `chat:message`
 * for Telegram, the bare external id for the Meta/YouTube publishers), and the
 * YouTube account row gains a followers_gained diff against its own previous
 * capture so absolute subscriber counts become a per-capture delta.
 */
async function saveSocialRows(db: SupabaseClient, rows: SocialRow[]): Promise<number> {
  if (!rows.length) return 0;

  const ids = rows.filter((r) => !r.platform_post_id.startsWith("account:")).map((r) =>
    r.platform_post_id
  );
  const refs = new Map<string, Array<{ id: string; platform: string }>>();
  if (ids.length) {
    const { data: items } = await db.from("content_items")
      .select("id, published_ref")
      .in("published_ref", ids)
      .not("published_ref", "is", null);
    const contentIds = (items ?? []).map((i) => i.id as string);
    if (contentIds.length) {
      const { data: variants } = await db.from("content_variants")
        .select("id, content_id, platform")
        .in("content_id", contentIds);
      for (const i of items ?? []) {
        if (!i.published_ref) continue;
        refs.set(
          i.published_ref as string,
          (variants ?? []).filter((v) => v.content_id === i.id)
            .map((v) => ({ id: v.id as string, platform: v.platform as string })),
        );
      }
    }
  }

  for (const r of rows) {
    if (r.platform !== "youtube" || !r.platform_post_id.startsWith("account:")) continue;
    const { data: prev } = await db.from("post_metrics").select("raw")
      .eq("platform", "youtube")
      .eq("platform_post_id", r.platform_post_id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevSubs = numOrNull(
      (prev?.raw as { subscriber_count?: number } | null)?.subscriber_count,
    );
    const nextSubs = numOrNull((r.raw as { subscriber_count?: number }).subscriber_count);
    r.followers_gained = subscriberDelta(prevSubs, nextSubs);
  }

  const payload = rows.map((r) => ({
    platform: r.platform,
    platform_post_id: r.platform_post_id,
    variant_id: r.platform_post_id.startsWith("account:")
      ? null
      : pickVariant(refs.get(r.platform_post_id) ?? [], r.platform),
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    saves: r.saves,
    followers_gained: r.followers_gained,
    profile_views: r.profile_views,
    source: "api",
    raw: r.raw,
  }));
  const { error } = await db.from("post_metrics").insert(payload);
  if (error) throw bad(`post_metrics: ${error.message}`);
  return payload.length;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fetchPage(handle: string, before?: number): Promise<TmePage | null> {
  if (!HANDLE.test(handle)) return null;
  const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "twinos-metrics/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? parsePage(await res.text()) : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method !== "POST") throw bad("POST only");
  const caller = await authenticate(req);
  requireRole(caller.role, "metrics.poll");
  const { tail } = routeOf(req, "metrics");
  await readJson(req, true);
  const db = admin();

  if (tail[0] === "snapshots") {
    const chatId = Number(await requireSetting(SETTING_KEYS.channelId, "TWINOS_CHANNEL_ID"));
    const since = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { data: posts } = await db.from("tg_posts").select("message_id, posted_at")
      .eq("chat_id", chatId).is("deleted_at", null).gte("posted_at", since);
    const ids = (posts ?? []).map((p) => p.message_id as number);
    if (!ids.length) return json({ ok: true, due: 0, taken: 0 });
    const { data: have } = await db.from("post_snapshots").select("message_id, offset_label")
      .eq("chat_id", chatId).in("message_id", ids).in("offset_label", ["1h", "24h", "7d"]);
    const due = snapshotsDue(
      (posts ?? []).map((p) => ({
        message_id: p.message_id as number,
        posted_at: p.posted_at as string,
      })),
      (have ?? []).map((h) => ({
        message_id: h.message_id as number,
        offset_label: h.offset_label as string,
      })),
      new Date(),
    );
    if (!due.length) return json({ ok: true, due: 0, taken: 0 });

    const chat = await tg.getTgClient().call<{ username?: string }>("getChat", { chat_id: chatId });
    if (!chat.username) {
      return json({
        ok: true,
        due: due.length,
        taken: 0,
        skipped: "the channel has no public username",
      });
    }

    // Newest page first; walk back while a due post is still older than the page.
    const wanted = new Set(due.map((d) => d.message_id));
    const views = new Map<number, number>();
    let before: number | undefined;
    for (let i = 0; i < 4; i += 1) {
      const page = await fetchPage(chat.username, before);
      if (!page || !page.posts.length) break;
      for (const p of page.posts) if (p.views !== null) views.set(p.id, p.views);
      const oldest = Math.min(...page.posts.map((p) => p.id));
      if (![...wanted].some((id) => id < oldest && !views.has(id))) break;
      before = oldest;
    }
    const now = new Date().toISOString();
    const rows = due.filter((d) => views.has(d.message_id)).map((d) => ({
      chat_id: chatId,
      message_id: d.message_id,
      offset_label: d.label,
      taken_at: now,
      views: views.get(d.message_id),
      kind: "views",
      value: views.get(d.message_id),
      at: now,
    }));
    if (rows.length) {
      const { error } = await db.from("post_snapshots").insert(rows);
      if (error) throw bad(`post_snapshots: ${error.message}`);
    }
    await logAction({
      actor: caller.actor,
      action: "metrics.snapshots",
      payload: { due: due.length, taken: rows.length },
    });
    return json({ ok: true, due: due.length, taken: rows.length });
  }

  if (tail[0] === "benchmarks") {
    const { data: rows } = await db.from("benchmarks").select("id, handle")
      .eq("active", true).eq("platform", "telegram").not("handle", "is", null);
    let updated = 0;
    let skipped = 0;
    for (const r of rows ?? []) {
      // Whatever the row holds — @name, t.me/name, a pasted link — one normaliser decides it.
      const handle = tmeHandle(r.handle);
      if (!handle) {
        skipped += 1;
        continue;
      }
      const page = await fetchPage(handle);
      const stats = page ? benchmarkStats(page) : null;
      if (!stats) {
        skipped += 1;
        continue;
      }
      const { error } = await db.from("benchmarks").update({
        size_members: stats.size_members,
        avg_views: stats.avg_views,
        view_rate_pct: stats.view_rate_pct,
        posts_per_day: stats.posts_per_day,
        captured_at: new Date().toISOString(),
        source: "tme_public",
      }).eq("id", r.id);
      if (error) skipped += 1;
      else updated += 1;
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    await logAction({
      actor: caller.actor,
      action: "metrics.benchmarks",
      payload: { updated, skipped },
    });
    return json({ ok: true, updated, skipped });
  }

  // Phase 8 (UPGRADE-PHASES): the Meta + YouTube metrics pollers, behind
  // credentials that live in settings (the dashboard's "Needs your
  // confirmation" rows) or function secrets — a test token from the Graph API
  // Explorer, or a Data API key from Jack's own Google Cloud project, is
  // enough to verify the pipeline end to end. A surface with no credentials is
  // SKIPPED and named in the response; a surface whose call fails carries the
  // provider's message. Nothing is faked: post_metrics only gains rows a
  // provider actually reported.
  if (tail[0] === "poll" && (tail[1] === "meta" || tail[1] === "youtube")) {
    const provider = tail[1];
    const surfaces: Record<string, SurfaceResult> = {};
    const skipped: string[] = [];
    const warnings: string[] = [];
    let inserted = 0;

    type Surface = { platform: string; run: () => Promise<PollOutcome> };
    const jobs: Surface[] = [];

    if (provider === "meta") {
      const igToken = await setting(SETTING_KEYS.metaIgToken, "TWINOS_META_IG_TOKEN");
      const pageToken = await setting(SETTING_KEYS.metaPageToken, "TWINOS_META_PAGE_TOKEN");
      const threadsToken = await setting(SETTING_KEYS.threadsToken, "TWINOS_THREADS_TOKEN");
      const igUserId = await setting(SETTING_KEYS.metaIgUserId, "TWINOS_META_IG_USER_ID");
      const pageId = await setting(SETTING_KEYS.metaPageId, "TWINOS_META_PAGE_ID");
      const threadsUserId = await setting(SETTING_KEYS.threadsUserId, "TWINOS_THREADS_USER_ID");
      if (igToken) {
        jobs.push({
          platform: "instagram",
          run: () => pollInstagram({ userId: igUserId, token: igToken }),
        });
      } else skipped.push("instagram — meta_ig_token is not set");
      if (pageToken) {
        jobs.push({ platform: "facebook", run: () => pollFacebook({ pageId, token: pageToken }) });
      } else skipped.push("facebook — meta_page_token is not set");
      if (threadsToken) {
        jobs.push({
          platform: "threads",
          run: () => pollThreads({ userId: threadsUserId, token: threadsToken }),
        });
      } else skipped.push("threads — threads_token is not set");
    } else {
      const apiKey = await setting(SETTING_KEYS.ytApiKey, "TWINOS_YT_API_KEY");
      const channelId = await setting(SETTING_KEYS.ytChannelId, "TWINOS_YT_CHANNEL_ID");
      if (apiKey && channelId) {
        jobs.push({ platform: "youtube", run: () => pollYouTube({ apiKey, channelId }) });
      } else skipped.push("youtube — yt_api_key and yt_channel_id must both be set");
    }

    for (const job of jobs) {
      try {
        const out = await job.run();
        const n = await saveSocialRows(db, out.rows);
        inserted += n;
        surfaces[job.platform] = { ok: true, inserted: n } as SurfaceResult;
        warnings.push(...out.warnings.map((w) => `${job.platform}: ${w}`));
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        surfaces[job.platform] = { ok: false, error: err } as SurfaceResult;
      }
    }
    for (const s of skipped) {
      const platform = s.split(" ")[0];
      surfaces[platform] = { ok: true, skipped: true } as SurfaceResult;
    }

    // One beat per run keeps the board's `poller` source honest; a run with
    // nothing to poll (no credentials yet) beats nothing rather than lying.
    const outcome = pollOutcome(surfaces);
    if (jobs.length > 0 || skipped.length > 0) {
      await db.from("health_checks").insert({
        source: "poller",
        status: pollHealthStatus(surfaces),
        detail: {
          provider,
          inserted,
          skipped: skipped.length,
          failed: Object.entries(surfaces).filter(([, s]) => !s.ok && !s.skipped).map(([p, s]) =>
            `${p}: ${s.error}`
          ),
        },
      });
    }
    await logAction({
      actor: caller.actor,
      action: "metrics.poll",
      payload: { provider, inserted, skipped: skipped.length, surfaces },
    });
    return json({
      ok: outcome.ok,
      provider,
      surfaces,
      skipped,
      warnings,
      inserted,
    });
  }

  throw bad("unknown route");
});
