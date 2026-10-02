import { assert, assertEquals } from "std/assert/mod.ts";
import { adaptCaption, FANOUT_DEFAULT, type FanResult, fanoutSummary, isKit, isKitPlatform, validatePlatform } from "./platforms.ts";
import { hasRiskLine } from "./compliance.ts";

const RISK = "Map only, not financial advice.";

Deno.test("adaptCaption: Telegram *bold* is plain text elsewhere, and kept on Telegram", () => {
  const body = `*GOLD MAP | Fri, 2 Oct*\n\nHold above 4,590.\n\n${RISK}`;
  assert(!adaptCaption(body, "instagram").body.includes("*"));
  assert(adaptCaption(body, "instagram").body.startsWith("GOLD MAP | Fri, 2 Oct"));
  assertEquals(adaptCaption(body, "telegram").body, body);
});

Deno.test("adaptCaption: a risk line buried past the 'more' cut moves to the front on Instagram", () => {
  const body = `Intro line.\n\n${"Some long explanation of the setup. ".repeat(8)}\n\n${RISK}`;
  const out = adaptCaption(body, "instagram");
  assert(hasRiskLine(out.body.slice(0, 125)), "risk line must sit in the first 125 characters");
  assert(out.notes.some((n) => /risk line/i.test(n)));
});

Deno.test("adaptCaption: X is cut to 280 and still carries the risk line", () => {
  const body = `${"Long thoughts about the gold map today. ".repeat(20)}\n\n${RISK}`;
  const out = adaptCaption(body, "x");
  assert(Array.from(out.body).length <= 280);
  assert(hasRiskLine(out.body));
  assert(out.body.includes("…"));
});

Deno.test("adaptCaption: Threads is cut to 500", () => {
  const body = `${"word ".repeat(300)}\n${RISK}`;
  assert(Array.from(adaptCaption(body, "threads").body).length <= 500);
});

Deno.test("adaptCaption: Instagram keeps at most 30 hashtags, dropping the last ones", () => {
  const tags = Array.from({ length: 35 }, (_, i) => `#tag${i}`).join(" ");
  const out = adaptCaption(`${RISK}\n${tags}`, "instagram").body;
  assertEquals((out.match(/#\w+/g) ?? []).length, 30);
  assert(out.includes("#tag0") && !out.includes("#tag34"));
});

Deno.test("adaptCaption: Threads keeps one hashtag", () => {
  assertEquals((adaptCaption(`${RISK} #gold #xauusd #forex`, "threads").body.match(/#\w+/g) ?? []).length, 1);
});

Deno.test("adaptCaption: a short caption comes back untouched apart from the bold marks", () => {
  const out = adaptCaption(`Gold held the zone. ${RISK}`, "x");
  assertEquals(out.body, `Gold held the zone. ${RISK}`);
  assertEquals(out.notes, []);
});

Deno.test("validatePlatform: a reel over its length or size is blocked, an unknown length only warned", () => {
  const long = validatePlatform({ platform: "facebook", body: "ok", media: { kind: "video", duration_s: 95, bytes: 10e6 } });
  assert(long.some((f) => f.severity === "blocking" && /90/.test(f.message)));
  const big = validatePlatform({ platform: "instagram", body: "ok", media: { kind: "video", duration_s: 30, bytes: 400e6 } });
  assert(big.some((f) => f.severity === "blocking" && /MB/.test(f.message)));
  const unknown = validatePlatform({ platform: "instagram", body: "ok", media: { kind: "video" } });
  assert(unknown.every((f) => f.severity === "warn"));
  assert(unknown.length > 0);
  assertEquals(validatePlatform({ platform: "instagram", body: "ok", media: { kind: "video", duration_s: 30, bytes: 20e6 } }), []);
});

Deno.test("validatePlatform: Instagram and Facebook cannot post without media; Threads and X can", () => {
  assert(validatePlatform({ platform: "instagram", body: "x" }).some((f) => f.severity === "blocking"));
  assert(validatePlatform({ platform: "facebook", body: "x" }).some((f) => f.severity === "blocking"));
  assertEquals(validatePlatform({ platform: "threads", body: "x" }), []);
  assertEquals(validatePlatform({ platform: "x", body: "x" }), []);
});

Deno.test("validatePlatform: too many hashtags and an over-long caption are called out", () => {
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
  assert(validatePlatform({ platform: "instagram", body: tags, media: { kind: "photo" } }).some((f) => /hashtag/i.test(f.message)));
  assert(validatePlatform({ platform: "x", body: "y".repeat(281) }).some((f) => f.severity === "blocking" && /280/.test(f.message)));
});

Deno.test("publish kits: TikTok, YouTube and X are copy-paste posts; Instagram, Facebook, Threads publish", () => {
  for (const p of ["tiktok", "youtube", "x"]) assertEquals(isKitPlatform(p), true);
  for (const p of ["telegram", "instagram", "facebook", "threads"]) assertEquals(isKitPlatform(p), false);
  assertEquals(isKit({ kit: true, platform: "tiktok" }), true);
  assertEquals(isKit({ via: "desk" }), false);
  assertEquals(isKit(null), false);
});

Deno.test("fan-out goes to every platform except Telegram, which is the master", () => {
  assert(!FANOUT_DEFAULT.includes("telegram" as never));
  assertEquals([...FANOUT_DEFAULT].sort(), ["facebook", "instagram", "threads", "tiktok", "x", "youtube"]);
});

Deno.test("fanoutSummary: providers say where to approve, kits carry the caption to copy, blocks say why", () => {
  const results: FanResult[] = [
    { platform: "instagram", content_id: "a", kit: false, body: "ig", notes: ["removed Telegram bold marks"], findings: [], complianceOk: true },
    { platform: "facebook", content_id: "b", kit: false, body: "fb", notes: [], findings: [{ check: "media", severity: "blocking", message: "facebook needs a video" }], complianceOk: true },
    { platform: "tiktok", content_id: "c", kit: true, body: "Gold <zone> held", notes: [], findings: [], complianceOk: true },
    { platform: "x", content_id: "d", kit: true, body: "x", notes: [], findings: [], complianceOk: false },
  ];
  const text = fanoutSummary("abcd1234", results);
  assert(text.includes("abcd1234"));
  assert(/Instagram[^\n]*approve/i.test(text));
  assert(text.includes("removed Telegram bold marks"));
  assert(/Facebook[^\n]*facebook needs a video/i.test(text));
  assert(text.includes("<pre>Gold &lt;zone&gt; held</pre>"));
  assert(/X[^\n]*(blocked|compliance)/i.test(text), "a kit that fails the checks is not offered for copying");
  assert(!text.includes("<pre>x</pre>"));
});
