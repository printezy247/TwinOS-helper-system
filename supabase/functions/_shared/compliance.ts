/**
 * Compliance engine (plan §12, §9.O): the Posting Kit pre-post checklist as
 * pure functions. No I/O here, so the dashboard, ABDUL and the publisher all
 * run the very same code and `deno test` covers it without a database.
 *
 * `check(variant)` returns every finding; `blocking` findings stop publishing,
 * `needs_approval` findings force the Jack-only gate, `warn` findings are shown.
 */

export type PostType =
  | "gold_map"
  | "macro_card"
  | "signal_card"
  | "result_reply"
  | "lesson"
  | "channel_audit"
  | "scorecard"
  | "outlook"
  | "offer"
  | "poll"
  | "evening_wrap"
  | "news_alert"
  | "member_result"
  | "holiday"
  | "start_here";

export type Platform = "telegram" | "instagram" | "facebook" | "threads" | "youtube" | "tiktok" | "x";
export type Lang = "en" | "ms";

export interface VariantInput {
  post_type: PostType;
  platform: Platform;
  lang: Lang;
  body: string;
  /** Jack's numbers (map levels, signal prices) or board rows the body may quote. */
  allowed_numbers?: number[];
  /** True when the post type is long form (lesson, start_here, audit). */
  long_form?: boolean;
  /** Set on member_result posts once written permission is recorded. */
  permission_recorded?: boolean;
  /** Set when the planned slot language is known. */
  planned_lang?: Lang;
  /** Offer posts already published this ISO week (for the one-per-week rule). */
  offers_this_week?: number;
  /** Video posts: a spoken or on-screen risk line was confirmed. */
  video_warning_confirmed?: boolean;
}

export type Severity = "blocking" | "needs_approval" | "warn";

export interface Finding {
  check: string;
  severity: Severity;
  message: string;
  evidence?: string[];
}

export interface CheckResult {
  ok: boolean; // no blocking findings
  needs_approval: boolean;
  findings: Finding[];
  claim_flags: string[];
}

/* ------------------------------------------------------------------------ */
/* Word lists                                                                */

/** Posting Kit banned list + SC additions. Lower-case, matched on word bounds. */
export const BANNED_WORDS_EN = [
  "guaranteed",
  "guarantee",
  "risk-free",
  "risk free",
  "no risk",
  "sure win",
  "sure profit",
  "100% win",
  "100% accurate",
  "never lose",
  "can't lose",
  "cannot lose",
  "easy money",
  "passive income",
  "get rich",
  "double your account",
  "best signals",
  "best",
  "secret strategy",
  "holy grail",
  "insider",
  "limited slots",
  "last chance",
];

export const BANNED_WORDS_MS = [
  "tanpa risiko",
  "pasti untung",
  "confirm untung",
  "mesti untung",
  "jamin untung",
  "dijamin",
  "jaminan",
  "untung besar tanpa",
  "duit mudah",
  "cepat kaya",
  "kaya cepat",
  "terbaik",
  "100% menang",
  "takkan rugi",
  "tak akan rugi",
  "rahsia",
];

