import { assertEquals } from "std/assert/mod.ts";
import { GOLDEN_CASES, scoreOutput } from "./eval.ts";

const draft = GOLDEN_CASES.find((c) => c.name.startsWith("draft_post"))!;

Deno.test("a clean completion passes: no blocking findings", () => {
  const text =
    "Gold is retesting 4030 after soft CPI. Watch the reaction at the level — the outcome is never certain. Levels are on the chart; come trade the plan with us in the channel. #XAUUSD";
  const s = scoreOutput(text, draft);
  assertEquals(s.passed, true, JSON.stringify(s.findings, null, 2));
  assertEquals(s.error, null);
});

Deno.test("an unfinished template fails the harness", () => {
  const s = scoreOutput("Gold moves fast. [NEEDED] price level here.", draft);
  assertEquals(s.passed, false);
  assertEquals(s.findings.length > 0, true);
});

Deno.test("an empty completion fails with an error, not a pass", () => {
  const s = scoreOutput("   ", draft);
  assertEquals(s.passed, false);
  assertEquals(s.error, "empty completion");
});

Deno.test("every golden case targets a real mode with the lesson shape", () => {
  const modes = GOLDEN_CASES.map((c) => c.mode).sort();
  assertEquals(modes, ["draft_post", "hook_variations", "polish"]);
  for (const c of GOLDEN_CASES) {
    assertEquals(c.as.platform, "telegram");
    assertEquals(c.as.post_type, "lesson");
    assertEquals(c.name.includes(":"), true);
  }
});
