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
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offsetMs).toISOString();
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