/** Phrases that make a post a "claim" (plan §9.O.111) → Jack approval. */
export const CLAIM_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // prices: $29, USD 249, RM49, 49/mo, 14.99
  { name: "price", re: /(?:\$|usd\s?|rm\s?|myr\s?)\s?\d{1,5}(?:[.,]\d{1,2})?|\b\d{1,4}(?:\.\d{2})?\s?\/\s?(?:mo|month|bulan|yr|year|tahun)\b/i },
  // levels: 4-digit gold prices with or without a thousands comma ("4590",
  // "4,613"), "entry 4590", "TP 4604", "SL 4585". A bare year (2020–2039) in a
  // date line is not a level.
  { name: "level", re: /\b(?:entry|tp\d?|sl|stop|target|buy|sell|long|short|zone)\b[^\n]{0,12}\b(?:\d{1,2},\d{3}|\d{3,5})(?:\.\d{1,2})?\b|\b(?!20[23]\d\b)[1-9],?\d{3}(?:\.\d{1,2})?\b/i },
  // results: +120 pips, 2.4R, win rate 68%, 7W 2L
  { name: "result", re: /[+-]\s?\d+(?:\.\d+)?\s?(?:pips?|r\b|rr\b)|\bwin\s?rate\b|\b\d+\s?w\s?\d+\s?l\b|\bprofit(?:able)?\b|\buntung\b/i },
  // percentages
  { name: "percentage", re: /\b\d{1,3}(?:\.\d+)?\s?%/ },
  // offers / promos
  { name: "offer", re: /\b(?:offer|promo|discount|trial|free for|lifetime|bundle|upgrade now|join (?:pro|premium|elite)|tawaran|percuma|diskaun)\b/i },
  // testimonials / member results
  { name: "testimonial", re: /\b(?:member|client|student|subscriber|trader)\s+(?:made|earned|withdrew|profited|dapat|untung)\b|\bthanks? (?:to )?ezymap\b|\btestimon/i },
  // broker names
  { name: "broker", re: /\b(?:vantage|exness|ic ?markets|xm|fbs|octa(?:fx)?|pepperstone|fxtm|hfm|hotforex|tickmill|axi)\b/i },
];

/** Required lines per post type (plan §12 "Risk line", "Disclosure", "Results"). */
export const RISK_LINE_TYPES: readonly PostType[] = [
  "gold_map",
  "signal_card",
  "outlook",
  "scorecard",
  "news_alert",
];
export const PAST_PERFORMANCE_TYPES: readonly PostType[] = ["result_reply", "scorecard", "member_result"];

/** Risk line detector: the kit's wording in EN or BM, matched loosely. */
export const RISK_LINE_RE =
  /(?:not (?:(?:financial|investment) )?advice|education(?:al)? (?:only|purposes?)|trade at your own risk|manage your own risk|risk(?:ing)? only what you can afford|risk\s+\d+(?:\.\d+)?%\s+or\s+less|bukan nasihat (?:kewangan|pelaburan)|untuk pembelajaran|risiko (?:anda|sendiri)|prestasi lepas (?:tidak|bukan)|past (?:performance|results) (?:does|do|is) not)/i;

export const PAST_PERFORMANCE_RE =
  /past (?:performance|results) (?:does not|do not|is not|isn't) (?:guarantee|indicat(?:e|ive)|promise)|prestasi lepas (?:tidak|bukan) (?:jaminan|menjamin|menunjukkan)/i;

/** Broker disclosure line (plan §4.1 pledge: IB commission disclosed). */
export const DISCLOSURE_RE =
  /(?:ib|affiliate|partner) (?:link|commission)|we (?:may )?earn a commission|komisen|komisyen|ezymap (?:gets|earns|receives)/i;

export const BROKER_LINK_RE =
  /\b(?:vantage|exness|ic ?markets|xm|fbs|octa|pepperstone|fxtm|hfm|tickmill|axi)\b|\/start=?[a-z_]*ib|ib\s?(?:link|number|code)|open (?:an? )?account/i;

/** CTA detector: imperative + link/bot/button words. */
export const CTA_RE =
  /\b(?:join|tap|click|start|register|daftar|jom|open the bot|t\.me\/|@ezyregisterbot|dm me|link in bio|download|grab|claim)\b/gi;

export const NEEDED_RE = /\[NEEDED(?::[^\]]*)?\]/g;

/* ------------------------------------------------------------------------ */
/* Limits                                                                    */

export const CHAR_LIMITS: Record<Platform, { short: number; hard: number }> = {
  telegram: { short: 900, hard: 4096 }, // kit: under 900 unless long form; 1024 for captions
  instagram: { short: 900, hard: 2200 },
  facebook: { short: 900, hard: 63206 },
  threads: { short: 500, hard: 500 },
  youtube: { short: 900, hard: 5000 },
  tiktok: { short: 900, hard: 4000 },
  x: { short: 280, hard: 280 },
};

