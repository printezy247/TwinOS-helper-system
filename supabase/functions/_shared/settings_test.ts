import { assertEquals } from "std/assert/mod.ts";
import { settingText } from "./settings.ts";

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
