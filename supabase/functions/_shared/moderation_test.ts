import { assert, assertEquals } from "std/assert/mod.ts";
import {
  casBanned, evaluate, isQuestion, ladder, matchRepeat, type ModRule, normalizeQuestion, similarity,
} from "./moderation.ts";

const RULES: ModRule[] = [
  { key: "scam_keywords_en", kind: "keyword", patterns: ["dm me for signals", "guaranteed profit", "vip signals"], params: { match: "substring" }, action: "warn_mute_ban", enabled: true },
  { key: "scam_keywords_ms", kind: "keyword", patterns: ["pasti untung", "jamin untung"], params: {}, action: "warn_mute_ban", enabled: true },
  { key: "link_block_new_members", kind: "link_block", patterns: ["https?://", "t\\.me/", "@[A-Za-z0-9_]{5,}"],
    params: { new_member_hours: 24, allow_domains: ["t.me/ezymap", "printezy.money"], regex: true }, action: "delete", enabled: true },
  { key: "flood", kind: "flood", patterns: [], params: { max_msgs: 5, window_s: 10, mute_minutes: 10 }, action: "mute", enabled: true },
  { key: "impersonation", kind: "impersonation", patterns: ["jack", "ezymap", "ezyregister", "ezy map", "ezymap admin"], params: {}, action: "flag", enabled: true },
  { key: "off", kind: "keyword", patterns: ["hello"], params: {}, action: "ban", enabled: false },
];

const NOW = Date.parse("2026-10-20T12:00:00Z");
const hoursAgo = (h: number) => NOW - h * 3_600_000;
const ctx = (over: Record<string, unknown> = {}) => ({
  text: "Gold held 4590 today", hasLinkEntity: false,
  from: { id: 1, first_name: "Aisha", username: "aisha_trades" },
  joinedAt: hoursAgo(24 * 5), recent: 1, isAdmin: false, now: NOW, ...over,
});

Deno.test("ladder: warn, then a day's mute, then ban", () => {
  assertEquals(ladder(0), { action: "warn", muteSeconds: 0 });
  assertEquals(ladder(1), { action: "mute", muteSeconds: 86_400 });
  assertEquals(ladder(2), { action: "ban", muteSeconds: 0 });
  assertEquals(ladder(9), { action: "ban", muteSeconds: 0 });
});

Deno.test("evaluate: ordinary talk passes, disabled rules never fire", () => {
  assertEquals(evaluate(ctx(), RULES, 0).hits, []);
  assertEquals(evaluate(ctx({ text: "hello" }), RULES, 0).final, null);
});

Deno.test("evaluate: a scam phrase warns first, mutes on the second strike, bans on the third", () => {
  const text = "DM me for signals, guaranteed profit!!";
  const first = evaluate(ctx({ text }), RULES, 0);
  assertEquals(first.hits[0].rule, "scam_keywords_en");
  assertEquals(first.final, "warn");
  assertEquals(first.deleteMessage, true);
  const second = evaluate(ctx({ text }), RULES, 1);
  assertEquals(second.final, "mute");
  assertEquals(second.muteSeconds, 86_400);
  assertEquals(evaluate(ctx({ text }), RULES, 2).final, "ban");
});

Deno.test("evaluate: Malay scam phrases count too, whatever the case", () => {
  assertEquals(evaluate(ctx({ text: "PASTI UNTUNG bro" }), RULES, 0).hits[0].rule, "scam_keywords_ms");
});

Deno.test("evaluate: a new member's link is deleted, an established member's is not", () => {
  const link = "check https://example.com/x";
  assertEquals(evaluate(ctx({ text: link, joinedAt: hoursAgo(2) }), RULES, 0).final, "delete");
  assertEquals(evaluate(ctx({ text: link, joinedAt: hoursAgo(24 * 3) }), RULES, 0).final, null);
  assertEquals(evaluate(ctx({ text: link, joinedAt: null }), RULES, 0).final, null); // join time unknown: not a new member
});