export const TELEGRAM_CAPTION_LIMIT = 1024;
export const META_MORE_CUT = 125; // IG shows ~125 chars before "…more"

/* ------------------------------------------------------------------------ */
/* Pure checks                                                               */

function wordHits(body: string, words: string[]): string[] {
  const text = body.toLowerCase();
  return words.filter((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
  });
}

export function bannedWords(body: string): string[] {
  return [...wordHits(body, BANNED_WORDS_EN), ...wordHits(body, BANNED_WORDS_MS)];
}

/* ------------------------------------------------------------------------ */
/* Humanizer rules (plan §17 Wave 3 item 8)                                  */
/*                                                                           */
/* AI-tell words from the webcopy humaniser: style warnings only, apart     */
/* from the blocking financial-claim checks above. A warn never stops       */
/* publishing; it tells Jack the draft reads machine-written.               */

export const HUMANIZER_WORDS_EN = [
  "delve",
  "furthermore",
  "moreover",
  "additionally",
  "in conclusion",
  "game changer",
  "game-changer",
  "unlock",
  "unleash",
  "elevate",
  "tapestry",
  "vibrant",
  "dive into",
  "fast-paced",
  "fast paced",
  "seamless",
  "cutting-edge",
  "cutting edge",
  "revolutionize",
  "revolutionise",
  "revolutionary",
  "supercharge",
  "skyrocket",
  "embark",
  "testament",
  "boast",
  "showcase",
  "unparalleled",
  "ever-evolving",
  "ever evolving",
  // 2026 refresh (research 2026-10-02): the current batch of model tells.
  "leverage",
  "robust",
  "holistic",
  "streamline",
  "harness",
  "foster",
  "realm",
  "navigate the landscape",
  "in today's fast-paced world",
  "at the forefront",
];

export const HUMANIZER_WORDS_MS = [
  "serba pantas",
  "sentiasa berubah",
  "merevolusikan",
  "merevolusi",
  "pengubah permainan",
  "permainan berubah",
  "tanpa tandingan",
  "revolusioner",
  "buka kunci",
  "melonjak",
  // 2026 refresh (research 2026-10-02).
  "penyelesaian menyeluruh",
  "inovatif",
  "memperkasakan",
  "pendekatan holistik",
  "transformasi digital",
  "di barisan hadapan",
];

export function humanizerHits(body: string): string[] {
  return [...wordHits(body, HUMANIZER_WORDS_EN), ...wordHits(body, HUMANIZER_WORDS_MS)];
}

export function neededPlaceholders(body: string): string[] {
  return body.match(NEEDED_RE) ?? [];
}

export function hasRiskLine(body: string): boolean {
  return RISK_LINE_RE.test(body);
}

export function hasPastPerformanceLine(body: string): boolean {
  return PAST_PERFORMANCE_RE.test(body);
}

export function mentionsBroker(body: string): boolean {
  return BROKER_LINK_RE.test(body);
}

export function hasDisclosure(body: string): boolean {
  return DISCLOSURE_RE.test(body);
}

export function ctaCount(body: string): number {
  // Count distinct lines carrying a CTA, not words; "Join → t.me/x" is one CTA.
  return body
    .split(/\n+/)
    .filter((line) => new RegExp(CTA_RE.source, "i").test(line)).length;
}

export function detectClaims(body: string): Array<{ kind: string; match: string }> {
  const out: Array<{ kind: string; match: string }> = [];
  for (const { name, re } of CLAIM_PATTERNS) {
    const m = re.exec(body);
    if (m) out.push({ kind: name, match: m[0].trim() });
  }
  return out;
}

/** Every number in the body that is not in Jack's input/board set. */
export function foreignNumbers(body: string, allowed: number[] | undefined): string[] {
  if (!allowed) return [];
  const set = new Set(allowed.map((n) => Number(n.toFixed(2))));
  const nums = body.match(/\b\d{3,5}(?:\.\d{1,2})?\b/g) ?? [];
  return nums.filter((raw) => {
    const n = Number(Number(raw).toFixed(2));
    // Allow years and times (2026, 08:15 already excluded by \b…\b on digits)
    if (n >= 2020 && n <= 2035 && Number.isInteger(n)) return false;
    return !set.has(n);
  });
}

