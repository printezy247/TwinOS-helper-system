/**
 * E2 (v5 plan): hook promotion as a proposal, never automatic.
 *
 * Pure decision logic on `v_hook_performance`-shaped rows: when a candidate
 * hook beats the incumbent by `margin` (relative lift on avg 1 h views) over
 * at least `min_posts` of its own posts, at most ONE suggestion comes back,
 * carrying both sides' numbers as evidence. Below the margin, or without
 * enough posts, or with a broken config, nothing comes back — the wrong hook
 * costs reach, so a suggestion only ever waits for Jack's approval; this
 * module never acts on anything.
 */

/** One row of v_hook_performance (hook_id, hook, lang, uses, avg_views_1h). */
export interface HookStat {
  hook_id: number;
  hook: string;
  lang: string;
  uses: number;
  avg_views_1h: number | null;
}

export interface PromotionConfig {
  /** Relative lift required: candidate ≥ incumbent × (1 + margin). */
  margin: number;
  /** Candidate needs at least this many of its own posts to speak. */
  min_posts: number;
}

export interface PromotionSuggestion {
  candidate: HookStat;
  incumbent: HookStat;
  /** Percent lift over the incumbent, rounded; null when the incumbent has zero views. */
  lift_pct: number | null;
  config: PromotionConfig;
}

/** A config that is not a sane positive margin / a whole count ≥ 1 never fires. */
function configOk(c: PromotionConfig): boolean {
  return Number.isFinite(c.margin) && c.margin >= 0 && Number.isInteger(c.min_posts) && c.min_posts >= 1;
}

function comparable(s: HookStat | null): s is HookStat {
  return !!s && Number.isFinite(s.uses) && typeof s.avg_views_1h === "number" && Number.isFinite(s.avg_views_1h);
}

/** Does `cand` beat `inc` by at least the margin? Zero-incumbent: any positive average beats it. */
function beats(cand: HookStat, inc: HookStat, margin: number): boolean {
  const base = inc.avg_views_1h ?? 0;
  if (base === 0) return (cand.avg_views_1h ?? 0) > 0;
  // Tiny epsilon so 100 × 1.25 = 125 counts as "at the margin" despite float noise.
  return (cand.avg_views_1h ?? NaN) >= base * (1 + margin) - 1e-9;
}

/**
 * The one suggestion Friday should show, or null. Candidates below
 * `min_posts`, without view data, in another language, or equal to the
 * incumbent are not evidence. Ties break on the lower hook_id: deterministic.
 */
export function promoteSuggestion(
  incumbent: HookStat | null,
  candidates: HookStat[],
  config: PromotionConfig,
): PromotionSuggestion | null {
  if (!configOk(config) || !comparable(incumbent)) return null;
  const pool = candidates
    .filter((c) => c.hook_id !== incumbent.hook_id)
    .filter((c) => c.lang === incumbent.lang)
    .filter(comparable)
    .filter((c) => c.uses >= config.min_posts)
    .filter((c) => beats(c, incumbent, config.margin));
  if (!pool.length) return null;
  const best = (s: HookStat): number => s.avg_views_1h ?? Number.NEGATIVE_INFINITY;
  const winner = [...pool].sort((a, b) => best(b) - best(a) || a.hook_id - b.hook_id)[0];
  const inc = incumbent.avg_views_1h ?? 0;
  return {
    candidate: winner,
    incumbent,
    lift_pct: inc > 0 ? Math.round((best(winner) / inc - 1) * 10_000) / 100 : null,
    config,
  };
}
