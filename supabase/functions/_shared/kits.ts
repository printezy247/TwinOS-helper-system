/**
 * TikTok / YouTube script kits (plan §17 Wave 3 item 7): a 30–60 s shooting
 * script from a hook-bank line, one topic, one CTA and the risk line SPOKEN
 * in the first five seconds (plan §12: a caption-only warning is not enough
 * for video). No AI: every word comes from the hook/CTA libraries or Jack.
 */

export type KitPlatform = "tiktok" | "youtube";
export type KitLang = "en" | "ms";

export interface ScriptKitInput {
  platform: KitPlatform;
  lang: KitLang;
  hook: string;
  topic: string;
  cta: string;
}

export interface ScriptKit {
  platform: KitPlatform;
  lang: KitLang;
  hook_line: string;
  beats: string[];
  spoken_warning: string;
  caption: string;
  hashtags: string[];
}

/** Fixed brand-safe spoken risk lines: Jack says one of these on camera. */
export const SPOKEN_RISK_EN = "Say it in the first five seconds: Not financial advice, risk 1% or less.";
export const SPOKEN_RISK_MS = "Cakap dalam lima saat pertama: Bukan nasihat kewangan, risiko 1% atau kurang.";

const KIT_HASHTAGS: Record<KitPlatform, Record<KitLang, string[]>> = {
  tiktok: {
    en: ["#GoldMap", "#XAUUSD", "#GoldTrading", "#EzyMap"],
    ms: ["#GoldMap", "#Emas", "#TradingMalaysia", "#EzyMap"],
  },
  youtube: {
    en: ["#GoldMap", "#XAUUSD", "#EzyMap"],
    ms: ["#GoldMap", "#Emas", "#EzyMap"],
  },
};

export function scriptKit(input: ScriptKitInput): ScriptKit {
  const en = input.lang === "en";
  const beats = [
    `0-3 s hook, on screen + spoken: ${input.hook}`,
    `one chart moment on ${input.topic}: show, don't tell`,
    `the rule in one line a beginner can repeat`,
    `risk line spoken: ${en ? SPOKEN_RISK_EN : SPOKEN_RISK_MS}`,
    `close: ${input.cta}`,
  ];
  const hashtags = KIT_HASHTAGS[input.platform][input.lang];
  return {
    platform: input.platform,
    lang: input.lang,
    hook_line: input.hook,
    beats,
    spoken_warning: en ? SPOKEN_RISK_EN : SPOKEN_RISK_MS,
    caption: `${input.hook}\n${input.cta} ${hashtags.join(" ")}`,
    hashtags,
  };
}

/** Compact Desk rendering of a kit (kept under ~600 chars for the fan-out message). */
export function renderScriptKit(kit: ScriptKit): string {
  const title = kit.platform === "tiktok" ? "TikTok script" : "YouTube script";
  return [`${title} (say the risk line):`, ...kit.beats.map((b, i) => `${i + 1}. ${b}`)].join("\n").slice(0, 2000);
}
