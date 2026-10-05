/**
 * metrics — what Telegram's public preview page tells us (plan §9.H.67, §9.I.78).
 *
 *   POST /metrics/snapshots   (cron, every 15 min) views of our own channel posts about 1 h, 24 h and 7 days
 *                             after they went out → post_snapshots
 *   POST /metrics/benchmarks  (cron, weekly) the reference channels' size, average views, view rate and
 *                             posting rhythm → benchmarks
 *
 * Bots cannot read a channel post's views, so this reads https://t.me/s/<channel>, which anyone can open.
 * Reference-channel handles stay in the benchmarks table: they are never returned, logged or committed.
 */
import { serve, json, readJson, routeOf, bad } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";
import * as tg from "_shared/tg.ts";
import { benchmarkStats, parsePage, snapshotsDue, tmeHandle, type TmePage } from "_shared/tme.ts";

const HANDLE = /^[A-Za-z0-9_]{4,32}$/;

async function fetchPage(handle: string, before?: number): Promise<TmePage | null> {
  if (!HANDLE.test(handle)) return null;
  const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ""}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "twinos-metrics/1.0" }, signal: AbortSignal.timeout(10_000) });
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
      (posts ?? []).map((p) => ({ message_id: p.message_id as number, posted_at: p.posted_at as string })),
      (have ?? []).map((h) => ({ message_id: h.message_id as number, offset_label: h.offset_label as string })),
      new Date(),
    );
    if (!due.length) return json({ ok: true, due: 0, taken: 0 });

    const chat = await tg.call<{ username?: string }>("getChat", { chat_id: chatId });
    if (!chat.username) return json({ ok: true, due: due.length, taken: 0, skipped: "the channel has no public username" });

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
      chat_id: chatId, message_id: d.message_id, offset_label: d.label, taken_at: now,
      views: views.get(d.message_id), kind: "views", value: views.get(d.message_id), at: now,
    }));
    if (rows.length) {
      const { error } = await db.from("post_snapshots").insert(rows);
      if (error) throw bad(`post_snapshots: ${error.message}`);
    }
    await logAction({ actor: caller.actor, action: "metrics.snapshots", payload: { due: due.length, taken: rows.length } });
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
      if (!handle) { skipped += 1; continue; }
      const page = await fetchPage(handle);
      const stats = page ? benchmarkStats(page) : null;
      if (!stats) { skipped += 1; continue; }
      const { error } = await db.from("benchmarks").update({
        size_members: stats.size_members, avg_views: stats.avg_views, view_rate_pct: stats.view_rate_pct,
        posts_per_day: stats.posts_per_day, captured_at: new Date().toISOString(), source: "tme_public",
      }).eq("id", r.id);
      if (error) skipped += 1; else updated += 1;
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    await logAction({ actor: caller.actor, action: "metrics.benchmarks", payload: { updated, skipped } });
    return json({ ok: true, updated, skipped });
  }

  throw bad("unknown route");
});
