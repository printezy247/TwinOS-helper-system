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
