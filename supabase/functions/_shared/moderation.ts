/**
 * Community moderation for the discussion group (plan §5, §9.I.72-75).
 *
 * Pure rules over data: the seeded mod_rules rows go in, a verdict comes out,
 * and tg-webhook does the Telegram calls. No AI on member text (plan §6): only
 * these pattern rules ever read it, and only an excerpt is stored.
 *
 *   keyword        scam phrases, EN and BM, substring match, any case
 *   link_block     a member younger than N hours cannot post links or handles
 *                  (our own domains pass)
 *   flood          more than max_msgs in window_s: a short mute
 *   impersonation  a name that borrows Jack's or EzyMap's, lookalike letters
 *                  included: flagged for Jack, nothing deleted
 *   cas / captcha  the join-request flow (tg-webhook onJoinRequest)
 *   repeat_question  a question asked twice is proposed for the FAQ sheet
 *
 * `warn_mute_ban` is a ladder: the first strike warns, the second mutes for a
 * day, the third bans. Strikes are the member's earlier moderation events.
 */

export interface ModRule {
  key: string;
  kind: string;
  patterns: string[];
  params: Record<string, unknown>;
  action: string;
  enabled: boolean;
}

export type Action = "flag" | "delete" | "warn" | "mute" | "ban";

export interface MsgCtx {
  text: string;
  /** Telegram marked part of the message as a link, text link or mention. */
  hasLinkEntity: boolean;
  from: { id: number; first_name?: string; last_name?: string; username?: string };
  /** When this member joined the chat (ms), or null when we never saw them join. */
  joinedAt: number | null;
  /** Messages from this member inside the flood window, this one included. */
  recent: number;
  isAdmin: boolean;
  now: number;
}

export interface Hit { rule: string; kind: string; action: Action; muteSeconds: number }
export interface Verdict { hits: Hit[]; final: Action | null; deleteMessage: boolean; muteSeconds: number }

const RANK: Record<Action, number> = { flag: 1, delete: 2, warn: 3, mute: 4, ban: 5 };
const DAY_S = 86_400;

export function ladder(strikes: number): { action: "warn" | "mute" | "ban"; muteSeconds: number } {
  if (strikes <= 0) return { action: "warn", muteSeconds: 0 };
  if (strikes === 1) return { action: "mute", muteSeconds: DAY_S };
  return { action: "ban", muteSeconds: 0 };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Letters that pass for Latin ones: Cyrillic and a few digits.
const LOOKALIKE: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "т": "t",
  "0": "o", "1": "l", "3": "e", "5": "s", "$": "s", "@": "a",
};

function plain(s: string): string {
  return Array.from(s.toLowerCase()).map((c) => LOOKALIKE[c] ?? c).join("");
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function impersonates(from: MsgCtx["from"], protectedNames: string[]): boolean {
  const display = `${from.first_name ?? ""} ${from.last_name ?? ""}`.trim();
  const sources = [display, from.username ?? ""].filter(Boolean).map(plain);
  for (const raw of protectedNames) {
    const p = plain(raw).replace(/[^a-z0-9]/g, "");
    if (!p) continue;
    for (const src of sources) {
      const compact = src.replace(/[^a-z0-9]/g, "");
      const tokens = src.split(/[^a-z]+/).filter(Boolean);
      if (compact === p || tokens.includes(p)) return true;
      if (p.length >= 5 && (compact.includes(p) || levenshtein(compact, p) <= 1 || tokens.some((t) => levenshtein(t, p) <= 1))) return true;
    }
  }
  return false;
}

function resolve(rule: ModRule, strikes: number): { action: Action; muteSeconds: number } {
  if (rule.action === "warn_mute_ban") return ladder(strikes);
  const action = rule.action as Action;
  const mins = Number(rule.params.mute_minutes);
  return { action, muteSeconds: action === "mute" ? (Number.isFinite(mins) && mins > 0 ? mins * 60 : 3600) : 0 };
}

export function evaluate(ctx: MsgCtx, rules: ModRule[], strikes: number): Verdict {
  const none: Verdict = { hits: [], final: null, deleteMessage: false, muteSeconds: 0 };
  if (ctx.isAdmin) return none;
  const hits: Hit[] = [];
  const lower = ctx.text.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    let hit = false;
    if (rule.kind === "keyword") {
      hit = rule.patterns.some((p) => (rule.params.regex ? new RegExp(p, "i").test(ctx.text) : lower.includes(p.toLowerCase())));
    } else if (rule.kind === "link_block") {
      const hours = Number(rule.params.new_member_hours ?? 24);
      const isNew = ctx.joinedAt !== null && ctx.now - ctx.joinedAt < hours * 3_600_000;
      if (isNew) {
        const allow = (rule.params.allow_domains as string[] | undefined) ?? [];
        let rest = ctx.text;
        for (const d of allow) rest = rest.replace(new RegExp(`${escapeRe(d)}(?![\\w-])`, "gi"), " ");
        const viaText = rule.patterns.some((p) => new RegExp(p, "i").test(rest));
        const viaEntity = ctx.hasLinkEntity && !allow.some((d) => lower.includes(d.toLowerCase()));
        hit = viaText || viaEntity;
      }
    } else if (rule.kind === "flood") {
      hit = ctx.recent > Number(rule.params.max_msgs ?? 5);
    } else if (rule.kind === "impersonation") {
      hit = impersonates(ctx.from, rule.patterns);
    }
    if (hit) hits.push({ rule: rule.key, kind: rule.kind, ...resolve(rule, strikes) });
  }
  if (!hits.length) return none;

  const strongest = hits.reduce((a, b) => (RANK[b.action] > RANK[a.action] ? b : a));
  return {
    hits,
    final: strongest.action,
    deleteMessage: hits.some((h) => h.action !== "flag"),
    muteSeconds: strongest.action === "mute" ? strongest.muteSeconds : 0,
  };
}

/** CAS (cas.chat) answers {"ok":true,...} for an account on its ban list. Anything else means not banned. */
export function casBanned(json: unknown): boolean {
  return typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true;
}

/** Ask CAS about a user. Null when CAS cannot be reached: an outage never blocks a member. */
export async function casLookup(userId: number, f: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const res = await f(`https://api.cas.chat/check?user_id=${userId}`, { signal: AbortSignal.timeout(4000) });
    return casBanned(await res.json());
  } catch {
    return null;
  }
}

/* ------------------------------ repeat questions ------------------------------ */

const OPENERS =
  /^(?:how|what|why|when|where|who|which|can|could|should|would|is|are|do|does|did|will|boleh|bila|berapa|apa|apakah|macam mana|bagaimana|kenapa|mengapa|siapa|mana|adakah)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.includes("?") || OPENERS.test(t);
}

const STOP = new Set((
  "a an the i my me you your we our do does did is are was were be to of in on at for and or how what why when where who which can " +
  "could should would will it this that with from about boleh tak saya aku kita awak anda macam mana apa yang di ke dan untuk ni tu lah kah " +
  "ada ke dengan nak"
).split(" "));

/** A question as its sorted set of meaningful words, so wording and order do not matter. */
export function normalizeQuestion(text: string): string {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)].sort().join(" ");
}

export function similarity(a: string, b: string): number {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / (x.size + y.size - inter);
}

/** The earlier question this one repeats, if any. */
export function matchRepeat<T extends { detail: string }>(seen: T[], text: string, min: number): T | null {
  const key = normalizeQuestion(text);
  let best: T | null = null;
  let bestScore = 0;
  for (const s of seen) {
    const score = similarity(s.detail, key);
    if (score >= min && score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}
