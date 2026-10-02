import { assert, assertEquals } from "std/assert/mod.ts";
import {
  buildBrief, coreTerms, demandScore, parseSuggest, queryVariants, scoreTopic, topicRisk,
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

Deno.test("scoreTopic: demand x ICP fit x (1 - risk)", () => {
  assertEquals(scoreTopic({ demand: 0.8, icpFit: 1, risk: 0 }), 0.8);
  assertEquals(scoreTopic({ demand: 0.8, icpFit: 0.5, risk: 0 }), 0.4);
  assertEquals(scoreTopic({ demand: 0.8, icpFit: 1, risk: 1 }), 0);
  assertEquals(scoreTopic({ demand: 0.8, icpFit: 1, risk: 0.25 }), 0.6);
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
