/**
 * Small time helpers. `now` is injectable so the day boundary can be tested
 * without waiting for midnight.
 */

/**
 * Midnight today in `tz`, as an ISO instant.
 *
 * The trick is the one tg-webhook's parseTime uses: read the wall clock in the
 * target zone, zero its time, then add back the zone offset so the result is a
 * real UTC instant. MYT (UTC+8) midnight is 16:00Z the previous day.
 */
export function startOfDayInTz(tz: string, now: Date = new Date()): string {
  const offsetAt = (t: Date) => t.getTime() - new Date(t.toLocaleString("en-US", { timeZone: tz })).getTime();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  local.setHours(0, 0, 0, 0);
  // A zone that changes offset between now and today's midnight (a DST change)
  // would get the wrong instant from one offset for both, so correct the guess
  // with the offset the candidate instant actually falls in.
  const guess = local.getTime() + offsetAt(now);
  return new Date(local.getTime() + offsetAt(new Date(guess))).toISOString();
}

/**
 * Monday 00:00 in the channel's timezone (MYT, UTC+8, no daylight saving) as a
 * UTC instant — the week boundary the "free signals this week" counter counts
 * from. A UTC Monday would reset the counter at 08:00 local instead.
 */
export function weekStartMyt(now: Date = new Date()): Date {
  const MYT = 8 * 3_600_000;
  const local = new Date(now.getTime() + MYT);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(localMidnight - daysSinceMonday * 86_400_000 - MYT);
}

/**
 * Split rows into local-day buckets, for the calendar.
 *
 * The grouping happens here rather than in the dashboard because the browser's
 * timezone is not the channel's: a post at 23:30 MYT belongs to the next day
 * for anyone reading from UTC, and the same class of mistake cost the Friday
 * scorecard its first eight hours of every Monday (see `weekStart` in friday).
 */
export function bucketByDay<T>(
  tz: string,
  rows: T[],
  opts: { from: string | Date; days?: number; at: (row: T) => string | Date },
): Array<{ key: string; rows: T[] }> {
  const fromMs = Date.parse(typeof opts.from === "string" ? opts.from : opts.from.toISOString());
  const n = opts.days ?? 7;
  const keyOf = (v: string | Date): string =>
    new Date(typeof v === "string" ? v : v.toISOString()).toLocaleDateString("en-CA", { timeZone: tz });
  const buckets = Array.from({ length: n }, (_, i) => ({
    key: keyOf(new Date(fromMs + i * 86_400_000)),
    rows: [] as T[],
  }));
  for (const r of rows) {
    const hit = buckets.find((b) => b.key === keyOf(opts.at(r)));
    // A row outside the window is dropped rather than wedged into a day it is
    // not in: an empty cell is honest, a wrong one is not.
    if (hit) hit.rows.push(r);
  }
  return buckets;
}
