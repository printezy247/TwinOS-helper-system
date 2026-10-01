/**
 * Every seeded post template must render, with realistic fields, into a post
 * that passes the compliance engine (no blocking finding). This is the join the
 * unit tests cannot see: the seed's skeletons and locked brand lines, the
 * renderer, and the checklist. CI feeds it the rows from a migrated database:
 *
 *   psql "$DATABASE_URL" -At -f tests/templates_dump.sql > templates.json
 *   deno run --allow-read --config supabase/functions/deno.json tests/check_templates.ts templates.json
 */
import { render, requiredLineFacts, pickLines } from "../supabase/functions/_shared/content.ts";
import { check, type Lang, type PostType } from "../supabase/functions/_shared/compliance.ts";

interface Row { key: PostType; body: string | null; fields_list: string[] | null; required_lines: string[] | null }
const dump = JSON.parse(await Deno.readTextFile(Deno.args[0])) as { templates: Row[]; brand_facts: Array<{ key: string; body: string }> };
const facts = new Map(dump.brand_facts.map((f) => [f.key, f.body]));

// What the callers pass (tg-webhook, tv-webhook, results, friday) or what ABDUL supplies.
const SAMPLE: Record<PostType, Record<string, unknown>> = {
  gold_map: { date: "Fri 2 Oct", raw_notes: "Buyers in control above 4012.\nBuy reactions in S1, targets 4046 then 4070.\nBelow 4000 the idea is wrong." },
  macro_card: { date: "Fri 2 Oct", events: "- 20:30 US Retail Sales (high impact)", gold_read: "a strong number usually lifts the dollar and pressures gold short term." },
  signal_card: { n: 3, symbol: "XAUUSD", direction: "BUY", direction_emoji: "🟢", timeframe: "M15", entry: "4014–4017", sl: 4006, tp1: 4030, tp2: 4046, counter_trend_line: "⚠️ COUNTER-TREND" },
  result_reply: { outcome: "TP1 hit", result_r: 1.5, symbol: "XAUUSD", direction: "BUY" },
  lesson: { label: "LESSON", title: "Where your stop really goes", text: "Put the stop beyond the structure that proves you wrong, then size the lot so the distance equals 1% of the account." },
  channel_audit: { title: "The 95% win rate", text: "How a channel gets to 95%: it moves every stop to entry early and deletes the trades that hit the stop.", wins: 11, losses: 6, total_r: 9.4 },
  scorecard: { week: "2026-09-28", signals: 8, wins: 4, losses: 2, break_even: 2, wl: 6, strict_win_rate: 66.7, total_r: 5.1, best: "XAUUSD buy +2.4R", worst: "XAUUSD buy -1R", board_url: "https://printezy.money/ezyai" },
  outlook: { dates: "5 to 9 Oct", last_week: "Gold closed the week near the top of its range.", support: "3980 - 3995", resistance: "4085 - 4100", events: "CPI Wed 20:30", plan: "buy dips into support while it holds, no chasing into CPI." },
  offer: { offer_text: "Prefer to keep your own broker? Every EzyMap tool can be bought directly: MT5 tools from $9/month." },
  poll: { question: "What's your biggest problem right now?", options: "- Entering too early\n- Moving my stop\n- Overtrading" },
  evening_wrap: { raw_notes: "The S1 zone held and gave the TP1 move. Tomorrow I watch whether 4046 flips to support." },
  news_alert: { minutes: 30, event: "US CPI", time: "20:30" },
  member_result: { tier: "Premium", quote: "Stopped chasing entries, waited for the zone. 3 trades this week, 2 wins, 1 loss." },
  holiday: { text: "Markets are thin today for the Deepavali holiday. No map, no signals. Back tomorrow at 8am." },
  start_here: { free_list: "- Gold map every day at 8am\n- 1-2 signals with every result posted\n- Lessons, weekly scorecard, Sunday outlook" },
};
const LONG_FORM: PostType[] = ["lesson", "start_here", "channel_audit"];

let failures = 0;
for (const t of dump.templates.sort((a, b) => a.key.localeCompare(b.key))) {
  const problems: string[] = [];
  if (!t.body) { console.log(`FAIL ${t.key}: no body`); failures++; continue; }
  const sample = SAMPLE[t.key];
  const required = (t.fields_list ?? []);
  const used = new Set([...t.body.matchAll(/\{\{\s*(\??)([a-zA-Z0-9_.]+)\s*\}\}/g)].filter((m) => !m[1]).map((m) => m[2]));
  for (const f of required) if (!used.has(f)) problems.push(`fields_list names ${f}, which the body never uses`);
  for (const f of used) if (!required.includes(f)) problems.push(`body requires {{${f}}} but fields_list omits it`);

  for (const lang of ["en", "ms"] as Lang[]) {
    const lines = pickLines(requiredLineFacts(t.required_lines ?? [], t.key), lang, facts);
    const { body, needed } = render({ body: t.body, fields: required, required_lines: lines }, sample);
    if (needed.length) problems.push(`${lang}: [NEEDED] ${needed.join(", ")}`);
    const allowed = Object.values(sample).flatMap((v) => String(v).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const res = check({
      post_type: t.key, platform: "telegram", lang, body, allowed_numbers: allowed,
      long_form: LONG_FORM.includes(t.key), permission_recorded: t.key === "member_result",
    });
    for (const f of res.findings.filter((x) => x.severity === "blocking")) problems.push(`${lang}: ${f.check}: ${f.message}${f.evidence ? ` (${f.evidence.join(", ")})` : ""}`);
    if (lang === "en" && Deno.env.get("SHOW")) console.log(`--- ${t.key}\n${body}\n[approval: ${res.needs_approval}; claims: ${res.claim_flags.join(",") || "-"}]`);
  }
  if (problems.length) { failures += problems.length; console.log(`FAIL ${t.key}\n  - ${problems.join("\n  - ")}`); }
  else console.log(`ok   ${t.key}`);
}
if (dump.templates.length !== 15) { console.log(`FAIL expected 15 templates, found ${dump.templates.length}`); failures++; }
console.log(failures ? `\n${failures} problem(s)` : "\nall 15 templates render and pass the compliance engine");
Deno.exit(failures ? 1 : 0);
