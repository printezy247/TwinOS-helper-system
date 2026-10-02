import { assertEquals } from "std/assert/mod.ts";
import { inviteLinkName, LINK_NAME_RE, slug, yymmOf } from "./links.ts";

Deno.test("yymmOf reads as the plan writes it", () => {
  assertEquals(yymmOf(new Date("2026-10-01T00:00:00Z")), "2610");
  assertEquals(yymmOf(new Date("2026-11-30T00:00:00Z")), "2611");
  assertEquals(yymmOf(new Date("2027-01-15T00:00:00Z")), "2701");
});

Deno.test("the built name matches the DB's convention check", () => {
  const name = inviteLinkName("tt", "live", "2610");
  assertEquals(name, "tt-live-2610");
  assertEquals(LINK_NAME_RE.test(name), true);
  assertEquals(LINK_NAME_RE.test(inviteLinkName("swap", "macronews", "2611")), true);
});

Deno.test("campaigns with spaces or caps are slugged", () => {
  assertEquals(inviteLinkName("IG", "Bio Link", "2610"), "ig-bio-link-2610");
});

Deno.test("a name the DB would refuse is not buildable", () => {
  // "live!" slugs to "live", so the result is still legal
  assertEquals(LINK_NAME_RE.test(inviteLinkName("tt", "live!", "2610")), true);
  // an empty part cannot produce a legal name
  assertEquals(LINK_NAME_RE.test(inviteLinkName("", "", "2610")), false);
});

Deno.test("slug keeps dashes and digits, drops the rest", () => {
  assertEquals(slug("Live_Oct 26!"), "liveoct-26");
});

Deno.test("the pattern itself is strict", () => {
  for (const bad of ["TT-live-2610", "tt_live_2610", "tt-live-26", "tt-live-26101", "ttlive2610"]) {
    assertEquals(LINK_NAME_RE.test(bad), false, bad);
  }
});
