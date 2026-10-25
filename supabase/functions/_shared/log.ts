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
import { redactSecrets } from "./providers.ts";

export interface LogEntry {
  actor: string;
  action: string;
  target?: string | null;
  payload?: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|password|authorization|api_key|apikey|key_hash/i;

/**
 * Two rules, applied at every depth:
 *   1. a key that names a credential keeps its name and loses its value;
 *   2. any string goes through `redactSecrets()`, so a token that leaked into
 *      a message, an error or a URL is caught even when its key says nothing.
 *
 * Depth matters: a payload of `{ provider: { access_token: … } }` used to pass
 * through untouched because only the top level was inspected.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactValue(inner);
    }
    return out;
  }
  return value;
}

/** Strip anything that looks like a secret before it reaches the log. */
export function redact(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    // A long body is truncated first, then redacted, so a token past the cut
    // never survives and a token before it does not.
    else if (typeof v === "string" && v.length > 2000) out[k] = redactSecrets(v.slice(0, 2000)) + "…";
    else out[k] = redactValue(v);
  }
  return out;
}

/** Re-export for consumers that want error → safe string without importing http directly. */
export { sanitizeError };

export async function logAction(entry: LogEntry): Promise<void> {
  try {
    const { error } = await admin().from("action_log").insert({
      actor: entry.actor,
      action: entry.action,
      target_table: entry.action.split(".")[0] || "system",
      target_id: entry.target ?? null,
      payload: redact(entry.payload),
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
