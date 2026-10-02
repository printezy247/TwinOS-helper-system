import { assert, assertEquals } from "std/assert/mod.ts";
import { eligibleCtas, eligibleHooks, pickLru, type CtaRow, type HookRow } from "./hooks.ts";

// Wave 3 item 5: hook + CTA library per pillar, platform and language,
// rotated least-recently-used, no AI.

const hooks: HookRow[] = [
  { id: 1, pillar: "lesson", lang: "en", text: "used often", times_used: 9, last_used_at: "2026-10-01T00:00:00Z", active: true },
  { id: 2, pillar: "lesson", lang: "en", text: "never used", times_used: 0, last_used_at: null, active: true },
  { id: 3, pillar: "lesson", lang: "en", text: "used once", times_used: 1, last_used_at: "2026-09-01T00:00:00Z", active: true },
  { id: 4, pillar: "lesson", lang: "ms", text: "BM line", times_used: 0, last_used_at: null, active: true },
  { id: 5, pillar: "lesson", lang: "en", text: "retired", times_used: 0, last_used_at: null, active: false },
];

Deno.test("LRU picks never-used first, then the oldest use", () => {
  assertEquals(pickLru(hooks.filter((h) => h.active && h.lang === "en"))?.id, 2);
  assertEquals(pickLru([]), null);
});

Deno.test("hooks filter by language and pillar, falling back to any same-language hook", () => {
  assertEquals(eligibleHooks(hooks, "en", "lesson").map((h) => h.id).sort(), [1, 2, 3]);
  assertEquals(eligibleHooks(hooks, "en", "tool_demo").map((h) => h.id).sort(), [1, 2, 3]);
  assertEquals(eligibleHooks(hooks, "ms", "lesson").map((h) => h.id), [4]);
  assert(eligibleHooks(hooks, "en", "lesson").every((h) => h.active));
});

const ctas: CtaRow[] = [
  { id: 1, platform: "telegram", lang: "en", text: "fresh", times_used: 0, last_used_at: null, active: true },
  { id: 2, platform: "telegram", lang: "en", text: "stale", times_used: 4, last_used_at: "2026-10-02T00:00:00Z", active: true },
  { id: 3, platform: "tiktok", lang: "en", text: "other platform", times_used: 0, last_used_at: null, active: true },
];

Deno.test("CTAs filter by platform and language and rotate LRU", () => {
  const eligible = eligibleCtas(ctas, "telegram", "en");
  assertEquals(eligible.map((c) => c.id).sort(), [1, 2]);
  assertEquals(pickLru(eligible)?.id, 1);
  assertEquals(eligibleCtas(ctas, "telegram", "ms").length, 0);
  assertEquals(eligibleCtas(ctas, "threads", "en").length, 0); // platform is exact: a wrong-platform CTA is worse than none
});
