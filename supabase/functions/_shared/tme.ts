/**
 * Reading a public Telegram channel's web preview (https://t.me/s/<channel>).
 *
 * Bots cannot read how many views a channel post has; the preview page shows it
 * to anyone. That is enough for the +1 h / +24 h / +7 d snapshots of our own
 * posts and for the weekly size, view rate and posting rhythm of the reference
 * channels (benchmarks). Pure parsing and scheduling here; metrics/index.ts
 * does the fetching.
 */

/** "101", "1 234", "1.2K", "3.4M" -> a number; anything else -> null. */
export function parseCount(raw: string): number | null {
  const m = /^([\d.,\s]+?)\s*([KkMm])?$/.exec(raw.trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1;
  return Math.round(n * mult);
}

export interface TmePost { id: number; views: number | null; at: string | null }
export interface TmePage { subscribers: number | null; posts: TmePost[] }

export function parsePage(html: string): TmePage {
  const subs = /<span class="counter_value">([^<]*)<\/span>\s*<span class="counter_type">subscribers?<\/span>/i.exec(html);
  const posts: TmePost[] = [];
  for (const chunk of html.split("tgme_widget_message_wrap").slice(1)) {
    const id = /data-post="[^"\/]+\/(\d+)"/.exec(chunk);
    if (!id) continue;
    const views = /class="tgme_widget_message_views">([^<]*)</.exec(chunk);
    const time = /<time datetime="([^"]+)"/.exec(chunk);
    const at = time ? new Date(time[1]) : null;
    posts.push({
      id: Number(id[1]),
      views: views ? parseCount(views[1]) : null,
      at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    });
  }
  return { subscribers: subs ? parseCount(subs[1]) : null, posts };
}

export interface BenchmarkStats { size_members: number; avg_views: number; view_rate_pct: number; posts_per_day: number }

/** A reference channel in numbers. Null when the page gives no subscriber count or no views to average. */
export function benchmarkStats(page: TmePage): BenchmarkStats | null {
  if (!page.subscribers || page.subscribers <= 0) return null;
  const counted = page.posts.filter((p) => p.views !== null);
  if (!counted.length) return null;
  const avg = Math.round(counted.reduce((a, p) => a + (p.views as number), 0) / counted.length);
  const times = page.posts.map((p) => (p.at ? Date.parse(p.at) : NaN)).filter(Number.isFinite);
  const spanDays = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
  return {
    size_members: page.subscribers,
    avg_views: avg,
    view_rate_pct: Math.round((avg / page.subscribers) * 1000) / 10,
    posts_per_day: Math.round((page.posts.length / Math.max(spanDays, 1)) * 10) / 10,
  };
}

export type SnapshotLabel = "1h" | "24h" | "7d";

const HOUR = 3_600_000;
// A snapshot means "views about this long after posting", so a late one is not taken: it would be mislabelled.
const OFFSETS: Array<{ label: SnapshotLabel; after: number; grace: number }> = [
  { label: "1h", after: HOUR, grace: 3 * HOUR },
  { label: "24h", after: 24 * HOUR, grace: 6 * HOUR },
  { label: "7d", after: 7 * 24 * HOUR, grace: 24 * HOUR },
];

export function snapshotsDue(
  posts: Array<{ message_id: number; posted_at: string }>,
  taken: Array<{ message_id: number; offset_label: string }>,
  now: Date,
): Array<{ message_id: number; label: SnapshotLabel }> {
  const have = new Set(taken.map((t) => `${t.message_id}:${t.offset_label}`));
  const out: Array<{ message_id: number; label: SnapshotLabel }> = [];
  for (const p of posts) {
    const posted = Date.parse(p.posted_at);
    if (Number.isNaN(posted)) continue;
    for (const o of OFFSETS) {
      const start = posted + o.after;
      if (now.getTime() >= start && now.getTime() <= start + o.grace && !have.has(`${p.message_id}:${o.label}`)) {
        out.push({ message_id: p.message_id, label: o.label });
      }
    }
  }
  return out;
}
