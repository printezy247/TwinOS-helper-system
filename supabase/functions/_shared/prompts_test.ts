import { assertEquals } from "std/assert/mod.ts";
import { selectPrompt, type PromptRow } from "./prompts.ts";

/** Rows as the table would return them — the precedence rules under test. */
function row(p: Partial<PromptRow> & Pick<PromptRow, "name" | "version" | "mode">): PromptRow {
  return {
    id: p.id ?? p.version,
    platform: null,
    pillar: null,
    lang: "en",
    body: `body of ${p.name}@${p.version}`,
    active: true,
    created_at: "2026-10-24T00:00:00Z",
    ...p,
  } as PromptRow;
}

const LIB = [
  row({ name: "system-default", version: 1, mode: "*" }),
  row({ name: "system-default", version: 2, mode: "*" }),
  row({ name: "draft-lesson", version: 1, mode: "draft_post" }),
  row({ name: "polish-punchy", version: 3, mode: "polish" }),
  row({ name: "tg-only", version: 1, mode: "*", platform: "telegram" }),
  row({ name: "retired", version: 9, mode: "draft_post", active: false }),
];

Deno.test("mode-specific beats the '*' default; newest version wins in a bucket", () => {
  const picked = selectPrompt(LIB, "draft_post", {}, 0);
  assertEquals(picked?.name, "draft-lesson");
  const fallback = selectPrompt(LIB, "expand_topic", {}, 0);
  assertEquals(fallback?.name, "system-default");
  assertEquals(fallback?.version, 2); // v2 over v1 inside the same bucket
});

Deno.test("the prompt_version setting pins the version when a candidate matches", () => {
  const picked = selectPrompt(LIB, "draft_post", {}, 1);
  // Several active rows carry version 1; the pin picks THAT version, and
  // mode-specific still wins inside it.
  assertEquals(picked?.name, "draft-lesson");
  assertEquals(picked?.version, 1);
});

Deno.test("a request pin (name@version) beats the setting and the mode rule", () => {
  const picked = selectPrompt(LIB, "draft_post", { pinName: "polish-punchy", pinVersion: 3 }, 1);
  assertEquals(picked?.name, "polish-punchy");
  // A pin that is not an active candidate falls through to normal selection.
  const miss = selectPrompt(LIB, "draft_post", { pinName: "retired", pinVersion: 9 }, 0);
  assertEquals(miss?.name, "draft-lesson");
});

Deno.test("inactive rows and platform mismatches never win", () => {
  assertEquals(selectPrompt([row({ name: "only-retired", version: 1, mode: "draft_post", active: false })], "draft_post", {}, 0), null);
  const wrongPlatform = selectPrompt(LIB, "draft_post", { platform: "tiktok" }, 0);
  assertEquals(wrongPlatform?.name, "draft-lesson"); // tg-only filtered out
  const rightPlatform = selectPrompt(LIB, "draft_post", { platform: "telegram" }, 0);
  assertEquals(rightPlatform?.name, "draft-lesson");
});
