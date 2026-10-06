/**
 * Error alerts to the Desk with a cooldown per error and a repeat count
 * (plan §17 Wave 3 item 3).
 *
 * One open `alerts` row per key (`dedupe_key = err:<key>`), which is what the
 * schema says and what this now does. Inside the cooldown the Desk stays quiet
 * and only `payload.repeats` grows; past it the SAME row is bumped and the
 * message goes out again.
 *
 * It used to insert a fresh row past every cooldown, so a beat that stayed
 * down for a day left a dozen identical open alerts and the board showed the
 * same outage over and over. The row is the alert; a recurrence is a repeat
 * of it, not a new one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSetting, SETTING_KEYS } from "./supabase.ts";
import { redactSecrets } from "./providers.ts";
import { type InlineButton, sendMessage } from "./tg.ts";

export const DESK_ALERT_COOLDOWN_MS = 6 * 3600_000;

/** More than this many `tg.update_failed` log rows in an hour pages the Desk. */
export const UPDATE_FAILURE_THRESHOLD = 3;
export const UPDATE_FAILURE_WINDOW_MS = 3600_000;

/** Pure gate for the update-failure watch: strict > so exactly 3 is still quiet. */
export function updateFailuresExceeded(failuresInHour: number, threshold = UPDATE_FAILURE_THRESHOLD): boolean {
  return failuresInHour > threshold;
}

export function cooldownDue(lastAt: string | null | undefined, cooldownMs: number, now = Date.now()): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  if (Number.isNaN(t)) return true;
  return now - t >= cooldownMs;
}

/** What a new occurrence of an already-possible error should do. */
export type AlertAction = "insert" | "update" | "update_and_notify";

/**
 * `insert` when nothing is open for the key; `update` when the open one is
 * still inside its cooldown (the Desk stays quiet, the repeat count grows);
 * `update_and_notify` when the cooldown has passed (same row, new message).
 * An unparseable timestamp counts as due, so a corrupt row cannot mute an
 * error forever.
 */
export function alertAction(recentAt: string | null | undefined, cooldownMs: number, now = Date.now()): AlertAction {
  if (recentAt === null || recentAt === undefined) return "insert";
  return cooldownDue(recentAt, cooldownMs, now) ? "update_and_notify" : "update";
}

export async function deskAlert(opts: {
  db: SupabaseClient;
  key: string;
  kind: string;
  severity: string;
  message: string;
  cooldownMs?: number;
  buttons?: InlineButton[][];
}): Promise<{ sent: boolean; repeats: number }> {
  const cooldownMs = opts.cooldownMs ?? DESK_ALERT_COOLDOWN_MS;
  const dedupe = `err:${opts.key}`;
  const { data: recent } = await opts.db.from("alerts")
    .select("id, at, payload").eq("dedupe_key", dedupe).is("resolved_at", null)
    .order("at", { ascending: false }).limit(1).maybeSingle();
  const repeats = Number((recent?.payload as { repeats?: number } | null)?.repeats ?? 0) + 1;
  const action = alertAction(recent?.at as string | null ?? null, cooldownMs);

  if (action === "insert") {
    await opts.db.from("alerts").insert({
      kind: opts.kind,
      severity: opts.severity,
      message: opts.message,
      payload: { key: opts.key, repeats: 0 },
      dedupe_key: dedupe,
    });
    await notifyDesk(opts);
    return { sent: true, repeats: 0 };
  }

  // Same row on purpose: `at` only moves when the Desk is told again, so the
  // cooldown is measured from the last message and not from the last repeat.
  const patch: Record<string, unknown> = {
    payload: { ...((recent?.payload as Record<string, unknown> | null) ?? {}), key: opts.key, repeats },
  };
  if (action === "update_and_notify") {
    Object.assign(patch, {
      at: new Date().toISOString(), message: opts.message, severity: opts.severity, kind: opts.kind,
    });
  }
  await opts.db.from("alerts").update(patch).eq("id", (recent as { id: string }).id);
  if (action === "update") return { sent: false, repeats };
  await notifyDesk(opts);
  return { sent: true, repeats };
}

async function notifyDesk(opts: { message: string; buttons?: InlineButton[][] }): Promise<void> {
  const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
  await sendMessage(desk, redactSecrets(opts.message), { parse_mode: "HTML", buttons: opts.buttons });
}