/** Every price/level number and every percent in the body, years excluded. */
export function extractNumbers(body: string): number[] {
  const prices = (body.match(/\b\d{3,5}(?:\.\d{1,2})?\b/g) ?? []).map(Number);
  const pcts = (body.match(/\b\d{1,3}(?:\.\d+)?\s?%/g) ?? []).map((s) => Number(s.replace(/[%\s]/g, "")));
  const out = new Set<number>();
  for (const n of [...prices, ...pcts]) {
    if (Number.isInteger(n) && n >= 2020 && n <= 2035) continue; // a year, not a number
    out.add(n);
  }
  return [...out];
}

/**
 * Blocking number guard for AI variants (plan §17 Wave 3 item 6): no price
 * or percent that is not in Jack's raw lines. Without grounding numbers the
 * variant is refused outright.
 */
export function aiNumberGuard(body: string, allowed: number[] | undefined): Finding[] {
  if (!allowed) {
    return [{
      check: "numbers",
      severity: "blocking",
      message: "AI variants need Jack's numbers to check against",
    }];
  }
  const set = new Set(allowed.map((n) => Number(n)));
  const foreign = extractNumbers(body).filter((n) => !set.has(n));
  if (!foreign.length) return [];
  return [{
    check: "numbers",
    severity: "blocking",
    message: "AI invented numbers outside Jack's raw lines",
    evidence: foreign.map(String),
  }];
}

export function boldCount(body: string): number {
  return (body.match(/<b>|\*\*|(?<!\*)\*(?!\*)/g) ?? []).length;
}

/* ------------------------------------------------------------------------ */
/* The checklist                                                             */

