import { assertEquals } from "std/assert/mod.ts";
import { pickLines, render, requiredLineFacts } from "./content.ts";

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
