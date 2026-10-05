import { assert, assertEquals, assertThrows } from "std/assert/mod.ts";
import {
  buildBrief, coreTerms, csiRow, demandScore, parseSuggest, personaTerms, pickIdeas, queryVariants, topicRisk,
} from "./research.ts";

Deno.test("parseSuggest: the suggestion list out of Google's autocomplete answer", () => {
  assertEquals(parseSuggest(["how to map", ["how to map gold", "how to map forex", "how to map gold"]]), ["how to map gold", "how to map forex"]);
  assertEquals(parseSuggest(["x", []]), []);
  assertEquals(parseSuggest(null), []);
  assertEquals(parseSuggest({ nope: 1 }), []);
  assertEquals(parseSuggest(["x", ["ok", 5, "", "  also  "]]), ["ok", "also"]);
});

Deno.test("queryVariants: the seed first, then a few extensions, no more than asked", () => {
  const v = queryVariants("macam mana nak mapping gold", 3);
  assertEquals(v.length, 3);
  assertEquals(v[0], "macam mana nak mapping gold");
  assert(v.every((x) => x.startsWith("macam mana nak mapping gold")));
  assertEquals(queryVariants("gold", 1), ["gold"]);
});

Deno.test("topicRisk: a claim or a banned word in the topic makes it risky to make a video about", () => {
  assertEquals(topicRisk("how to place a stop loss"), 0);
  assert(topicRisk("gold entry 4590 tp 4604") > 0, "a price level is a claim");
  assertEquals(topicRisk("guaranteed profit signals"), 1);
  assertEquals(topicRisk("pasti untung dengan gold"), 1);
});

Deno.test("demandScore: autocomplete depth, lifted by Creator Search Insights, capped at 1", () => {
  assertEquals(demandScore({ suggestions: 0 }), 0);
  assertEquals(demandScore({ suggestions: 5 }), 0.5);
  assertEquals(demandScore({ suggestions: 10 }), 1);
  assertEquals(demandScore({ suggestions: 20 }), 1);
  assertEquals(demandScore({ suggestions: 5, csiPopularity: 100, csiTrend: "up" }), 0.9);
  assertEquals(demandScore({ suggestions: 9, csiPopularity: 100, csiTrend: "up" }), 1);
  assertEquals(demandScore({ suggestions: 5, csiTrend: "down" }), 0.5);
});

Deno.test("buildBrief: the week's calendar slots, the best fitting topic for each pillar, each topic once", () => {
  const slots = [
    { dow: 1, pillar: "map_recap", topic: "MR: this morning's zone touch" },
    { dow: 2, pillar: "lesson", topic: "L: where your stop goes on gold" },
    { dow: 3, pillar: "channel_audit", topic: "CA: the 95% win rate" },
  ];
  const clusters = [
    { name: "how to map gold every morning", pillar: "map_recap", persona: "gold_beginner", score: 0.8 },
    { name: "why do I keep getting stopped out", pillar: "lesson", persona: "gold_beginner", score: 0.7 },
    { name: "where does my stop loss go on gold", pillar: "lesson", persona: "gold_beginner", score: 0.9 },
    { name: "is a 95% win rate real", pillar: "channel_audit", persona: "signal_refugee", score: 0 }, // risky: score 0
  ];
  const b = buildBrief({ week: "2026-10-12", cycleWeek: 2, slots, clusters });
  assertEquals(b.proposed_slots.map((s) => s.suggested), [
    "how to map gold every morning", "where does my stop loss go on gold", null,
  ]);
  assertEquals(b.proposed_slots[0].dow, 1);
  assert(b.body.includes("week of 2026-10-12"));
  assert(b.body.includes("calendar week 2"));
  assert(b.body.includes("where does my stop loss go on gold"));
  assert(b.body.includes("0.90"));
  assert(!b.body.includes("is a 95% win rate real"), "a zero-score topic is not proposed");
});

