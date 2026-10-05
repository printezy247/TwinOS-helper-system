/**
 * Research (Phase 5, plan §9.J): what people ask, what is worth a video, and the
 * Monday brief that puts the two next to the 28-day calendar.
 *
 *   parseSuggest / queryVariants   Google autocomplete, the free demand signal (ms / MY included)
 *   topicRisk                      a topic that needs a claim, or a banned word, is risky to film
 *   demandScore                   demand, each 0..1; the row's total_score is
 *                                 demand x ICP fit x (1 - compliance risk) and
 *                                 Postgres computes it (topic_clusters is
 *                                 generated) — never write it
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

export interface BriefSlot { dow: number; pillar: string | null; topic: string | null }
export interface BriefCluster { name: string; pillar: string | null; persona: string | null; score: number }
export interface ProposedSlot {
  dow: number; pillar: string | null; calendar_topic: string | null; suggested: string | null; score: number | null;
  hook: string | null;
}
export interface BriefHook { pillar: string | null; text: string }

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildBrief(p: {
  week: string; cycleWeek: number; slots: BriefSlot[]; clusters: BriefCluster[]; hooks?: BriefHook[];
}): { body: string; proposed_slots: ProposedSlot[] } {
  const pool = p.clusters.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const proposed: ProposedSlot[] = [...p.slots].sort((a, b) => a.dow - b.dow).map((s) => {
    const pick = pool.find((c) => !used.has(c.name) && c.pillar !== null && c.pillar === s.pillar);
    if (pick) used.add(pick.name);
    // Grounded: each day carries its evidence — calendar topic, best scored
    // topic, and a hook-bank line to open with.
    const hook = (p.hooks ?? []).find((h) => h.pillar !== null && h.pillar === s.pillar)?.text ?? null;
    return { dow: s.dow, pillar: s.pillar, calendar_topic: s.topic, suggested: pick?.name ?? null, score: pick?.score ?? null, hook };
  });
  const lines = [`Monday brief: week of ${p.week} (calendar week ${p.cycleWeek} of the 28-day cycle)`, ""];
  for (const s of proposed) {
    const cal = s.calendar_topic ?? "(no calendar topic)";
    lines.push(`${DAYS[s.dow] ?? s.dow} ${s.pillar ?? ""}: ${cal}`);
    if (s.suggested) lines.push(`    better fit this week: ${s.suggested} (score ${s.score!.toFixed(2)})`);
    if (s.hook) lines.push(`    open with: ${s.hook}`);
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

/**
 * The words one persona actually talks in, for `pickIdeas`.
 *
 * Seed questions arrive as full sentences in three languages, and nobody
 * publishes the exact sentence a reader asked — so each is reduced to its
 * meaningful words (`coreTerms`) and the words are collected, not the phrase.
 * A hit therefore means "someone is writing about a question this reader
 * asks", which is the only claim the scorer makes.
 */
export function personaTerms(bag: Record<string, unknown> | null | undefined, pillar?: string | null): string[] {
  const out = new Set<string>();
  const add = (sentence: string) => {
    for (const w of coreTerms(sentence, 12).split(" ")) if (w) out.add(w);
  };
  for (const lang of ["en", "ms", "manglish"]) {
    const list = Array.isArray(bag?.[lang]) ? (bag[lang] as unknown[]).map(String) : [];
    for (const seed of list) add(seed);
  }
  if (pillar) add(pillar);
  return [...out].slice(0, 80);
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

/** A fresh feed item as the scorer sees it. */
export interface IdeaItem {
  id: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
}

/** One persona's terms: what that reader actually asks about. */
export interface IdeaPersona {
  id: number;
  pillar: string | null;
  terms: string[];
}

export interface Idea {
  id: string;
  title: string;
  publishedAt: string | null;
  pillar: string | null;
  icp: number | null;
  matched: string[];
  score: number;
}

/**
 * Turn what other people published this fortnight into post ideas Jack can
 * pick from: every item that mentions one of a persona's seed terms, ranked by
 * how many of them it mentions, with the persona and the matched words on the
 * row so the reason it surfaced is visible.
 *
 * Deliberately word counting, not a model: the terms come from questions real
 * readers asked (`personas.seed_questions`), so a hit means someone is talking
 * about a question Jack answers. Nothing is written and nothing is posted.
 */
export function pickIdeas(
  items: IdeaItem[],
  personas: IdeaPersona[],
  opts: { now?: number; days?: number; limit?: number } = {},
): Idea[] {
  const now = opts.now ?? Date.now();
  const windowMs = (opts.days ?? 14) * 86_400_000;
  const limit = Math.max(1, opts.limit ?? 10);
  const texts = items.map((it) => `${it.title}\n${it.summary ?? ""}`.toLowerCase());
  const out: Idea[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const at = it.publishedAt ? Date.parse(it.publishedAt) : NaN;
    // An undated item cannot be proven stale, so it stays in.
    if (Number.isFinite(at) && now - at > windowMs) continue;
    const text = texts[i];
    let best: Idea | null = null;
    for (const p of personas) {
      const matched = p.terms.filter((t) => t.length >= 3 && !GENERIC.has(t.toLowerCase()) && text.includes(t.toLowerCase()));
      if (!matched.length) continue;
      if (!best || matched.length > best.matched.length) {
        best = {
          id: it.id, title: it.title, publishedAt: it.publishedAt ?? null,
          pillar: p.pillar, icp: p.id, matched, score: matched.length,
        };
      }
    }
    if (best) out.push(best);
  }

  out.sort((a, b) => b.score - a.score ||
    (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  return out.slice(0, limit);
}

/**
 * Words that carry no signal about what a post is *about*.
 *
 * Calibrated against the live corpus rather than guessed. The first scoring
 * pass counted every word of a persona's seed questions equally, so "all",
 * "one", "best" and "stop" scored a crypto chart as a gold idea, and the top
 * ten was a ranking by word count.
 *
 * Word frequency was tried first and is the wrong instrument here: measured
 * over 233 real items, "gold" appears in 46% of them and "all" in 36%, so
 * dropping the frequent words would have dropped gold first. What separates
 * the posts is whether a word names a subject or merely travels with trading
 * writing, and that is a list, not a ratio.
 *
 * Deliberately not on it: gold, usd, nfp, fed, yields, forex, signal, firm,
 * zone, macro, risk, news. Those are Jack's subjects.
 */
const GENERIC = new Set((
  "all one not out just only more most than then when while also even still next new now way ways " +
  "make look show read keep first last always never real really best better good bad why how into via per own same " +
  "up down move take trade trades trading long short buy sell red green open opened close closed " +
  "daily day days week weeks time times price prices market markets chart charts position positions " +
  "stop loss losses profit profits win wins rate rates tp sl dd ai"
).split(" "));
