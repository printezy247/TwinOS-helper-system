import { assert, assertEquals } from "std/assert/mod.ts";
import { promoteSuggestion, type HookStat, type PromotionConfig } from "./promotion.ts";

// E2 (v5 plan): hook promotion is a PROPOSAL, never automatic. The decision is
// pure arithmetic on v_hook_performance-shaped rows so the Friday page can show
// the evidence and Jack can approve — or not.

const CONFIG: PromotionConfig = { margin: 0.25, min_posts: 5 };

const stat = (hook_id: number, over: Partial<HookStat> = {}): HookStat => ({
  hook_id,
  hook: `hook ${hook_id}`,
  lang: "en",
  uses: 10,
  avg_views_1h: 100,
  ...over,
});

Deno.test("below the margin: nothing to show", () => {
  // 124 is under 100 × 1.25 = 125 → no beat, no suggestion.
  assertEquals(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 124 })], CONFIG), null);
});

Deno.test("exactly at the margin: exactly one suggestion, with the numbers", () => {
  const s = promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 125 })], CONFIG);
  assert(s, "at the margin the suggestion must appear");
  assertEquals(s.candidate.hook_id, 2);
  assertEquals(s.incumbent.hook_id, 1);
  assertEquals(s.candidate.avg_views_1h, 125);
  assertEquals(s.incumbent.avg_views_1h, 100);
  assertEquals(s.candidate.uses, 10);
  assertEquals(s.lift_pct, 25); // evidence, not vibes
  assertEquals(s.config, CONFIG);
});

Deno.test("fewer posts than min_posts: nothing, however good the average", () => {
  assertEquals(
    promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 500, uses: CONFIG.min_posts - 1 })], CONFIG),
    null,
  );
  // exactly min_posts is enough
  assert(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 500, uses: CONFIG.min_posts })], CONFIG));
});

Deno.test("two candidates beat: the best average wins", () => {
  const s = promoteSuggestion(
    stat(1),
    [stat(2, { avg_views_1h: 150 }), stat(3, { avg_views_1h: 200 })],
    CONFIG,
  );
  assertEquals(s?.candidate.hook_id, 3);
});

Deno.test("tied candidates: deterministic pick (lowest hook_id)", () => {
  const a = promoteSuggestion(stat(1), [stat(3, { avg_views_1h: 200 }), stat(2, { avg_views_1h: 200 })], CONFIG);
  const b = promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 200 }), stat(3, { avg_views_1h: 200 })], CONFIG);
  assertEquals(a?.candidate.hook_id, 2);
  assertEquals(b?.candidate.hook_id, 2); // input order does not matter
});

Deno.test("no incumbent or incumbent without data: nothing to compare against", () => {
  assertEquals(promoteSuggestion(null, [stat(2)], CONFIG), null);
  assertEquals(promoteSuggestion(stat(1, { avg_views_1h: null }), [stat(2)], CONFIG), null);
});

Deno.test("candidate must match the incumbent's language", () => {
  assertEquals(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 900, lang: "ms" })], CONFIG), null);
});

Deno.test("incumbent itself cannot be proposed", () => {
  assertEquals(promoteSuggestion(stat(1), [stat(1, { avg_views_1h: 900 })], CONFIG), null);
});

Deno.test("zero-incumbent: any positive average beats it, zero does not", () => {
  assert(promoteSuggestion(stat(1, { avg_views_1h: 0 }), [stat(2, { avg_views_1h: 1 })], CONFIG));
  assertEquals(promoteSuggestion(stat(1, { avg_views_1h: 0 }), [stat(2, { avg_views_1h: 0 })], CONFIG), null);
});

Deno.test("bad config: no suggestion, never an automatic act", () => {
  for (const cfg of [
    { margin: NaN, min_posts: 5 },
    { margin: -0.1, min_posts: 5 },
    { margin: 0.25, min_posts: 0 },
    { margin: 0.25, min_posts: NaN },
    { margin: 0.25, min_posts: 2.5 },
  ] as PromotionConfig[]) {
    assertEquals(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 900 })], cfg), null);
  }
});

Deno.test("at/above the margin with rounding noise uses exact numbers", () => {
  // 100 → 125.0 exactly; 124.999 is below.
  assertEquals(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 124.999 })], CONFIG), null);
  assert(promoteSuggestion(stat(1), [stat(2, { avg_views_1h: 125.001 })], CONFIG));
});
