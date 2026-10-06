import { assertEquals } from "std/assert/mod.ts";
import { csvCell, toCsv } from "./csv.ts";

Deno.test("csvCell: the four characters that break a row are quoted, and quotes are doubled", () => {
  assertEquals(csvCell("plain"), "plain");
  assertEquals(csvCell("a,b"), '"a,b"');
  assertEquals(csvCell('say "hi"'), '"say ""hi"""');
  assertEquals(csvCell("two\nlines"), '"two\nlines"');
  assertEquals(csvCell(null), "");
  assertEquals(csvCell(undefined), "");
  assertEquals(csvCell(0), "0");
  assertEquals(csvCell(false), "false");
});

Deno.test("csvCell: a cell a spreadsheet would execute is defused, a negative number is not", () => {
  assertEquals(csvCell("=1+1"), "'=1+1", "the guard alone, nothing to quote");
  // guarded first, then quoted: the apostrophe rides inside the quotes
  assertEquals(csvCell('=HYPERLINK("http://x","click")'), '"\'=HYPERLINK(""http://x"",""click"")"');
  assertEquals(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assertEquals(csvCell("+1"), "'+1");
  assertEquals(csvCell("\tstarts with a tab"), "'\tstarts with a tab");
  assertEquals(csvCell("-2.5"), "-2.5", "a minus is how numbers are written, not a formula");
});

Deno.test("toCsv: a header, one row per record, CRLF, and the columns in the given order", () => {
  const csv = toCsv([
    { b: "2", a: "1" },
    { b: "x,y", a: null },
  ], ["a", "b"]);
  assertEquals(csv, "a,b\r\n1,2\r\n,\"x,y\"\r\n");
});

Deno.test("toCsv: no rows still produces the header, and a union of keys when none is given", () => {
  assertEquals(toCsv([], ["a", "b"]), "a,b\r\n");
  assertEquals(toCsv([{ a: "1", b: "2" }]), "a,b\r\n1,2\r\n");
});
