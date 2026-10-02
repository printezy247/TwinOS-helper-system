import { assertEquals } from "std/assert/mod.ts";
import { settingBool, settingId, settingNumber, settingText } from "./settings.ts";

// settings.value is jsonb: a Telegram id comes back from supabase-js as a JS
// number. approve compared it to a string and refused every Desk tap (403).
Deno.test("settingText: a jsonb number is its digits, so ids compare as text", () => {
  assertEquals(settingText(6282941580), "6282941580");
  assertEquals(settingText(-1002115807571), "-1002115807571");
});

Deno.test("settingText: strings stay as they are; nothing stays null", () => {
  assertEquals(settingText("Asia/Kuala_Lumpur"), "Asia/Kuala_Lumpur");
  assertEquals(settingText(null), null);
  assertEquals(settingText(undefined), null);
});

Deno.test("settingText: booleans and objects become their JSON text", () => {
  assertEquals(settingText(true), "true");
  assertEquals(settingText({ a: 1 }), '{"a":1}');
});

Deno.test("settingId: ids stay digit text; floats and junk read as unset", () => {
  assertEquals(settingId(6282941580), "6282941580");
  assertEquals(settingId(-1002115807571), "-1002115807571");
  assertEquals(settingId("6282941580"), "6282941580");
  assertEquals(settingId(1.5), null);
  assertEquals(settingId("abc"), null);
  assertEquals(settingId(""), null);
  assertEquals(settingId(null), null);
});

Deno.test("settingNumber: finite numbers pass, junk reads as unset", () => {
  assertEquals(settingNumber(48), 48);
  assertEquals(settingNumber("48"), 48);
  assertEquals(settingNumber("abc"), null);
  assertEquals(settingNumber(Number.NaN), null);
  assertEquals(settingNumber(null), null);
});

Deno.test("settingBool: real booleans and their text pass, junk reads as unset", () => {
  assertEquals(settingBool(true), true);
  assertEquals(settingBool("false"), false);
  assertEquals(settingBool("yes"), null);
  assertEquals(settingBool(1), null);
  assertEquals(settingBool(null), null);
});
