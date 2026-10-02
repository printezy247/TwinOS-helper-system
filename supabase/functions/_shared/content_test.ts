import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { buildCommentJobs, pickLines, render, requiredLineFacts, shortIdRange } from "./content.ts";

Deno.test("a Desk short id becomes a uuid range (Postgres has no LIKE on uuid)", () => {
  assertEquals(shortIdRange("C0203593"), {
    from: "c0203593-0000-0000-0000-000000000000",
    to: "c0203593-ffff-ffff-ffff-ffffffffffff",
  });
  assertThrows(() => shortIdRange("c020359"));
  assertThrows(() => shortIdRange("zz203593"));
  assertThrows(() => shortIdRange("c0203593%"));
});

const tpl = (body: string, fields: string[] = [], lines: string[] = []) => ({ body, fields, required_lines: lines });

Deno.test("render fills {{field}} and flags missing ones as [NEEDED]", () => {
  const r = render(tpl("Hi {{name}}, {{place}}"), { name: "Jack" });
  assertEquals(r.body, "Hi Jack, [NEEDED:place]");
  assertEquals(r.needed, ["place"]);
});

Deno.test("an optional {{?field}} renders empty and never blocks", () => {
  const r = render(tpl("A\n{{?note}}\nB"), {});
  assertEquals(r.body, "A\n\nB");
  assertEquals(r.needed, []);
  assertEquals(render(tpl("A\n{{?note}}\nB"), { note: "x" }).body, "A\nx\nB");
});

Deno.test("a field listed as required is needed even when the body omits it", () => {
  assertEquals(render(tpl("plain", ["date"]), {}).needed, ["date"]);
  assertEquals(render(tpl("plain", ["date"]), { date: "today" }).needed, []);
});

Deno.test("zero is a value, not a missing field", () => {
  assertEquals(render(tpl("R: {{r}}"), { r: 0 }).needed, []);
});

Deno.test("required lines are appended once", () => {
  const r = render(tpl("Body", [], ["Risk line."]), {});
  assertEquals(r.body, "Body\n\nRisk line.");
  assertEquals(render(tpl("Body\n\nRisk line.", [], ["Risk line."]), {}).body, "Body\n\nRisk line.");
});

Deno.test("brand-fact keys resolve to the locked line, Malay when there is one", () => {
  assertEquals(requiredLineFacts(["risk", "board_ref", "result_footer"], "signal_card"), ["risk_line_signal", "result_footer"]);
  assertEquals(requiredLineFacts(["risk"], "gold_map"), ["risk_line_map"]);
  const facts = new Map([["risk_line_map", "EN risk"], ["risk_line_map_ms", "MS risk"], ["education_line", "EN edu"]]);
  assertEquals(pickLines(["risk_line_map", "education_line"], "en", facts), ["EN risk", "EN edu"]);
  assertEquals(pickLines(["risk_line_map", "education_line"], "ms", facts), ["MS risk", "EN edu"]);
});

Deno.test("first-comment jobs: telegram only, delayed, carrying the comment", () => {
  const rows = buildCommentJobs("cid", [
    { id: "v-tg", platform: "telegram" },
    { id: "v-ig", platform: "instagram" },
  ], "2026-10-04T08:00:00.000Z", "Results get posted here.", 30, "jack");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].kind, "comment");
  assertEquals(rows[0].variant_id, "v-tg");
  assertEquals(rows[0].run_at, "2026-10-04T08:30:00.000Z");
  assertEquals((rows[0].result as { first_comment: string }).first_comment, "Results get posted here.");
  assertEquals(buildCommentJobs("cid", [{ id: "v-tg", platform: "telegram" }], "2026-10-04T08:00:00.000Z", null, 30, "jack"), []);
  assertEquals(buildCommentJobs("cid", [{ id: "v-ig", platform: "instagram" }], "2026-10-04T08:00:00.000Z", "Hi.", 30, "jack"), []);
});