Deno.test("evaluate: our own domains pass for a new member; a handle does not", () => {
  const fresh = { joinedAt: hoursAgo(1) };
  assertEquals(evaluate(ctx({ text: "see t.me/ezymap and printezy.money", ...fresh }), RULES, 0).final, null);
  assertEquals(evaluate(ctx({ text: "join t.me/ezymap or https://evil.example", ...fresh }), RULES, 0).final, "delete");
  assertEquals(evaluate(ctx({ text: "dm @scammer_handle", ...fresh }), RULES, 0).final, "delete");
  assertEquals(evaluate(ctx({ text: "look", hasLinkEntity: true, ...fresh }), RULES, 0).final, "delete");
});

Deno.test("evaluate: more than five messages in ten seconds is a ten-minute mute", () => {
  const r = evaluate(ctx({ recent: 6 }), RULES, 0);
  assertEquals(r.final, "mute");
  assertEquals(r.muteSeconds, 600);
  assertEquals(evaluate(ctx({ recent: 5 }), RULES, 0).final, null);
});

Deno.test("evaluate: a name that borrows Jack's or EzyMap's is flagged, lookalike letters included", () => {
  const flagged = (first_name: string, username?: string) =>
    evaluate(ctx({ from: { id: 7, first_name, username } }), RULES, 0).hits.some((h) => h.rule === "impersonation");
  assert(flagged("EzyMap Support", "ezymap_help"));
  assert(flagged("Ezy Map Admin"));
  assert(flagged("Jаck", "jack_trades")); // Cyrillic а
  assert(flagged("Ezymapp")); // one letter off
  assert(!flagged("Aisha", "aisha_trades"));
  assert(!flagged("Jackson")); // a different name, not a copy
});

Deno.test("evaluate: admins are never moderated, and a flag alone deletes nothing", () => {
  assertEquals(evaluate(ctx({ text: "guaranteed profit", isAdmin: true }), RULES, 0).final, null);
  const flag = evaluate(ctx({ from: { id: 7, first_name: "EzyMap Support" } }), RULES, 0);
  assertEquals(flag.final, "flag");
  assertEquals(flag.deleteMessage, false);
});

Deno.test("evaluate: the strongest action wins when several rules hit", () => {
  const r = evaluate(ctx({ text: "guaranteed profit https://x.example", joinedAt: hoursAgo(1) }), RULES, 1);
  assertEquals(r.hits.length, 2);
  assertEquals(r.final, "mute");
});

Deno.test("casBanned: only an ok:true answer from the CAS API means banned", () => {
  assertEquals(casBanned({ ok: true, result: { offenses: 2 } }), true);
  assertEquals(casBanned({ ok: false, description: "Record not found." }), false);
  assertEquals(casBanned(null), false);
  assertEquals(casBanned("nonsense"), false);
});

Deno.test("isQuestion: a question mark, or an English or Malay opener", () => {
  assert(isQuestion("How do I set my stop loss?"));
  assert(isQuestion("how to set stop loss"));
  assert(isQuestion("berapa harga pro"));
  assert(isQuestion("boleh tak guna demo dulu"));
  assert(isQuestion("price?"));
  assert(!isQuestion("Gold is up today"));
});

Deno.test("normalizeQuestion and similarity: the same question in other words is close, a different one is not", () => {
  const a = normalizeQuestion("How do I set my STOP loss??");
  const b = normalizeQuestion("how to set stop-loss");
  assertEquals(similarity(a, b) >= 0.8, true);
  assertEquals(similarity(a, normalizeQuestion("What is the price of the pro plan")) < 0.3, true);
  assertEquals(similarity("", ""), 0);
});

Deno.test("matchRepeat: finds the earlier question this one repeats", () => {
  const seen = [
    { detail: normalizeQuestion("what is the price of the pro plan"), n: 1 },
    { detail: normalizeQuestion("how do I set my stop loss"), n: 1 },
  ];
  assertEquals(matchRepeat(seen, "how to set stop-loss?", 0.8)?.n, 1);
  assertEquals(matchRepeat(seen, "where do I find the link", 0.8), null);
});
