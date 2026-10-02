/**
 * Research (Phase 5, plan §9.J): what people ask, what is worth a video, and the
 * Monday brief that puts the two next to the 28-day calendar.
 *
 *   parseSuggest / queryVariants   Google autocomplete, the free demand signal (ms / MY included)
 *   topicRisk                      a topic that needs a claim, or a banned word, is risky to film
 *   demandScore / scoreTopic       demand x ICP fit x (1 - compliance risk), each 0..1
 *   buildBrief                     next week's calendar slots with the best fitting topic for each
 *
 * Pure. research/index.ts does the fetching and the writing.
 */
import { bannedWords, detectClaims } from "./compliance.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Google's autocomplete answers `[query, [suggestion, ...]]`. Anything else is an empty list. */
export function parseSuggest(json: unknown): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  const out: string[] = [];
  for (const s of json[1]) {
    if (typeof s !== "string") continue;
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const SUFFIXES = ["", " a", " s", " t", " b", " c"];

/** The seed itself, then a few letter extensions, so autocomplete shows more than its first ten. */
export function queryVariants(seed: string, n: number): string[] {
  return SUFFIXES.slice(0, Math.max(1, Math.min(n, SUFFIXES.length))).map((s) => `${seed}${s}`);
}

/** 1 when the topic names a banned phrase, 0.25 per kind of claim it needs, 0 when it needs none. */
export function topicRisk(topic: string): number {
  if (bannedWords(topic).length) return 1;
  return Math.min(1, detectClaims(topic).length * 0.25);
}

export function demandScore(p: { suggestions: number; csiPopularity?: number | null; csiTrend?: string | null }): number {
  const base = Math.min(1, Math.max(0, p.suggestions) / 10);
  const pop = p.csiPopularity ? (Math.min(Math.max(p.csiPopularity, 0), 100) / 100) * 0.3 : 0;
  const trend = p.csiTrend === "up" ? 0.1 : 0;
  return Math.min(1, round2(base + pop + trend));
}

export function scoreTopic(p: { demand: number; icpFit: number; risk: number }): number {
  return round2(p.demand * p.icpFit * (1 - p.risk));
}

export interface BriefSlot { dow: number; pillar: string | null; topic: string | null }
export interface BriefCluster { name: string; pillar: string | null; persona: string | null; score: number }
export interface ProposedSlot { dow: number; pillar: string | null; calendar_topic: string | null; suggested: string | null; score: number | null }

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildBrief(p: { week: string; cycleWeek: number; slots: BriefSlot[]; clusters: BriefCluster[] }): { body: string; proposed_slots: ProposedSlot[] } {
  const pool = p.clusters.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const proposed: ProposedSlot[] = [...p.slots].sort((a, b) => a.dow - b.dow).map((s) => {
    const pick = pool.find((c) => !used.has(c.name) && c.pillar !== null && c.pillar === s.pillar);
    if (pick) used.add(pick.name);
    return { dow: s.dow, pillar: s.pillar, calendar_topic: s.topic, suggested: pick?.name ?? null, score: pick?.score ?? null };
  });
  const lines = [`Monday brief: week of ${p.week} (calendar week ${p.cycleWeek} of the 28-day cycle)`, ""];
  for (const s of proposed) {
    const cal = s.calendar_topic ?? "(no calendar topic)";
    lines.push(`${DAYS[s.dow] ?? s.dow} ${s.pillar ?? ""}: ${cal}`);
    if (s.suggested) lines.push(`    better fit this week: ${s.suggested} (score ${s.score!.toFixed(2)})`);
  }
  const rest = pool.filter((c) => !used.has(c.name)).slice(0, 3);
  if (!pool.length) lines.push("", "No scored topics yet: the weekly autocomplete run has not found any.");
  else if (rest.length) lines.push("", "Also worth a video:", ...rest.map((c) => `- ${c.name} (score ${c.score.toFixed(2)})`));
  lines.push("", "Score = demand x ICP fit x (1 - compliance risk). Demand is autocomplete depth plus Creator Search Insights.");
  return { body: lines.join("\n"), proposed_slots: proposed };
}

const FILLER = new Set((
  "a an the i my me you your do does did is are was to of in on at for and or how what why when where who which can could should would will it " +
  "go goes this that with from about macam mana apa yang di ke dan untuk nak boleh tak saya aku kita"
).split(" "));

/**
 * A long question reduced to its first few meaningful words: autocomplete knows "stop loss gold"
 * where it has never seen "where does my stop loss go on gold".
 */
export function coreTerms(seed: string, n = 3): string {
  const words = seed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  const keep = words.filter((w) => !FILLER.has(w));
  return (keep.length ? keep : words).slice(0, n).join(" ");
}

export interface CsiRow {
  topic: string;
  category: string | null;
  metric: string | null;
  value: number | null;
  trend: "up" | "flat" | "down" | null;
  note: string | null;
}

/**
 * One Creator Search Insights reading as a csi_captures row. ABDUL's tool sends
 * topic, popularity, trend, gap and icp; the dashboard form sends category,
 * metric and value. Both land in the same columns.
 */
export function csiRow(b: Record<string, unknown>): CsiRow {
  const topic = typeof b.topic === "string" ? b.topic.trim() : "";
  if (!topic) throw new Error("topic is required");
  const trend = b.trend === undefined || b.trend === null || b.trend === "" ? null : String(b.trend);
  if (trend !== null && !["up", "flat", "down"].includes(trend)) throw new Error("trend must be up, flat or down");
  const raw = b.value ?? b.popularity;
  let value: number | null = null;
  if (raw !== undefined && raw !== null && raw !== "") {
    value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("value must be a number");
  }
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const note = [b.gap === true ? "content gap" : null, str(b.note, 500)].filter(Boolean).join(". ") || null;
  return {
    topic: topic.slice(0, 200),
    category: str(b.category ?? b.icp, 80),
    metric: str(b.metric, 80) ?? (b.popularity !== undefined && b.popularity !== null ? "popularity" : null),
    value,
    trend: trend as CsiRow["trend"],
    note,
  };
}
