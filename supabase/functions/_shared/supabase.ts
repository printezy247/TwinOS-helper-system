/**
 * Supabase clients and settings access.
 *
 * `admin()` uses the service-role key that Supabase injects into every Edge
 * Function (SUPABASE_SERVICE_ROLE_KEY). It bypasses RLS, so every function
 * must run the role check in auth.ts/roles.ts BEFORE touching a table.
 *
 * `settings` is the one place for business constants (plan §9.A.3): channel
 * ids, Jack's Telegram id, posting times. Env variables are only a fallback
 * so the functions still boot on a fresh project before the seed runs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";
import { settingBool, settingId, settingNumber, settingText } from "./settings.ts";

let cached: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new HttpError(503, "not_configured", "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

/** Anon client bound to a user's JWT, used only to verify the token. */
export function anonWithJwt(jwt: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new HttpError(503, "not_configured", "SUPABASE_ANON_KEY missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const settingsCache = new Map<string, { value: string | null; at: number }>();
const SETTINGS_TTL_MS = 60_000;

/**
 * Read one `settings.value` by key. Table shape: (key text pk, value text,
 * note text). Falls back to the env variable named in `envFallback`.
 */
export async function setting(key: string, envFallback?: string): Promise<string | null> {
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    const { data } = await admin().from("settings").select("value").eq("key", key).maybeSingle();
    value = settingText(data?.value);
  } catch (err) {
    console.warn(`[settings] read failed for ${key}`, err);
  }
  if (value === null && envFallback) value = Deno.env.get(envFallback) ?? null;
  settingsCache.set(key, { value, at: Date.now() });
  return value;
}

export async function requireSetting(key: string, envFallback?: string): Promise<string> {
  const v = await setting(key, envFallback);
  if (!v) throw new HttpError(503, "not_configured", `setting ${key} is not set`);
  return v;
}

/**
 * The shape each known setting must have (typed reader in settings.ts).
 * ids stay digit-text (never float-compared), numbers stay finite, flags
 * stay real booleans. Unknown keys read as text, as before.
 */
export type SettingType = "id" | "number" | "boolean" | "text";

export const SETTING_TYPES: Record<string, SettingType> = {
  jack_telegram_user_id: "id",
  desk_group_chat_id: "id",
  channel_chat_id: "id",
  discussion_group_chat_id: "id",
  timezone: "text",
  signal_expiry_hours: "number",
  offer_posts_per_week_max: "number",
  llm_variants_enabled: "boolean",
  llm_angles: "number",
  llm_local_url: "text",
  platform_signatures: "text",
};

/**
 * Read a setting already coerced to its declared shape. Null means unset or
 * the wrong shape: fall back to the default, never to chat id 0 or NaN.
 * A mismatch is logged so a bad seed row is found, not silently kept.
 */
export async function settingTyped(key: string, envFallback?: string): Promise<string | null> {
  const raw = await setting(key, envFallback);
  if (raw === null) return null;
  const type = SETTING_TYPES[key];
  if (!type || type === "text") return raw;
  // `setting()` already stringified the jsonb; re-coerce from the raw shape.
  let ok: boolean | number | string | null;
  if (type === "id") ok = settingId(raw);
  else if (type === "number") ok = settingNumber(raw);
  else ok = settingBool(raw);
  if (ok === null) {
    console.warn(`[settings] ${key} has the wrong shape for ${type}: ${raw.slice(0, 80)}`);
    return null;
  }
  return String(ok);
}

/**
 * Settings keys the Phase 1 functions read.
 *
 * These are the exact keys `supabase/seed.sql` writes and the ones
 * `v_friday_scoreboard` and friends already read from SQL. They used to be
 * `jack_telegram_id` / `tg_desk_chat_id` / `tg_channel_id` /
 * `tg_discussion_chat_id`, which nothing else in the system used: the Desk bot
 * would have read null and 404'd on the first message, and Jack would have
 * filled in four rows that no view could see.
 *
 * A value of JSON `null` (the seed's CONFIRM placeholders) reads back as null,
 * so `requireSetting` raises 503 naming the setting instead of messaging chat
 * id 0. Fill them from docs/SETUP.md step 0.6.
 */
export const SETTING_KEYS = {
  jackTelegramId: "jack_telegram_user_id", // bigint as text; only this id may press Approve (§9.C.14)
  deskChatId: "desk_group_chat_id", // EzyMap Desk private group
  channelId: "channel_chat_id", // @ezymap channel (bigint, -100…)
  discussionChatId: "discussion_group_chat_id", // linked discussion group (Phase 4)
  timezone: "timezone", // Asia/Kuala_Lumpur
  signalExpiryHours: "signal_expiry_hours", // stop-if window (§9.D.25)
  offerMaxPerWeek: "offer_posts_per_week_max", // one offer post a week (§9.E.41)
  llmVariantsEnabled: "llm_variants_enabled", // Wave 3 item 6: local-model variants, off by default
  llmAngles: "llm_angles", // Wave 3 item 6: angles per platform (default 3)
  llmLocalUrl: "llm_local_url", // Wave 3 item 6: loopback llama-server base URL
} as const;
