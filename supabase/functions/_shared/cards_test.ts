import { assert, assertEquals } from "std/assert/mod.ts";
import {
  batchListKeyboard,
  cmdCallback,
  editKeyboard,
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
  ];
  const emitted = new Set<string>();
  for (const kb of kbs) {
    for (const row of kb) {
      for (const b of row) {
        const d = b.callback_data ?? "";
        assert(new TextEncoder().encode(d).length <= 64, `over 64 bytes: ${d}`);
        assert(parseCallback(d) !== null, `unparseable button: ${d}`);
      }
    }
    for (const v of keyboardVerbs(kb)) emitted.add(v);
  }
  const missing = [...emitted].filter((v) => !(HANDLED_CALLBACK_VERBS as readonly string[]).includes(v));
  assertEquals(missing, [], `unhandled callback verbs: ${missing.join(", ")}`);
  assert(emitted.has("rs") && emitted.has("ed") && emitted.has("cmd"), [...emitted].join(","));
});
