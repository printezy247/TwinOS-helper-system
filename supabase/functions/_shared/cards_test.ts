import { assert, assertEquals } from "std/assert/mod.ts";
import {
  batchListKeyboard,
  cmdCallback,
  editKeyboard,
  heldKeyboard,
  laterKeyboard,
  parseCallback,
  presetCallback,
  shortCallback,
  slotCallback,
} from "./tg.ts";
import { HANDLED_CALLBACK_VERBS, keyboardVerbs } from "./desk.ts";

const ID = "6f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8";

Deno.test("quick picks and edit presets parse with their slot (Wave 1 items 6-7)", () => {
  const rs = parseCallback(slotCallback(ID, "13"));
  assert(rs?.kind === "item" && rs.verb === "rs" && rs.extra === "13", JSON.stringify(rs));
  const tom = parseCallback(slotCallback(ID, "tom"));
  assert(tom?.kind === "item" && tom.extra === "tom", JSON.stringify(tom));
  const ed = parseCallback(presetCallback(ID, "soften"));
  assert(ed?.kind === "item" && ed.verb === "ed" && ed.extra === "soften", JSON.stringify(ed));
  const own = parseCallback(presetCallback(ID, "own"));
  assert(own?.kind === "item" && own.extra === "own", JSON.stringify(own));
  const vw = parseCallback(shortCallback("vw", ID));
  assert(vw?.kind === "item" && vw.verb === "vw", JSON.stringify(vw));
  const cmd = parseCallback(cmdCallback("refresh"));
  assert(cmd?.kind === "cmd" && cmd.name === "refresh", JSON.stringify(cmd));
  assertEquals(parseCallback(cmdCallback("batchyes"))?.kind, "cmd");
});

Deno.test("later / edit / batch keyboards: every verb handled, data under 64 bytes (Wave 1 items 5-7)", () => {
  const kbs = [
    laterKeyboard(ID),
    editKeyboard(ID),
    batchListKeyboard([{ n: 1, id: ID }, { n: 2, id: ID }], 2),
    // Wave 8 §3.11: a paged batch with a copy row and a Back that knows where
    // it came from must stay inside the same grammar.
    batchListKeyboard([{ n: 7, id: ID, copy: "the body" }, { n: 8, id: ID }], 1, {
      page: 2,
      pages: 3,
      prev: "status",
    }),
  ];
  const emitted = new Set<string>();
  for (const kb of kbs) {
    for (const row of kb) {
      for (const b of row) {
        const d = b.callback_data ?? "";
        if (!d) {
          // Wave 8 §3.1: a copy_text button carries no callback by design —
          // it must carry the text it puts on the clipboard.
          assert(!!b.copy_text || !!b.url || !!b.web_app, `bare button: ${b.text}`);
          continue;
        }
        assert(new TextEncoder().encode(d).length <= 64, `over 64 bytes: ${d}`);
        assert(parseCallback(d) !== null, `unparseable button: ${d}`);
      }
    }
    for (const v of keyboardVerbs(kb)) emitted.add(v);
  }
  const missing = [...emitted].filter((v) => !(HANDLED_CALLBACK_VERBS as readonly string[]).includes(v));
  assertEquals(missing, [], `unhandled callback verbs: ${missing.join(", ")}`);
  assert(emitted.has("rs") && emitted.has("ed") && emitted.has("cmd"), [...emitted].join(","));
  assert(emitted.has("pg") && emitted.has("nav"), [...emitted].join(","));
});

Deno.test("batch list: copy row, pager, Back (Wave 8 §3.1, §3.11)", () => {
  const flat = batchListKeyboard([{ n: 7, id: ID, copy: "the body" }], 0, { page: 2, pages: 3 }).flat();
  assert(flat.some((b) => b.copy_text === "the body"), "a 📋 copy row for the item");
  const datas = flat.map((b) => b.callback_data ?? "");
  const pg = datas.find((d) => d.startsWith("pg:batch"));
  assert(pg && parseCallback(pg)?.kind === "page", `no batch pager: ${pg}`);
  assert(datas.includes("nav:back:home@v2"), datas.join(","));
  // One page: no pager, and a copy-less item gets no copy row.
  const single = batchListKeyboard([{ n: 1, id: ID }], 0, { page: 1, pages: 1 }).flat();
  assert(!single.some((b) => b.callback_data?.startsWith("pg:")), "no pager on a single page");
  assert(!single.some((b) => b.copy_text), "no copy row without a body");
});

Deno.test("a held send asks Jack: It's posted / Send again, both handled and under 64 bytes", () => {
  const kb = heldKeyboard(ID, "telegram");
  for (const b of kb.flat()) {
    const d = b.callback_data ?? "";
    assert(new TextEncoder().encode(d).length <= 64, d);
    const p = parseCallback(d);
    assert(p?.kind === "item" && p.extra === "telegram", d);
  }
  const verbs = keyboardVerbs(kb);
  assertEquals(verbs.sort(), ["hp", "hs"]);
  const missing = verbs.filter((v) => !(HANDLED_CALLBACK_VERBS as readonly string[]).includes(v));
  assertEquals(missing, []);
});
