/**
 * Small honest metrics (research 2026-10-02: Telegram is purely chronological,
 * so timing and hook choice are the only levers that move reach).
 *
 * Pure functions over rows the views already produce — no AI, no scraping:
 *   bestHours      which posting hours earned the most views (post_snapshots)
 *   engagementRate views_24h over members, the rate the benchmark cards use
 *   hookWinner     which library hook's posts earned the most views (needs two
 *                  uses before it says anything)
 *   channelStale   has the channel gone quiet past the gap that loses members
 */

export interface HourViews {
  hour: number;
  views: number;
}

/** Hours sorted by views (desc, ties by hour). `top` caps the list. */
export function bestHours(rows: HourViews[], top = 2): number[] {
  return [...rows]
    .sort((a, b) => b.views - a.views || a.hour - b.hour)
    .slice(0, Math.max(0, top))
    .map((r) => r.hour);
}

/** Views in 24 h as a percentage of members, one decimal. Null when either half is missing. */
export function engagementRate(views24h: number | null, members: number | null): number | null {
  if (views24h === null || members === null) return null;
  if (!Number.isFinite(views24h) || !Number.isFinite(members) || members <= 0) return null;
  return Math.round((views24h / members) * 1000) / 10;
}

export interface HookStat {
  hook_id: number | null;
  views: number | null;
}

export const HOOK_MIN_USES = 2;

/**
 * The hook whose posts earned the best average views, with at least
 * `minUses` uses as evidence. Null when nothing qualifies yet.
 */
export function hookWinner(rows: HookStat[], minUses = HOOK_MIN_USES): number | null {
  const byHook = new Map<number, { total: number; n: number }>();
  for (const r of rows) {
    if (r.hook_id === null || r.hook_id === undefined || r.views === null) continue;
    const cur = byHook.get(r.hook_id) ?? { total: 0, n: 0 };
    byHook.set(r.hook_id, { total: cur.total + r.views, n: cur.n + 1 });
  }
  let best: { id: number; avg: number } | null = null;
  for (const [id, s] of byHook) {
    if (s.n < minUses) continue;
    const avg = s.total / s.n;
    if (!best || avg > best.avg || (avg === best.avg && id < best.id)) best = { id, avg };
  }
  return best?.id ?? null;
}

/** Quiet past this gap and the channel is losing momentum (research: 36 h). */
export const CHANNEL_STALE_MS = 36 * 3600_000;

/**
 * Has the channel gone quiet? True when nothing posted inside the gap, and
 * always true when nothing has ever posted (or the date will not parse).
 */
export function channelStale(lastPostAt: string | null, now = Date.now(), maxGapMs = CHANNEL_STALE_MS): boolean {
  if (!lastPostAt) return true;
  const t = Date.parse(lastPostAt);
  if (Number.isNaN(t)) return true;
  return now - t > maxGapMs;
}
