/**
 * `/hours` — the Week-1 baseline log (decision 6, plan §13).
 *
 *   /hours <task> <minutes> [note]   log what a task cost by hand
 *   /hours today                     today's total, and the week so far
 *
 * The task vocabulary is the one migration 0001 lists in the baseline_hours
 * comment. Kept out of tg-webhook so it can be tested without a server.
 */

export const HOUR_TASKS = [
  "map", "approvals_dms", "recording", "tiktok_replies", "rotating",
  "ny_session", "formatting", "scheduling", "logging", "faq", "other",
] as const;
export type HourTask = (typeof HOUR_TASKS)[number];

export type HoursCommand =
  | { kind: "log"; task: HourTask; minutes: number; note: string | null }
  | { kind: "today" }
  | { kind: "bad"; error: string };

export function parseHoursCommand(input: string): HoursCommand {
  const m = /^\/hours(?:@\w+)?(?:\s+(.*))?$/i.exec(input.trim());
  const rest = (m?.[1] ?? "").trim();
  if (!rest || /^today$/i.test(rest)) return { kind: "today" };

  const parts = rest.split(/\s+/);
  const task = parts[0].toLowerCase();
  if (!(HOUR_TASKS as readonly string[]).includes(task)) {
    return { kind: "bad", error: `unknown task '${parts[0]}'. One of: ${HOUR_TASKS.join(", ")}` };
  }
  if (parts[1] === undefined) {
    return { kind: "bad", error: "how many minutes? e.g. /hours map 45" };
  }
  const minutes = Number(parts[1]);
  if (!Number.isInteger(minutes) || minutes < 0) {
    return { kind: "bad", error: "minutes must be a whole number, e.g. /hours map 45" };
  }
  const note = parts.slice(2).join(" ").trim() || null;
  return { kind: "log", task: task as HourTask, minutes, note };
}

/**
 * The Monday of the week containing a `YYYY-MM-DD` calendar date.
 * Date-only arithmetic in UTC, so no zone can shift it across a boundary.
 */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** "3h 05m" / "45m" — for the Desk reply. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