Deno.test("buildBrief: no clusters yet still gives the calendar, and says so", () => {
  const b = buildBrief({ week: "2026-10-12", cycleWeek: 1, slots: [{ dow: 1, pillar: "map_recap", topic: "MR: x" }], clusters: [] });
  assertEquals(b.proposed_slots[0].suggested, null);
  assert(/no scored topics/i.test(b.body));
});

Deno.test("coreTerms: a long seed question reduced to its meaningful words, in order", () => {
  assertEquals(coreTerms("where does my stop loss go on gold"), "stop loss gold");
  assertEquals(coreTerms("how to map gold every morning"), "map gold every");
  assertEquals(coreTerms("cara trading gold"), "cara trading gold");
  assertEquals(coreTerms("gold"), "gold");
  assertEquals(coreTerms("what is the price of the pro plan", 2), "price pro");
});

Deno.test("csiRow: ABDUL's field names and the dashboard form's both become a csi_captures row", () => {
  assertEquals(csiRow({ topic: "gold news today", popularity: 82, trend: "up", gap: true, icp: "beginner", note: "seen on the TikTok app" }), {
    topic: "gold news today", category: "beginner", metric: "popularity", value: 82, trend: "up", note: "content gap. seen on the TikTok app",
  });
  assertEquals(csiRow({ topic: "x", category: "c", metric: "searches", value: "5.5", trend: "flat" }), {
    topic: "x", category: "c", metric: "searches", value: 5.5, trend: "flat", note: null,
  });
  assertEquals(csiRow({ topic: "  just a topic  " }), { topic: "just a topic", category: null, metric: null, value: null, trend: null, note: null });
});

Deno.test("csiRow: a missing topic, a made-up trend or a non-number is refused", () => {
  assertThrows(() => csiRow({ topic: "  " }), Error, "topic");
  assertThrows(() => csiRow({ topic: "x", trend: "sideways" }), Error, "trend");
  assertThrows(() => csiRow({ topic: "x", popularity: "lots" }), Error, "number");
});

Deno.test("pickIdeas: the post matching more of a persona's seed terms wins and says why", () => {
  const personas = [
    { id: 1, pillar: "Risk", terms: ["stop loss", "overtrading"] },
    { id: 2, pillar: "Gold", terms: ["xauusd", "nfp"] },
  ];
  const ideas = pickIdeas([
    { id: "a", title: "Overtrading is why accounts die", summary: "Cut size", publishedAt: "2026-10-04T00:00:00Z" },
    { id: "b", title: "XAUUSD and NFP week ahead", summary: null, publishedAt: "2026-10-03T00:00:00Z" },
    { id: "c", title: "Nobody matches this one", summary: "Nothing", publishedAt: "2026-10-05T00:00:00Z" },
  ], personas, { now: Date.parse("2026-10-05T00:00:00Z") });
  assertEquals(ideas.length, 2, "an item that matches no persona is not an idea");
  assertEquals(ideas[0].id, "b", "two matched terms beat one");
  assertEquals(ideas[0].pillar, "Gold");
  assertEquals(ideas[0].score, 2);
  assertEquals(ideas[1].id, "a");
  assertEquals(ideas[1].pillar, "Risk");
  assertEquals(ideas[1].score, 1);
});

Deno.test("pickIdeas: only the window, the limit and a sane answer for nothing found", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const personas = [{ id: 1, pillar: "Gold", terms: ["gold"] }];
  const got = pickIdeas([
    { id: "old", title: "gold then", summary: null, publishedAt: "2026-09-01T00:00:00Z" },
    { id: "new", title: "gold now", summary: null, publishedAt: "2026-10-04T00:00:00Z" },
    { id: "undated", title: "gold undated", summary: null, publishedAt: null },
  ], personas, { now, days: 14, limit: 1 });
  assertEquals(got.map((i) => i.id), ["new"], "the stale month-old item is outside the window");
  assertEquals(pickIdeas([{ id: "x", title: "nothing", summary: null, publishedAt: null }], personas, { now }), []);
  assertEquals(pickIdeas([], personas, { now }), []);
});

