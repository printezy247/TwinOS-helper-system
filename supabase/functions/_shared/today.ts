/**
 * GET /health/today — ABDUL's read-only status line: what publishes today,
 * what failed, what waits on Jack's approval, and minutes saved this week.
 * Pure: the route queries, this shapes. `now` is injectable for tests.
 */
import { startOfDayInTz } from "./time.ts";

export interface PublishRow {
  platform: string;
  run_at: string;
  status: string;
  last_error?: string | null;
}

/** Midnight today and midnight this week's Monday in `tz`, as ISO instants. */
export function dayAndWeekStart(tz: string, now: Date = new Date()): { day: string; week: string } {
  const day = startOfDayInTz(tz, now);
  const dow = (new Date(now.toLocaleString("en-US", { timeZone: tz })).getDay() + 6) % 7; // Monday = 0
  return { day, week: new Date(Date.parse(day) - dow * 86_400_000).toISOString() };
}

export function todaySummary(rows: PublishRow[], minutesSaved: Array<number | string | null>, pending: number) {
  const publish: Record<string, number> = {};
  for (const r of rows) publish[r.status] = (publish[r.status] ?? 0) + 1;
  const failed = rows
    .filter((r) => r.status === "failed")
    .map((r) => ({ platform: r.platform, run_at: r.run_at, error: (r.last_error ?? "").slice(0, 120) }));
  const next = rows
    .filter((r) => r.status === "queued" || r.status === "running")
    .sort((a, b) => a.run_at.localeCompare(b.run_at))
    .slice(0, 5)
    .map((r) => ({ platform: r.platform, run_at: r.run_at }));
  const saved = Math.round(minutesSaved.reduce<number>((s, m) => s + (Number(m) || 0), 0));
  const bits = [
    `${rows.length} post(s) today` + (rows.length ? ` (${Object.entries(publish).map(([k, n]) => `${n} ${k}`).join(", ")})` : ""),
    `${pending} waiting for approval`,
    `${saved} min saved this week`,
  ];
  return { summary: bits.join("; "), publish, failed, next, pending_approval: pending, minutes_saved_week: saved };
}

/** `HH:MM` in `tz` for a `run_at` instant — the bot's screens show Jack's own wall clock. */
const hm = (iso: string, tz: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

/**
 * Wave 8 §3.8 — GET /health/today's numbers as the bot's /today lines. Pure:
 * the summary and the zone are the whole input, so the screen is testable
 * without a database or a clock.
 */
export function todayLines(
  s: {
    publish: Record<string, number>;
    failed: Array<{ platform: string; run_at: string; error: string }>;
    next: Array<{ platform: string; run_at: string }>;
    pending_approval: number;
    minutes_saved_week: number;
  },
  tz: string,
): string[] {
  const total = Object.values(s.publish).reduce((a, b) => a + b, 0);
  const byStatus = Object.entries(s.publish)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, n]) => `${n} ${status}`);
  return [
    `📨 ${total} post(s) today${byStatus.length ? ` — ${byStatus.join(", ")}` : ""}`,
    `✅ ${s.pending_approval} waiting for approval`,
    ...(s.failed.length
      ? [
          `❌ ${s.failed.length} failed — ${s.failed
            .slice(0, 3)
            .map((f) => `${f.platform} ${hm(f.run_at, tz)}`)
            .join(", ")}`,
        ]
      : []),
    ...(s.next.length
      ? [`⏭ next — ${s.next.map((n) => `${n.platform} ${hm(n.run_at, tz)}`).join(", ")}`]
      : []),
    `💾 ${s.minutes_saved_week} min saved this week`,
  ];
}

/**
 * Wave 8 §3.9 — GET /jobs's counts as the bot's /queue lines: one line per
 * kind, statuses in a stable order — the numbers Health's table shows, in a
 * shape that answers "is the PC behind?" at a glance.
 */
export function queueLines(counts: Record<string, Record<string, number>>): string[] {
  const kinds = Object.keys(counts).sort();
  if (!kinds.length) return ["Nothing queued in the last 7 days."];
  return kinds.map((kind) => {
    const parts = Object.entries(counts[kind])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, n]) => `${n} ${status}`);
    return `${kind}: ${parts.join(", ")}`;
  });
}
