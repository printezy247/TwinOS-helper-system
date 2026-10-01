import { assert, assertEquals } from "std/assert/mod.ts";
import { bannedWords, check, ctaCount, detectClaims, neededPlaceholders } from "./compliance.ts";

const RISK = "Not financial advice. Education only. Trade at your own risk.";

Deno.test("banned words EN and MS", () => {
  assertEquals(bannedWords("This is a guaranteed win"), ["guaranteed"]);
  assertEquals(bannedWords("Jom, pasti untung hari ni"), ["pasti untung"]);
  assertEquals(bannedWords("Gold held the 4590 zone"), []);
});

Deno.test("[NEEDED] blocks", () => {
  assertEquals(neededPlaceholders("Entry [NEEDED:entry] SL [NEEDED]").length, 2);
  const r = check({ post_type: "gold_map", platform: "telegram", lang: "en", body: `[NEEDED] ${RISK}` });
  assert(!r.ok);
  assert(r.findings.some((f) => f.check === "numbers" && f.severity === "blocking"));
});

Deno.test("risk line required on maps and signals", () => {
  const no = check({ post_type: "signal_card", platform: "telegram", lang: "en", body: "XAUUSD buy 4590" });
  assert(no.findings.some((f) => f.check === "risk_line"));
  const yes = check({ post_type: "signal_card", platform: "telegram", lang: "en", body: `XAUUSD buy 4590\n${RISK}` });
  assert(!yes.findings.some((f) => f.check === "risk_line"));
});

Deno.test("one CTA", () => {
  assertEquals(ctaCount("Join the channel: t.me/x\nTap the bot @EzyRegisterBot"), 2);
  const r = check({ post_type: "lesson", platform: "telegram", lang: "en", body: "Join here t.me/x\nTap @EzyRegisterBot too" });
  assert(r.findings.some((f) => f.check === "one_cta"));
});

Deno.test("broker mention needs disclosure", () => {
  const r = check({ post_type: "offer", platform: "telegram", lang: "en", body: "Open a Vantage account today" });
  assert(r.findings.some((f) => f.check === "disclosure"));
  const ok = check({ post_type: "offer", platform: "telegram", lang: "en", body: "Open a Vantage account today. EzyMap earns a commission via the IB link." });
  assert(!ok.findings.some((f) => f.check === "disclosure"));
});

Deno.test("claim detector flags prices, levels, percentages, results, brokers", () => {
  const kinds = detectClaims("Pro is $29/mo. TP1 4604 hit, +120 pips, win rate 68%. Vantage.").map((c) => c.kind);
  for (const k of ["price", "level", "result", "percentage", "broker"]) assert(kinds.includes(k), k);
});

Deno.test("char limit: threads 500 hard", () => {
  const r = check({ post_type: "lesson", platform: "threads", lang: "en", body: "x".repeat(600) });
  assert(r.findings.some((f) => f.check === "format" && f.severity === "blocking"));
});

Deno.test("numbers outside the board flag approval", () => {
  const r = check({ post_type: "gold_map", platform: "telegram", lang: "en", body: `Watch 4590 and 4612\n${RISK}`, allowed_numbers: [4590] });
  const f = r.findings.find((x) => x.check === "numbers");
  assert(f && f.evidence?.includes("4612"));
});
