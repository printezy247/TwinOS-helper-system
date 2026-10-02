/**
 * Error alerts to the Desk with a cooldown per error and a repeat count
 * (plan §17 Wave 3 item 3).
 *
 * One open `alerts` row per key (`dedupe_key = err:<key>`). Inside the
 * cooldown the Desk stays quiet and only `payload.repeats` grows; past it a
 * new message goes out. Recovery notes go through the same path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSetting, SETTING_KEYS } from "./supabase.ts";
import { redactSecrets } from "./providers.ts";
import { sendMessage } from "./tg.ts";

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

export async function deskAlert(opts: {
  db: SupabaseClient;
  key: string;
  kind: string;
  severity: string;
  message: string;
  cooldownMs?: number;
}): Promise<{ sent: boolean; repeats: number }> {
  const cooldownMs = opts.cooldownMs ?? DESK_ALERT_COOLDOWN_MS;
  const dedupe = `err:${opts.key}`;
  const { data: recent } = await opts.db.from("alerts")
    .select("id, at, payload").eq("dedupe_key", dedupe).is("resolved_at", null)
    .order("at", { ascending: false }).limit(1).maybeSingle();
  const repeats = Number((recent?.payload as { repeats?: number } | null)?.repeats ?? 0);
  if (recent && !cooldownDue(recent.at as string | null, cooldownMs)) {
    await opts.db.from("alerts")
      .update({ payload: { ...((recent.payload as Record<string, unknown> | null) ?? {}), repeats: repeats + 1 } })
      .eq("id", (recent as { id: string }).id);
    return { sent: false, repeats: repeats + 1 };
  }
  await opts.db.from("alerts").insert({
    kind: opts.kind,
    severity: opts.severity,
    message: opts.message,
    payload: { key: opts.key, repeats: 0 },
    dedupe_key: dedupe,
  });
  const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
  await sendMessage(desk, redactSecrets(opts.message), { parse_mode: "HTML" });
  return { sent: true, repeats: 0 };
}
