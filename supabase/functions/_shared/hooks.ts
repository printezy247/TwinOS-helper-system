/**
 * Hook + CTA library (plan §17 Wave 3 item 5): opening hooks per pillar and
 * language from the `hooks` table (FYP §03, 40 seeded lines), CTA lines per
 * platform and language from the `ctas` table (migration 0027). Both rotate
 * least-recently-used via `times_used` / `last_used_at`. No AI anywhere:
 * every line is Jack-approved seed data, served in rotation.
 *
 * Callers append at most one line (plan §12: one CTA) and only when the body
 * has none yet (`ctaCount(body) === 0` in _shared/compliance.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HookRow {
  id: number;
  pillar: string | null;
  lang: string;
  text: string;
  times_used: number | null;
  last_used_at: string | null;
  active: boolean;
}

export interface CtaRow {
  id: number;
  platform: string;
  lang: string;
  text: string;
  times_used: number | null;
  last_used_at: string | null;
  active: boolean;
}

/** Least-recently-used first: never-used, then oldest use, then fewest uses. */
export function pickLru<T extends { id: number; times_used: number | null; last_used_at: string | null }>(
  rows: T[],
): T | null {
  if (!rows.length) return null;
  const at = (r: T): number => (r.last_used_at ? Date.parse(r.last_used_at) : -Infinity);
  return [...rows].sort((a, b) =>
    at(a) - at(b) ||
    (a.times_used ?? 0) - (b.times_used ?? 0) ||
    a.id - b.id
  )[0];
}

/** Same language, pillar match first; any same-language hook when the pillar has none. */
export function eligibleHooks(rows: HookRow[], lang: string, pillar?: string | null): HookRow[] {
  const same = rows.filter((r) => r.active && r.lang === lang);
  if (!pillar) return same;
  const direct = same.filter((r) => r.pillar === pillar);
  return direct.length ? direct : same;
}

/** Exact platform + language: a wrong-platform CTA is worse than none. */
export function eligibleCtas(rows: CtaRow[], platform: string, lang: string): CtaRow[] {
  return rows.filter((r) => r.active && r.platform === platform && r.lang === lang);
}

async function bump(db: SupabaseClient, table: string, row: { id: number; times_used: number | null }): Promise<void> {
  await db.from(table)
    .update({ times_used: (row.times_used ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq("id", row.id);
}

/** Next hook for a pillar + language, rotated LRU. Null when the bank is empty. */
export async function nextHook(
  db: SupabaseClient,
  opts: { pillar?: string | null; lang: "en" | "ms" },
): Promise<{ id: number; text: string } | null> {
  const { data } = await db.from("hooks")
    .select("id, pillar, lang, text, times_used, last_used_at, active")
    .eq("lang", opts.lang);
  const pick = pickLru(eligibleHooks((data ?? []) as HookRow[], opts.lang, opts.pillar));
  if (!pick) return null;
  await bump(db, "hooks", pick);
  return { id: pick.id, text: pick.text };
}

/** Next CTA for a platform + language, rotated LRU. Null when none is seeded. */
export async function nextCta(
  db: SupabaseClient,
  opts: { platform: string; lang: "en" | "ms" },
): Promise<{ id: number; text: string } | null> {
  const { data } = await db.from("ctas")
    .select("id, platform, lang, text, times_used, last_used_at, active")
    .eq("platform", opts.platform)
    .eq("lang", opts.lang);
  const pick = pickLru(eligibleCtas((data ?? []) as CtaRow[], opts.platform, opts.lang));
  if (!pick) return null;
  await bump(db, "ctas", pick);
  return { id: pick.id, text: pick.text };
}
