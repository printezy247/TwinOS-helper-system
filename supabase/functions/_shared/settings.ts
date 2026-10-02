/**
 * settings.value is jsonb, so supabase-js hands back a Telegram id as a JS
 * number and a flag as a boolean. Every caller treats a setting as text (and
 * compares ids as text), so turn whatever came back into its text once, here.
 */
export function settingText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
  return JSON.stringify(raw);
}
