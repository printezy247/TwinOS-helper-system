import { assert, assertEquals } from "std/assert/mod.ts";
import { renderScriptKit, scriptKit, SPOKEN_RISK_EN, SPOKEN_RISK_MS } from "./kits.ts";

// Wave 3 item 7: TikTok / YouTube script kits with the risk line spoken.

Deno.test("a kit opens with the hook, beats fit a 30-60 s short, risk is spoken", () => {
  const kit = scriptKit({
    platform: "tiktok", lang: "en", hook: "Stop copying signals until you know this.",
    topic: "lot size", cta: "Follow for tomorrow's map.",
  });
  assert(kit.beats[0].includes("Stop copying signals"), JSON.stringify(kit.beats));
  assert(kit.beats.length >= 4 && kit.beats.length <= 6, JSON.stringify(kit.beats));
  assert(kit.spoken_warning.includes("risk"), kit.spoken_warning);
  assert(kit.caption.includes("Stop copying signals"), kit.caption);
  assert(kit.caption.includes("Follow for tomorrow's map"), kit.caption);
  assert(kit.hashtags.length >= 3 && kit.hashtags.length <= 5, JSON.stringify(kit.hashtags));
});

Deno.test("the BM kit speaks the risk line in Malay", () => {
  const kit = scriptKit({
    platform: "youtube", lang: "ms", hook: "Ni sebab SL korang asyik kena.",
    topic: "stop loss", cta: "Follow untuk map esok.",
  });
  assertEquals(kit.spoken_warning, SPOKEN_RISK_MS);
  assert(kit.caption.includes("Ni sebab SL"), kit.caption);
});

Deno.test("the EN spoken risk line is a fixed brand-safe sentence", () => {
  assert(SPOKEN_RISK_EN.includes("Not financial advice"), SPOKEN_RISK_EN);
  const text = renderScriptKit(scriptKit({
    platform: "tiktok", lang: "en", hook: "H", topic: "T", cta: "C",
  }));
  assert(text.includes(SPOKEN_RISK_EN), text);
  assert(text.length <= 2000, String(text.length));
});
