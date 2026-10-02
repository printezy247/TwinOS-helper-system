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