Deno.test("personaTerms: every language's seed questions become the words the scorer looks for", () => {
  const terms = personaTerms(
    { en: ["where should my stop loss go on gold"], ms: ["di mana nak letak stop loss"], manglish: ["settled lah already"] },
    "Gold & Risk",
  );
  assert(terms.includes("gold"), "the question's own words are in");
  assert(terms.includes("stop"), "a two-word phrase matches as its parts, not as one long phrase nobody writes");
  assert(terms.includes("risk"), "the pillar counts too");
  assertEquals(new Set(terms).size, terms.length, "no word arrives twice");
  assert(terms.length <= 80, "capped, so one persona cannot match every item");
});

Deno.test("personaTerms: an empty or unusable bag still answers, so the scorer never crashes on a thin persona", () => {
  assertEquals(personaTerms({}, null), []);
  assertEquals(personaTerms({ en: ["???"] }, null), [], "nothing readable means no terms, not a throw");
});

Deno.test("pickIdeas: words every post uses do not score, so a topical post beats a coincidental one", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const personas = [{ id: 1, pillar: "Gold", terms: ["all", "one", "best", "stop", "tp", "gold", "nfp"] }];
  const got = pickIdeas([
    // a post on any subject at all, carrying the vocabulary of every trading post
    { id: "generic", title: "All one best stop tp — read now", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    // the one a gold channel would actually publish
    { id: "topic", title: "Gold and NFP week ahead", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
  ], personas, { now });

  const topic = got.find((i) => i.id === "topic");
  assertEquals(topic?.matched, ["gold", "nfp"], "the words that tell posts apart are the ones that count");
  assertEquals(topic?.score, 2);
  assertEquals(got.find((i) => i.id === "generic"), undefined,
    "a post matching only words every post carries is not an idea, however many of them it carries");
});

Deno.test("pickIdeas: a ticker is not a subject, a number is not a topic, and crypto is not a candidate", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const personas = [{ id: 1, pillar: "Macro", terms: ["gold", "usd", "yields", "500"] }];
  const got = pickIdeas([
    // "Golden" is not gold and "BTCUSD" is not usd: both are substring accidents
    { id: "btc", title: "BTCUSD | Golden Cross Supports the Trend", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    // no crypto word here, so this one can only be excluded by the boundary itself
    { id: "golden", title: "Golden Cross Strategy Update for the week", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    // would match `gold` on its own merits, and is still out of scope
    { id: "coin", title: "Bitcoin and USDC rally as gold loses its shine", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    { id: "au", title: "Gold holds as yields fall; USD firm, 500 pips", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
  ], personas, { now });

  const ids = got.map((i) => i.id);
  assert(!ids.includes("btc"), "an out-of-scope ticker never becomes a candidate");
  assert(!ids.includes("golden"), "a word boundary separates golden from gold, with no out-of-scope word in sight");
  assert(!ids.includes("coin"), "an asset Jack does not cover is not a candidate at all");
  assertEquals(got.find((i) => i.id === "au")?.matched, ["gold", "usd", "yields"], "the digits in a price are not a topic");
});

Deno.test("pickIdeas: an equity post is out of scope, without taking the dollar index with it", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const personas = [{ id: 1, pillar: "Macro", terms: ["gold", "usd", "stocks", "dxy", "index"] }];
  const got = pickIdeas([
    { id: "tickers", title: "META and MSFT ride higher as stocks rally", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    // matches `index`, so only the scope list can take it out
    { id: "apple", title: "Apple climbs 3% as the dollar index eases", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
    // DXY is the dollar index and it is Jack's, not an equity index
    { id: "dxy", title: "DXY index falls as gold holds; USD steady", summary: null, publishedAt: "2026-10-05T00:00:00Z" },
  ], personas, { now });

  const ids = got.map((i) => i.id);
  assert(!ids.includes("tickers"), "equity tickers are not candidates");
  assert(!ids.includes("apple"), "a company name is not a candidate even when the post also says index");
  const keep = got.find((i) => i.id === "dxy");
  assert(keep, "the dollar index stays: it is a subject Jack covers");
  assertEquals(keep.matched, ["gold", "usd", "dxy", "index"]);
});
