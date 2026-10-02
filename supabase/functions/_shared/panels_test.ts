import { assert } from "std/assert/mod.ts";
import {
  MENU_SCREENS,
  menuKeyboard,
  parseCallback,
  screenKeyboard,
  shortCallback,
} from "./tg.ts";

const ID = "6f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8";
const ID8 = "6f1c2b3a";

Deno.test("fan-out rides on approved cards (Wave 1 item 8)", () => {
  const p = parseCallback(shortCallback("fan", ID));
  assert(p?.kind === "item" && p.verb === "fan" && p.short === ID8, JSON.stringify(p));
});

Deno.test("moderation and repeat alerts answer with buttons (Wave 1 item 11)", () => {
  for (const a of ["ban", "mute", "ignore", "faq", "drop"]) {
    const p = parseCallback(`mo:${a}:${ID8}`);
    assert(p?.kind === "item" && p.verb === "mo" && p.extra === a, `${a}: ${JSON.stringify(p)}`);
  }
});

Deno.test("refresh screens and drafts paging stay handled and short (Wave 1 items 9-10)", () => {
  assert((MENU_SCREENS as readonly string[]).includes("drafts"), "pending drafts needs a screen");
  for (const kb of [screenKeyboard("status"), screenKeyboard("friday"), screenKeyboard("hours"), menuKeyboard()]) {
    for (const row of kb) {
      for (const b of row) {
        const d = b.callback_data ?? "";
        assert(new TextEncoder().encode(d).length <= 64, d);
        assert(parseCallback(d) !== null, d);
      }
    }
  }
  const pg = parseCallback("pg:drafts:2@v1");
  assert(pg?.kind === "page" && pg.screen === "drafts" && pg.n === 2, JSON.stringify(pg));
  const stalePg = parseCallback("pg:drafts:1@v0");
  assert(stalePg?.kind === "page", "stale paging taps must still parse so they redraw");
});
