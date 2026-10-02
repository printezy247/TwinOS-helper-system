import { assert, assertEquals } from "std/assert/mod.ts";
import { articleBrief } from "./articles.ts";

const QUERIES = [
  "cara trading gold pemula", "cara trading gold yang benar", "cara trading gold di metatrader 5",
  "cara trading gold agar profit", "bagaimana cara trading gold", "apa itu stop loss gold", "berapa modal untuk trading gold?",
  "cara trading gold yang aman",
];

Deno.test("articleBrief: a Malay brief with title options, questions as headings, and keywords", () => {
  const b = articleBrief({ topic: "cara trading gold", lang: "ms", queries: QUERIES });
  assert(b.titles.length >= 2 && b.titles.length <= 4);
  assert(b.titles.every((t) => t.toLowerCase().includes("trading gold")));
  assertEquals(b.questions, ["bagaimana cara trading gold", "apa itu stop loss gold", "berapa modal untuk trading gold?"]);
  assert(b.keywords.includes("cara trading gold pemula"));
  assertEquals(b.keywords.length <= 8, true);
  assertEquals(b.lang, "ms");
});

Deno.test("articleBrief: the written brief carries the rules a financial article must keep", () => {
  const text = articleBrief({ topic: "cara trading gold", lang: "ms", queries: QUERIES }).text;
  assert(/risk line|risiko/i.test(text));
  assert(/no guaranteed|tiada jaminan|never promise/i.test(text));
  assert(text.includes("bagaimana cara trading gold"));
  assert(/1,?200|1500|1,?500/.test(text), "a target length is given");
});

Deno.test("articleBrief: no queries still gives a usable skeleton and says autocomplete had nothing", () => {
  const b = articleBrief({ topic: "stop loss gold", lang: "en", queries: [] });
  assertEquals(b.questions, []);
  assert(b.titles.length >= 1);
  assert(/no autocomplete|no suggestions/i.test(b.text));
});

Deno.test("articleBrief: duplicate and empty queries are ignored", () => {
  const b = articleBrief({ topic: "gold", lang: "en", queries: ["gold zone", "gold zone", "  ", "how to read a gold zone"] });
  assertEquals(b.keywords, ["gold zone", "how to read a gold zone"]);
  assertEquals(b.questions, ["how to read a gold zone"]);
});
