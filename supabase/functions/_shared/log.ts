/**
 * action_log insert helper (plan §9.A.2).
 *
 *   action_log(id bigint identity, actor text, action text, target_table text,
 *              target_id text null, payload jsonb, created_at timestamptz default now())
 *
 * `target` here is the id of whatever the action touched; the table name is the
 * first dotted segment of the action ("content.approved" -> "content").
 *
 * Table writes also fire the trigger that the migrations agent owns; this
 * helper is for actions that are not a single row change (a draft rendered,
 * a Telegram message sent, a webhook refused). It never throws: an unloggable
 * action must not undo the action.
 *
 * `time_saved` rows (plan §1) use the same shape with action = "time_saved"
 * and payload.minutes, so "what TwinOS did instead of Jack" is one query.
 */
import { admin } from "./supabase.ts";
import { sanitizeError } from "./http.ts";

export interface LogEntry {
  actor: string;
  action: string;
  target?: string | null;
  payload?: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|password|authorization|api_key|apikey|key_hash/i;

/** Strip anything that looks like a secret before it reaches the log. */
export function redact(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string" && v.length > 2000) out[k] = v.slice(0, 2000) + "…";
    else out[k] = v;
  }
  return out;
}

export async function logAction(entry: LogEntry): Promise<void> {
  try {
    const { error } = await admin().from("action_log").insert({
      actor: entry.actor,
      action: entry.action,
      target_table: entry.action.split(".")[0] || "system",
      target_id: entry.target ?? null,
      payload: redact(sanitizeError(entry.payload)),
    });
    if (error) console.warn("[action_log] insert failed", error.message, entry.action);
  } catch (err) {
    console.warn("[action_log] insert threw", sanitizeError(err));
  }
}

/** Minutes TwinOS saved Jack, counted per action kind (plan §1 measurement 2). */
export const TIME_SAVED_MINUTES: Record<string, number> = {
  "content.draft": 6,
  "content.publish": 2,
  "results.reply": 3,
  "signals.card": 4,
  "friday.report": 45,
  "log.row": 1,
};

export async function logTimeSaved(actor: string, kind: string, target?: string): Promise<void> {
  const minutes = TIME_SAVED_MINUTES[kind];
  if (!minutes) return;
  await logAction({ actor, action: "time_saved", target, payload: { kind, minutes } });
}
