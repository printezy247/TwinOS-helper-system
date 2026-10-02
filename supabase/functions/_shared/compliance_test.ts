import { assert, assertEquals } from "std/assert/mod.ts";
import {
  checkComment,
  aiNumberGuard, bannedWords, check, ctaCount, detectClaims, extractNumbers, hasDisclosure, hasPastPerformanceLine,
  hasRiskLine, humanizerHits, neededPlaceholders,
} from "./compliance.ts";

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

Deno.test("levels with a thousands comma are claims; a year in a date line is not", () => {
  const level = (s: string) => detectClaims(s).some((c) => c.kind === "level");
  assert(level("Wait for the price reaction at 4,613 zone."));
  assert(level("It can possibly DROP till 4,500 or 4,602."));
  assert(level("Gold held 4590"));
  assert(level("TP 4,604.50"));
  assert(!level("EZYMAP | 01 Oct 2026 | Jack's Plan"));
  assert(!level("Hold > S1, look for continuation"));
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

// The locked brand lines are quoted verbatim in posts, so the detectors must
// recognise every one of them (a post ending in the kit's own risk line was
// being blocked as "risk line missing").
Deno.test("locked brand lines satisfy the detectors", () => {
  for (const line of [
    "Map only, not advice. Manage your own risk.",
    "Risk 1% or less.",
    "Education only, not financial advice.",
    "Ini mapping, bukan nasihat kewangan.",
  ]) assertEquals(hasRiskLine(line), true, line);
  for (const line of [
    "Past performance is not indicative of future results. We do not publish win-rate or pip totals that cannot be independently verified.",
    "Prestasi lepas tidak menunjukkan hasil masa depan. Kami tidak menerbitkan kadar kemenangan atau jumlah pip yang tidak dapat disahkan secara bebas.",
  ]) assertEquals(hasPastPerformanceLine(line), true, line);
  assertEquals(hasDisclosure("Honest note: we earn a commission when you trade through the link."), true);
});

Deno.test("humanizer tells are warnings in EN and MS, never blocks", () => {
  assert(humanizerHits("Let's delve into the gold tapestry, furthermore it is seamless").length >= 2);
  assert(humanizerHits("Dalam dunia yang serba pantas, jom merevolusikan cara trade").length >= 1);
  assertEquals(humanizerHits("Gold held the 4590 zone. Risk 1% or less."), []);
});

Deno.test("humanizer: the 2026 tell words are on the list too", () => {
  assert(humanizerHits("Leverage our robust, cutting-edge solution to unlock seamless growth").length >= 2);
  assert(humanizerHits("Dengan penyelesaian menyeluruh kami yang inovatif, jom memperkasakan trade anda").length >= 2);
  const r = check({
    post_type: "lesson", platform: "telegram", lang: "en",
    body: "Let's delve into a seamless setup. Furthermore, keep risk small.",
  });
  const f = r.findings.find((x) => x.check === "humanizer");
  assert(f && f.severity === "warn", "humanizer hits must be warn-level");
  assert(r.ok, "warn-only findings must not block");
});

Deno.test("claim words still block while humanizer words only warn", () => {
  const r = check({
    post_type: "lesson", platform: "telegram", lang: "en",
    body: "This guaranteed win will delve into seamless profits.",
  });
  assert(r.findings.some((f) => f.check === "words" && f.severity === "blocking"));
  assert(r.findings.some((f) => f.check === "humanizer" && f.severity === "warn"));
  assert(!r.ok);
});

Deno.test("AI number guard: prices and percents outside Jack's lines block", () => {
  assertEquals(extractNumbers("Gold held 4590, risk 68% of nothing"), [4590, 68]);
  const ok = aiNumberGuard("Watch 4590, risk 1% or less.", [4590, 1]);
  assertEquals(ok, []);
  const invented = aiNumberGuard("TP 4604, win rate 68%.", [4590]);
  assertEquals(invented.length, 1);
  assertEquals(invented[0].severity, "blocking");
  const noGround = aiNumberGuard("Watch 4590.", undefined);
  assert(noGround.some((f) => f.severity === "blocking"), "no grounding, no AI numbers");
});

Deno.test("the everyday risk lines are recognised: not financial advice, not investment advice, not advice", () => {
  for (const line of [
    "Not financial advice.", "Map only, not financial advice.", "This is not investment advice.", "Not advice, just a map.",
    "Bukan nasihat kewangan.",
  ]) assert(hasRiskLine(line), line);
  assert(!hasRiskLine("A note about advice for beginners."));
});

// Review 3 Oct: a delayed first comment is a reply under a post that already
// carries the risk line. Checking it as the post's type blocked every comment.
Deno.test("checkComment: a short comment under a map passes without its own risk line", () => {
  const r = checkComment("Full levels in the pinned post.", "gold_map", "en");
  assert(r.ok, JSON.stringify(r.findings));
});

Deno.test("checkComment: banned claims and placeholders still block a comment", () => {
  assert(!checkComment("This is a guaranteed win", "gold_map", "en").ok);
  assert(!checkComment("Entry [NEEDED:entry]", "gold_map", "en").ok);
});
