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

/**
 * Typed readers over a raw jsonb `settings.value` (the #38 bug class: a
 * Telegram id arrived as a JS number and failed a text compare).
 *
 *   settingId     chat/user ids: digits as text, never a float, never null-ly "0"
 *   settingNumber counts, minutes, hours: a finite number or null
 *   settingBool   flags: a real boolean or "true"/"false" text, else null
 *
 * Null means "unset or the wrong shape": callers fall back to their default
 * instead of messaging chat id 0 or dividing by NaN.
 */
export function settingId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "bigint") {
    return Number.isInteger(Number(raw)) ? String(raw) : null;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return /^-?\d+$/.test(t) ? t : null;
  }
  return null;
}

export function settingNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function settingBool(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const t = raw.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return null;
}
