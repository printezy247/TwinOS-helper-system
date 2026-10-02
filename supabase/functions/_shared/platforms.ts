/**
 * One master post, many platforms (plan §6, §9.F.46-49).
 *
 *   adaptCaption     the master caption made fit for one platform: Telegram's
 *                    *bold* marks removed where they do not render, the risk
 *                    line kept in front of any cut, hashtags and length capped
 *   validatePlatform what the platform itself refuses: media it needs, video
 *                    length and size, hashtag count, caption length
 *   isKit            TikTok, YouTube and X are copy-paste "publish kits", not providers
 *
 * The limits below are deliberately conservative (the lower of what the apps
 * and the APIs state) so a post that passes here is accepted everywhere. They
 * are policy that platforms change: one table, one place to correct.
 */
import { CHAR_LIMITS, META_MORE_CUT, type Platform, RISK_LINE_RE } from "./compliance.ts";

export interface VideoLimit { maxS: number; maxMB: number }
export interface PlatformSpec {
  /** Copy-paste post, never published by a provider. */
  kit: boolean;
  /** Most hashtags the platform accepts; null = no stated limit. */
  hashtagsMax: number | null;
  /** The platform cannot post without media of this kind. */
  needs: "photo-or-video" | "video" | null;
  video: VideoLimit | null;
}

export const SPECS: Record<Platform, PlatformSpec> = {
  telegram: { kit: false, hashtagsMax: null, needs: null, video: null },
  instagram: { kit: false, hashtagsMax: 30, needs: "photo-or-video", video: { maxS: 90, maxMB: 300 } },
  facebook: { kit: false, hashtagsMax: null, needs: "video", video: { maxS: 90, maxMB: 1000 } },
  threads: { kit: false, hashtagsMax: 1, needs: null, video: { maxS: 300, maxMB: 1000 } },
  youtube: { kit: true, hashtagsMax: 15, needs: "video", video: { maxS: 180, maxMB: 1000 } },
  tiktok: { kit: true, hashtagsMax: null, needs: "video", video: { maxS: 600, maxMB: 500 } },
  x: { kit: true, hashtagsMax: null, needs: null, video: { maxS: 140, maxMB: 512 } },
};

/** Fan-out targets: everything except Telegram, which is the master. */
export const FANOUT_DEFAULT = ["instagram", "facebook", "threads", "tiktok", "youtube", "x"] as const;

export function isKitPlatform(p: string): boolean {
  return (SPECS as Record<string, PlatformSpec | undefined>)[p]?.kit === true;
}

/** A content item made by fan-out for a kit platform: nothing to approve or publish, only to copy. */
export function isKit(source: Record<string, unknown> | null | undefined): boolean {
  return !!source && source.kit === true;
}

/** A kit is never approved or rescheduled (nothing publishes it), but Jack can still reject it off the Desk. */
export function kitRefuses(source: Record<string, unknown> | null | undefined, decision: string): boolean {
  return isKit(source) && decision !== "reject";
}

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const chars = (s: string) => Array.from(s);

function capHashtags(text: string, max: number): { text: string; dropped: number } {
  const hits = [...text.matchAll(HASHTAG)];
  if (hits.length <= max) return { text, dropped: 0 };
  let out = text;
  // remove from the back so earlier offsets stay valid
  for (const m of hits.slice(max).reverse()) out = out.slice(0, m.index!) + out.slice(m.index! + m[0].length);
  return { text: out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trimEnd(), dropped: hits.length - max };
}

function riskToFront(text: string): { text: string; moved: boolean } {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => RISK_LINE_RE.test(l));
  if (at <= 0) return { text, moved: false };
  const [risk] = lines.splice(at, 1);
  return { text: `${risk}\n\n${lines.join("\n").replace(/^\n+/, "")}`, moved: true };
}

export function adaptCaption(body: string, platform: Platform): { body: string; notes: string[] } {
  const notes: string[] = [];
  const spec = SPECS[platform];
  let text = body;

  if (platform !== "telegram") {
    const plain = text.replace(/\*([^*\n]+)\*/g, "$1");
    if (plain !== text) notes.push("removed Telegram bold marks");
    text = plain;
  }

  const hard = CHAR_LIMITS[platform].hard;
  const tooLong = chars(text).length > hard;
  const metaCut = (platform === "instagram" || platform === "facebook") && !RISK_LINE_RE.test(text.slice(0, META_MORE_CUT));
  if (tooLong || metaCut) {
    const moved = riskToFront(text);
    if (moved.moved) {
      text = moved.text;
      notes.push(`moved the risk line to the front (${tooLong ? "the cut would drop it" : `${platform} hides everything after ~${META_MORE_CUT} characters`})`);
    }
  }

  if (spec.hashtagsMax !== null) {
    const capped = capHashtags(text, spec.hashtagsMax);
    if (capped.dropped) notes.push(`kept ${spec.hashtagsMax} hashtag(s), dropped ${capped.dropped}`);
    text = capped.text;
  }

  if (chars(text).length > hard) {
    const cut = chars(text).slice(0, hard - 1).join("");
    const atSpace = cut.lastIndexOf(" ");
    text = `${(atSpace > hard * 0.6 ? cut.slice(0, atSpace) : cut).trimEnd()}…`;
    notes.push(`cut to ${hard} characters`);
  }
  return { body: text, notes };
}

