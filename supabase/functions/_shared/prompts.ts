/**
 * Prompt library + agent memory (UPGRADE-PHASES Phase 5).
 *
 *   activePrompt(mode, params)  the versioned system prompt to use, or null
 *                               when the library has nothing — the caller then
 *                               keeps the hard-coded template in openrouter.ts
 *                               (code stays the fallback; prompts win).
 *   loadMemories(params, n)     up to n relevant remembered lines to prepend
 *   promptCatalog()             every row for the dashboard picker
 *
 * Selection: rows whose mode matches the request (or '*' as the global
 * default) and whose platform/pillar are null-or-matching. Among candidates
 * the row pinned by the prompt_version setting wins when present; otherwise
 * mode-specific beats '*', and the newest version wins inside a bucket.
 * Request-scoped pins from the dashboard picker ({pinName, pinVersion}) beat
 * the setting.
 */
import { admin, setting } from "./supabase.ts";

export type PromptRow = {
  id: number;
  name: string;
  version: number;
  mode: string;
  platform: string | null;
  pillar: string | null;
  lang: string;
  body: string;
  active: boolean;
  created_at: string;
};

export type PromptParams = {
  platform?: string;
  pillar?: string;
  lang?: string;
  pinName?: string;
  pinVersion?: number;
};

const COLUMNS = "id, name, version, mode, platform, pillar, lang, body, active, created_at";

export async function activePrompt(mode: string, params: PromptParams = {}): Promise<PromptRow | null> {
  const db = admin();
  // No SQL-side mode filter: the pure selector below needs the full library
  // so an explicit dashboard pin can address a row of ANY mode.
  const { data, error } = await db.from("prompts").select(COLUMNS).limit(200);
  if (error || !data?.length) return null;
  const settingVersion = Number(await setting("prompt_version").catch(() => null));
  return selectPrompt(data as unknown as PromptRow[], mode, params, Number.isFinite(settingVersion) ? settingVersion : 0);
}

/**
 * Pure selection, so the precedence rules are unit-testable:
 *   active + platform/pillar match  → the addressable rows
 *   request pin (name@version)      → beats mode AND the setting (the
 *                                     dashboard picked this exact row)
 *   otherwise: mode or '*' only → candidates
 *   prompt_version setting          → version pin; mode-specific still wins
 *                                     inside that version
 *   mode-specific over '*', newest version wins inside a bucket
 */
export function selectPrompt(
  rows: PromptRow[],
  mode: string,
  params: PromptParams,
  settingVersion: number,
): PromptRow | null {
  const base = rows.filter((row) => {
    if (!row.active) return false;
    if (row.platform && params.platform && row.platform !== params.platform) return false;
    if (row.pillar && params.pillar && row.pillar !== params.pillar) return false;
    return true;
  });

  if (params.pinName && typeof params.pinVersion === "number") {
    const pinned = base.find((r) => r.name === params.pinName && r.version === params.pinVersion);
    if (pinned) return pinned;
  }

  const candidates = base.filter((r) => r.mode === mode || r.mode === "*");
  if (!candidates.length) return null;

  if (settingVersion > 0) {
    const bySetting = candidates.filter((r) => r.version === settingVersion);
    if (bySetting.length) {
      const specificHere = bySetting.filter((r) => r.mode === mode);
      return newest(specificHere.length ? specificHere : bySetting);
    }
  }

  const specific = candidates.filter((r) => r.mode === mode);
  return newest(specific.length ? specific : candidates);
}

function newest(rows: PromptRow[]): PromptRow {
  return [...rows].sort((a, b) => b.version - a.version || b.id - a.id)[0];
}

export type MemoryLine = { id: number; kind: string; content: string };

/**
 * Preferences always count; hooks/corrections only when they match the
 * request's pillar/platform/lang. Three lines max, heaviest and most recently
 * used first. last_used_at is touched fire-and-forget — remembering must not
 * slow generation.
 */
export async function loadMemories(params: PromptParams = {}, limit = 3): Promise<MemoryLine[]> {
  const db = admin();
  const { data, error } = await db.from("ai_memory").select("id, kind, content, pillar, platform, lang, weight, last_used_at").limit(200);
  if (error || !data?.length) return [];

  const rows = (data as Array<{ id: number; kind: string; content: string; pillar: string | null; platform: string | null; lang: string; weight: number | null; last_used_at: string | null }>)
    .filter((r) => {
      if (r.kind === "preference") return true;
      if (r.pillar && params.pillar && r.pillar !== params.pillar) return false;
      if (r.platform && params.platform && r.platform !== params.platform) return false;
      if (params.lang && r.lang !== params.lang) return false;
      return true;
    });
  rows.sort((a, b) =>
    Number(b.weight ?? 1) - Number(a.weight ?? 1) ||
    Date.parse(b.last_used_at ?? "1970-01-01") - Date.parse(a.last_used_at ?? "1970-01-01")
  );
  const picked = rows.slice(0, limit);
  if (picked.length) {
    void db.from("ai_memory").update({ last_used_at: new Date().toISOString() }).in("id", picked.map((r) => r.id));
  }
  return picked.map((r) => ({ id: r.id, kind: r.kind, content: r.content }));
}

export function memoryBlock(lines: MemoryLine[]): string | null {
  if (!lines.length) return null;
  return (
    "\n\nWhat TwinOS remembers (apply where it fits, never quote verbatim):\n" +
    lines.map((l) => `- (${l.kind}) ${l.content}`).join("\n")
  );
}

/** Every library row, newest version first — /ai/status and the picker. */
export async function promptCatalog(): Promise<PromptRow[]> {
  const { data, error } = await admin()
    .from("prompts")
    .select(COLUMNS)
    .order("name")
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PromptRow[];
}