export function check(v: VariantInput): CheckResult {
  const f: Finding[] = [];
  const body = v.body ?? "";

  // Numbers: no [NEEDED] left; numbers must match input/board.
  const needed = neededPlaceholders(body);
  if (needed.length) {
    f.push({ check: "numbers", severity: "blocking", message: "[NEEDED] placeholders left", evidence: needed });
  }
  const foreign = foreignNumbers(body, v.allowed_numbers);
  if (foreign.length) {
    f.push({
      check: "numbers",
      severity: "needs_approval",
      message: "numbers not in Jack's input or the board",
      evidence: foreign,
    });
  }

  // Words: financial-claim words block; humanizer tells only warn.
  const banned = bannedWords(body);
  if (banned.length) {
    f.push({ check: "words", severity: "blocking", message: "banned words present", evidence: banned });
  }
  const human = humanizerHits(body);
  if (human.length) {
    f.push({
      check: "humanizer",
      severity: "warn",
      message: "reads machine-written; prefer Jack's own phrasing",
      evidence: human,
    });
  }

  // Risk line
  if (RISK_LINE_TYPES.includes(v.post_type) && !hasRiskLine(body)) {
    f.push({ check: "risk_line", severity: "blocking", message: "risk line missing" });
  }

  // Video warning (caption-only risk line is not enough)
  if ((v.platform === "tiktok" || v.platform === "youtube") && v.video_warning_confirmed === false) {
    f.push({ check: "video_warning", severity: "blocking", message: "spoken/on-screen risk line not confirmed" });
  }

  // Instagram/Facebook: warning before the "…more" cut
  if ((v.platform === "instagram" || v.platform === "facebook") && RISK_LINE_TYPES.includes(v.post_type)) {
    const head = body.slice(0, META_MORE_CUT);
    if (!RISK_LINE_RE.test(head)) {
      f.push({ check: "meta_more_cut", severity: "blocking", message: `risk line must appear in the first ${META_MORE_CUT} characters` });
    }
  }

  // One CTA; one offer post per week
  const ctas = ctaCount(body);
  if (ctas > 1) {
    f.push({ check: "one_cta", severity: "blocking", message: `${ctas} CTAs, allowed 1` });
  }
  if (v.post_type === "offer" && (v.offers_this_week ?? 0) >= 1) {
    f.push({ check: "one_offer_per_week", severity: "blocking", message: "an offer post was already published this week" });
  }

  // Disclosure on broker mention
  if (mentionsBroker(body) && !hasDisclosure(body)) {
    f.push({ check: "disclosure", severity: "blocking", message: "broker mentioned without the commission disclosure line" });
  }

  // Results: past-performance line on result/scorecard posts
  if (PAST_PERFORMANCE_TYPES.includes(v.post_type) && !hasPastPerformanceLine(body)) {
    f.push({ check: "results", severity: "blocking", message: "past-performance line missing" });
  }

  // Member results: written permission
  if (v.post_type === "member_result" && !v.permission_recorded) {
    f.push({ check: "member_results", severity: "blocking", message: "written permission not recorded" });
  }

  // Format: char limits, bold only on key numbers
  const limits = CHAR_LIMITS[v.platform];
  const len = [...body].length;
  if (len > limits.hard) {
    f.push({ check: "format", severity: "blocking", message: `${len} characters, platform hard limit ${limits.hard}` });
  } else if (len > limits.short && !v.long_form) {
    f.push({ check: "format", severity: "warn", message: `${len} characters, over ${limits.short} for a short post` });
  }
  if (v.platform === "telegram" && boldCount(body) > 8) {
    f.push({ check: "format", severity: "warn", message: "heavy bold; the kit bolds key numbers only" });
  }

  // Language matches the planned slot
  if (v.planned_lang && v.planned_lang !== v.lang) {
    f.push({ check: "language", severity: "blocking", message: `variant is ${v.lang}, slot planned ${v.planned_lang}` });
  }

  // Claims → Jack approval (never blocking by themselves)
  const claims = detectClaims(body);
  const claimFlags = claims.map((c) => c.kind);
  if (claims.length) {
    f.push({
      check: "claims",
      severity: "needs_approval",
      message: "post carries a claim: Jack must approve",
      evidence: claims.map((c) => `${c.kind}: ${c.match}`),
    });
  }
  // These post types always need Jack regardless of what the regex saw. The
  // flag list is the mechanism, not just a label: needs_approval above and the
  // DB trigger (cardinality(claim_flags) > 0 → requires_approval) both read it,
  // so an empty list here would let an offer publish without Jack. claim_flags
  // therefore carries claim kinds AND these five post types — do not tidy it
  // into one vocabulary without replacing the trigger.
  if (["offer", "signal_card", "gold_map", "member_result", "scorecard"].includes(v.post_type)) {
    if (!claimFlags.includes(v.post_type)) claimFlags.push(v.post_type);
  }

  return {
    ok: !f.some((x) => x.severity === "blocking"),
    needs_approval: claimFlags.length > 0 || f.some((x) => x.severity === "needs_approval"),
    findings: f,
    claim_flags: Array.from(new Set(claimFlags)),
  };
}

/**
 * A delayed first comment is a reply under a post that already carries the
 * risk line, so the risk-line rules do not apply to it. Every other check
 * (banned claims, [NEEDED], numbers, format) still does.
 */
export function checkComment(text: string, postType: PostType, lang: "en" | "ms"): CheckResult {
  const r = check({ post_type: postType, platform: "telegram", lang, body: text } as VariantInput);
  const findings = r.findings.filter((f) => f.check !== "risk_line" && f.check !== "meta_more_cut");
  return { ...r, findings, ok: !findings.some((f) => f.severity === "blocking") };
}

/**
 * A worker rewrite (soften, BM, shorter) is generated text: it may only use
 * numbers that were already in the body it replaces. Adds the blocking AI
 * number guard to the checklist result.
 */
export function withRewriteGuard(checked: CheckResult, oldBody: string, newBody: string): CheckResult {
  const guard = aiNumberGuard(newBody, extractNumbers(oldBody));
  if (!guard.length) return checked;
  const findings = [...checked.findings, ...guard];
  return { ...checked, findings, ok: false };
}