export interface PlatformFinding { check: string; severity: "blocking" | "warn"; message: string }

export function validatePlatform(p: {
  platform: Platform;
  body: string;
  media?: { kind: "photo" | "video"; duration_s?: number | null; bytes?: number | null };
}): PlatformFinding[] {
  const spec = SPECS[p.platform];
  const out: PlatformFinding[] = [];
  const hard = CHAR_LIMITS[p.platform].hard;
  const n = chars(p.body).length;
  if (n > hard) out.push({ check: "length", severity: "blocking", message: `caption is ${n} characters, the limit is ${hard}` });

  const tags = (p.body.match(HASHTAG) ?? []).length;
  if (spec.hashtagsMax !== null && tags > spec.hashtagsMax) {
    out.push({ check: "hashtags", severity: "blocking", message: `${tags} hashtags, the platform accepts ${spec.hashtagsMax}` });
  }

  const m = p.media;
  if (spec.needs === "photo-or-video" && !m) {
    out.push({ check: "media", severity: "blocking", message: `${p.platform} needs a photo or a video` });
  }
  if (spec.needs === "video" && (!m || m.kind !== "video")) {
    out.push({ check: "media", severity: "blocking", message: `${p.platform} needs a video` });
  }
  if (m?.kind === "video" && spec.video) {
    if (m.duration_s == null) out.push({ check: "duration", severity: "warn", message: "video length unknown; check it is under " + spec.video.maxS + " s" });
    else if (m.duration_s > spec.video.maxS) {
      out.push({ check: "duration", severity: "blocking", message: `video is ${Math.round(m.duration_s)} s, the limit is ${spec.video.maxS} s` });
    }
    if (m.bytes == null) out.push({ check: "size", severity: "warn", message: "video size unknown; check it is under " + spec.video.maxMB + " MB" });
    else if (m.bytes / 1e6 > spec.video.maxMB) {
      out.push({ check: "size", severity: "blocking", message: `video is ${Math.round(m.bytes / 1e6)} MB, the limit is ${spec.video.maxMB} MB` });
    }
  }
  return out;
}

export interface FanResult {
  platform: Platform;
  content_id: string;
  kit: boolean;
  body: string;
  notes: string[];
  findings: PlatformFinding[];
  /** The compliance engine's verdict on the adapted caption. */
  complianceOk: boolean;
  /** TikTok / YouTube shooting script (Wave 3 item 7), rendered for the Desk. */
  script_kit?: string | null;
}

const NAMES: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", x: "X", telegram: "Telegram",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Desk message after a fan-out: where each platform stands, and the captions to copy for the kits. */
export function fanoutSummary(masterShort: string, results: FanResult[]): string {
  const lines = [`<b>Fan-out</b> · <code>#${esc(masterShort)}</code>`, ""];
  const kits: string[] = [];
  for (const r of results) {
    const name = NAMES[r.platform] ?? r.platform;
    const blocking = r.findings.filter((f) => f.severity === "blocking").map((f) => f.message);
    const note = r.notes.length ? ` (${r.notes.map(esc).join("; ")})` : "";
    if (!r.complianceOk) {
      lines.push(`• ${name} — blocked by the compliance check, edit it in the dashboard${note}`);
    } else if (blocking.length) {
      lines.push(`• ${name} — ⚠️ ${blocking.map(esc).join("; ")}${note}`);
    } else if (r.kit) {
      lines.push(`• ${name} — caption below, post it by hand${note}`);
      kits.push(`<b>${name}</b>\n<pre>${esc(r.body)}</pre>`);
      if (r.script_kit) kits.push(`<b>${name} script</b>\n<pre>${esc(r.script_kit)}</pre>`);
    } else {
      lines.push(`• ${name} — ready to approve in the dashboard${note}`);
    }
  }
  return [...lines, ...(kits.length ? ["", ...kits] : [])].join("\n").slice(0, 4096);
}
