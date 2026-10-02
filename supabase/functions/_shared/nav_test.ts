import { assert, assertEquals } from "std/assert/mod.ts";
import {
  backHomeRows,
  isStaleFp,
  menuKeyboard,
  NAV_LAYOUT,
  navCallback,
  nopButton,
  pageCallback,
  parseCallback,
} from "./tg.ts";
import { keyboardVerbs } from "./desk.ts";

const ID8 = "6f1c2b3a";

Deno.test("grammar v2: legacy item verbs still parse (Wave 1 item 1)", () => {
  for (const verb of ["ok", "no", "edit", "later", "cancel"]) {
    const p = parseCallback(`${verb}:${ID8}`);
    assert(p?.kind === "item", `${verb} should stay an item callback`);
    if (p?.kind === "item") assertEquals([p.verb, p.short], [verb, ID8]);
  }
});

Deno.test("grammar v2: nav, page and nop parse (Wave 1 item 1)", () => {
  const nav = parseCallback(`nav:batch@${NAV_LAYOUT}`);
  assert(nav?.kind === "nav" && nav.screen === "batch" && nav.fp === NAV_LAYOUT, JSON.stringify(nav));
  const arg = parseCallback(`nav:batch:week1@${NAV_LAYOUT}`);
  assert(arg?.kind === "nav" && arg.arg === "week1", JSON.stringify(arg));
  const pg = parseCallback(`pg:drafts:2@${NAV_LAYOUT}`);
  assert(pg?.kind === "page" && pg.screen === "drafts" && pg.n === 2, JSON.stringify(pg));
  assertEquals(parseCallback("nop")?.kind, "nop");
  assertEquals(parseCallback("bogus"), null);
});

Deno.test("grammar v2: a stale layout fingerprint is detected (Wave 1 item 1)", () => {
  assertEquals(isStaleFp(NAV_LAYOUT), false);
  assertEquals(isStaleFp("v0"), true);
  const stale = parseCallback("nav:home@v0");
  assert(stale?.kind === "nav" && isStaleFp(stale.fp), "old menus must answer outdated and redraw");
});

Deno.test("grammar v2: every builder stays under 64 bytes (Wave 1 item 1)", () => {
  const datas = [
    navCallback("home"),
    navCallback("batch", "week1"),
    pageCallback("drafts", 12),
    nopButton("…").callback_data ?? "",
  ];
  for (const d of datas) {
    assert(new TextEncoder().encode(d).length <= 64, `over 64 bytes: ${d}`);
    assert(parseCallback(d) !== null, `unparseable: ${d}`);
  }
});

Deno.test("menu: home panel has the five screens, every screen has Back + Home (Wave 1 item 2)", () => {
  const verbs = keyboardVerbs(menuKeyboard());
  assertEquals(verbs, ["nav"]);
  const all: string[] = [];
  for (const row of menuKeyboard()) for (const b of row) all.push(b.callback_data ?? "");
  for (const s of ["status", "batch", "friday", "hours", "help"]) {
    assert(all.some((d) => d.startsWith(`nav:${s}@`)), `no button for ${s}`);
  }
  const back = keyboardVerbs(backHomeRows());
  assertEquals(back, ["nav"]);
});
