/**
 * tg-webhook — every update from the ops bot (plan §9.C, §9.H, §9.I).
 *
 * Auth: `X-Telegram-Bot-Api-Secret-Token` must equal the secret derived from
 * the bot token (tg.deriveWebhookSecret), exactly as printezy does. Telegram
 * is answered 200 fast; failures are logged, never retried by re-raising
 * (Telegram would otherwise replay the same update for hours).
 *
 * Routes:
 *   callback_query   Approve / Edit / Reject / Reschedule buttons (Jack's id only)
 *   message in Desk  Jack's map screenshot + raw lines → gold_map draft;
 *                    "wrap: …" → evening_wrap; reply to a draft → edit
 *   chat_member, my_chat_member, chat_join_request → member_events
 *   message in discussion group → moderation rules (mod_rules, moderation_events)
 *   message_reaction_count → post_snapshots (reactions)
 */
import { HttpError, serve, json } from "_shared/http.ts";
import { requireSecret } from "_shared/auth.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import * as tg from "_shared/tg.ts";
import { createDraft, pushToDesk, resolveShort } from "_shared/content.ts";
import { check as complianceCheck, type PostType } from "_shared/compliance.ts";
import { formatMinutes, mondayOf, parseHoursCommand } from "_shared/hours.ts";
import { logAction } from "_shared/log.ts";
import { readyToApprove, summaryLines, sweepPlan, type SweepItem } from "_shared/batch.ts";

const ACTOR = "ops_bot";

/* ------------------------------ types ------------------------------ */
interface User { id: number; is_bot?: boolean; username?: string; first_name?: string }
interface Chat { id: number; type: string; title?: string }
interface Message {
  message_id: number;
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  video?: { file_id: string };
  reply_to_message?: Message;
  entities?: Array<{ type: string; offset: number; length: number }>;
  caption_entities?: Array<{ type: string }>;
  new_chat_members?: User[];
}
interface ChatMemberUpdated {
  chat: Chat;
  from: User;
  date: number;
  old_chat_member: { status: string; user: User };
  new_chat_member: { status: string; user: User };
  invite_link?: { invite_link: string; name?: string };
  via_join_request?: boolean;
}
interface Update {
  update_id: number;
  message?: Message;
  edited_message?: Message;
  callback_query?: { id: string; from: User; data?: string; message?: Message };
  chat_member?: ChatMemberUpdated;
  my_chat_member?: ChatMemberUpdated;
  chat_join_request?: { chat: Chat; from: User; date: number; invite_link?: { invite_link: string; name?: string } };
  message_reaction_count?: { chat: Chat; message_id: number; date: number; reactions: Array<{ type: { type: string; emoji?: string }; total_count: number }> };
}

/* ------------------------------ helpers ------------------------------ */
async function jackId(): Promise<number> {
  return Number(await requireSetting(SETTING_KEYS.jackTelegramId, "TWINOS_JACK_TELEGRAM_ID"));
}

/** Internal hop to the approve function so the gate lives in one place. */
async function callApprove(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/approve`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "x-twinos-internal": await tg.deriveWebhookSecret(),
    },
    body: JSON.stringify(payload),
  });
  return (await res.json().catch(() => ({ error: "bad_json" }))) as Record<string, unknown>;
}

function largestPhoto(m: Message): string | undefined {
  return m.photo?.length ? m.photo[m.photo.length - 1].file_id : undefined;
}

/* ------------------------------ callback buttons ------------------------------ */
async function onCallback(cq: NonNullable<Update["callback_query"]>): Promise<void> {
  const jack = await jackId();
  // callback_data is client-controlled: only Jack's id may press (ASAP decision.py).
  if (cq.from.id !== jack) {
    await tg.answerCallbackQuery(cq.id, "Only Jack can use these buttons.", true);
    await logAction({ actor: ACTOR, action: "desk.callback_refused", payload: { from: cq.from.id } });
    return;
  }
  const parsed = tg.parseCallback(cq.data ?? "");
  if (!parsed) { await tg.answerCallbackQuery(cq.id, "Unknown button."); return; }

  let content_id: string;
  try { content_id = await resolveShort(parsed.short); } catch (err) {
    // Only a real "not found" is "gone". Anything else is a fault: say so and
    // log it, instead of blaming the draft (a uuid LIKE error hid here once).
    const gone = err instanceof HttpError && err.status === 404;
    if (!gone) {
      await logAction({ actor: ACTOR, action: "desk.callback_failed", payload: { verb: parsed.verb, short: parsed.short, error: String(err).slice(0, 300) } });
    }
    await tg.answerCallbackQuery(cq.id, gone ? "That draft is gone or already handled." : "Something broke on my side. Logged; try again in a minute.", true);
    return;
  }
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;

  switch (parsed.verb) {
    case "ok": {
      const r = await callApprove({ content_id, decision: "approve", via: "telegram", telegram: { user_id: cq.from.id, callback_id: cq.id }, idempotency_key: `cb:${cq.id}` });
      await tg.answerCallbackQuery(cq.id, r.ok ? "Approved. Publishing on schedule." : `Not approved: ${r.message ?? r.error}`, !r.ok);
      if (chat && mid && r.ok) await tg.sendMessage(chat, `✅ Approved <code>#${content_id.slice(0, 8)}</code>`, { parse_mode: "HTML", reply_to_message_id: mid });
      return;
    }
    case "no": {
      const r = await callApprove({ content_id, decision: "reject", via: "telegram", telegram: { user_id: cq.from.id }, idempotency_key: `cb:${cq.id}` });
      await tg.answerCallbackQuery(cq.id, r.ok ? "Rejected." : `Failed: ${r.message ?? r.error}`, !r.ok);
      return;
    }
    case "edit": {
      await admin().from("content_items").update({ desk_state: "awaiting_edit" }).eq("id", content_id);
      await tg.answerCallbackQuery(cq.id);
      if (chat && mid) {
        await tg.sendMessage(chat, `✏️ Reply to the draft with the new text, or a one-liner like <code>soften</code> / <code>BM</code> / <code>shorter</code>.`, { parse_mode: "HTML", reply_to_message_id: mid });
      }
      return;
    }
    case "later": {
      await admin().from("content_items").update({ desk_state: "awaiting_time" }).eq("id", content_id);
      await tg.answerCallbackQuery(cq.id);
      if (chat && mid) {
        await tg.sendMessage(chat, `🕒 Reply with a time, e.g. <code>13:00</code> or <code>tomorrow 08:00</code> (MYT).`, { parse_mode: "HTML", reply_to_message_id: mid });
      }
      return;
    }
    default:
      await tg.answerCallbackQuery(cq.id, "Unknown button.");
  }
}

/* ------------------------------ the Wednesday batch ------------------------------ */
interface BatchRow { id: string; batch_no: number; post_type: string; lang: "en" | "ms"; status: string; scheduled_at: string | null; title: string | null; source: { label?: string } | null }

/** The newest batch that still has something open, with its items in number order. */
async function openBatch(): Promise<{ week: string; items: BatchRow[] } | null> {
  const db = admin();
  const { data: latest } = await db.from("content_items").select("batch_week")
    .not("batch_week", "is", null).order("batch_week", { ascending: false }).limit(1).maybeSingle();
  if (!latest?.batch_week) return null;
  const { data: items } = await db.from("content_items")
    .select("id, batch_no, post_type, lang, status, scheduled_at, title, source")
    .eq("batch_week", latest.batch_week).order("batch_no");
  return items?.length ? { week: latest.batch_week as string, items: items as BatchRow[] } : null;
}

/** `/batch` lists the open batch; `/batch ok` approves what is ready and claim-free. Jack only (the Desk handler already checked). */
async function onBatch(m: Message): Promise<void> {
  const say = (html: string) => tg.sendMessage(m.chat.id, html, { parse_mode: "HTML", reply_to_message_id: m.message_id });
  const arg = (m.text ?? m.caption ?? "").replace(/^\/batch(?:@\w+)?\s*/i, "").trim().toLowerCase();
  const batch = await openBatch();
  if (!batch) { await say("No batch yet. It is drafted on Wednesday at 14:30."); return; }

  const db = admin();
  const ids = batch.items.map((i) => i.id);
  const { data: variants } = await db.from("content_variants")
    .select("content_id, needed_fields, claim_flags, compliance").in("content_id", ids);
  const states: SweepItem[] = batch.items.map((i) => {
    const v = (variants ?? []).find((x) => x.content_id === i.id);
    return {
      id: i.id, n: i.batch_no, status: i.status, when: i.scheduled_at ?? new Date().toISOString(),
      needed: (v?.needed_fields as string[] | null) ?? [], claims: (v?.claim_flags as string[] | null) ?? [],
      blocked: v?.compliance?.ok === false, hasJob: false,
    };
  });

  if (arg === "ok") {
    const jack = await jackId();
    const done: number[] = [];
    const refused: string[] = [];
    for (const s of states) {
      if (!readyToApprove(s)) continue;
      const r = await callApprove({ content_id: s.id, decision: "approve", via: "telegram", telegram: { user_id: jack }, idempotency_key: `batch-ok:${s.id}` });
      if (r.ok) done.push(s.n); else refused.push(`${s.n} (${tg.escapeHtml(String(r.message ?? r.error))})`);
    }
    const left = sweepPlan(states.filter((s) => !done.includes(s.n)), new Date(0)).nudge
      .filter((n) => n.why !== "ready: /batch ok");
    await say([
      done.length ? `✅ Approved ${done.join(", ")}. They go out at their slot.` : "Nothing was ready to approve.",
      ...(refused.length ? [`⚠️ Not approved: ${refused.join("; ")}`] : []),
      ...(left.length ? ["Still waiting on you:", ...left.map((n) => `${n.n}. ${n.why}`)] : []),
    ].join("\n"));
    await logAction({ actor: "jack", action: "batch.ok", payload: { approved: done, refused: refused.length } });
    return;
  }

  const asItems = batch.items.map((i) => ({
    n: i.batch_no, post_type: i.post_type as "lesson", pillar: null, label: i.source?.label ?? i.post_type,
    title: i.title, when: i.scheduled_at ?? new Date().toISOString(), dow: 0,
  }));
  const needed = new Map(states.map((s) => [s.n, s.needed] as [number, string[]]));
  const lines = summaryLines(asItems, needed, (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur")
    .map((line, idx) => `${line} [${batch.items[idx].status}]`);
  await say([`<b>Batch</b> · week of ${batch.week}`, "", ...lines, "", "<code>N: the text</code> fills or edits one. <code>/batch ok</code> approves what is ready."].join("\n"));
}

/* ------------------------------ Desk group input ------------------------------ */
function parseTime(text: string, tz: string): string | null {
  const m = /^(?:(today|tomorrow|esok)\s+)?(\d{1,2}):(\d{2})$/i.exec(text.trim());
  if (!m) return null;
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = now.getTime() - local.getTime();
  const d = new Date(local);
  if (/tomorrow|esok/i.test(m[1] ?? "")) d.setDate(d.getDate() + 1);
  d.setHours(Number(m[2]), Number(m[3]), 0, 0);
  if (!m[1] && d.getTime() <= local.getTime()) d.setDate(d.getDate() + 1);
  return new Date(d.getTime() + offsetMs).toISOString();
}

const HELP_TEXT = [
  "<b>EzyMap Desk</b>",
  "Send the chart screenshot and 3-5 raw lines for the morning map. Start a line with <code>wrap:</code> for the evening wrap. End with <code>BM</code> for Malay.",
  "Reply to a draft with new text to edit it, or with a time like <code>13:00</code> to reschedule.",
  "",
  "/status - anything broken?",
  "/friday - this week's Friday numbers so far",
  "/batch - the Wednesday batch (<code>/batch ok</code> approves what is ready and claim-free)",
  "/hours &lt;task&gt; &lt;minutes&gt; [note] - log what a task cost by hand",
  "/hours today - today's total and the week so far",
  "/help - this message",
].join("\n");

/** Slash commands in the Desk group (Jack only; read-only). */
async function onDeskCommand(m: Message, cmd: string): Promise<void> {
  const say = (html: string) => tg.sendMessage(m.chat.id, html, { parse_mode: "HTML", reply_to_message_id: m.message_id });
  const db = admin();

  if (cmd === "status") {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [{ data: beats }, { count: openAlerts }] = await Promise.all([
      db.from("health_checks").select("source, status, at").gte("at", since).order("at", { ascending: false }).limit(100),
      db.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    ]);
    const latest = new Map<string, { status: string; at: string }>();
    for (const b of beats ?? []) if (b.source && !latest.has(b.source)) latest.set(b.source, { status: b.status, at: b.at });
    const lines = [...latest.entries()].map(([src, b]) => {
      const mins = Math.max(0, Math.round((Date.now() - new Date(b.at).getTime()) / 60_000));
      return `${b.status === "ok" ? "✅" : "⚠️"} ${tg.escapeHtml(src)}: ${tg.escapeHtml(b.status)}, ${mins} min ago`;
    });
    await say([
      "<b>Status</b>",
      ...(lines.length ? lines : ["No health beats in the last 15 minutes."]),
      `Open alerts: ${openAlerts ?? 0}`,
    ].join("\n"));
    return;
  }

  if (cmd === "friday") {
    const { data: w } = await db.from("v_friday_scoreboard")
      .select("week_start, channel_members, net_joins, signals_posted, results_posted, strict_win_rate_4w, total_r_4w")
      .order("week_start", { ascending: false }).limit(1).maybeSingle();
    if (!w) { await say("No scoreboard data yet."); return; }
    const n = (v: unknown) => (v === null || v === undefined ? "-" : String(v));
    await say([
      `<b>Friday numbers, week of ${tg.escapeHtml(String(w.week_start))}</b>`,
      `Members: ${n(w.channel_members)} (net joins ${n(w.net_joins)})`,
      `Signals posted: ${n(w.signals_posted)}, with results: ${n(w.results_posted)}`,
      `Strict win rate (4 weeks): ${n(w.strict_win_rate_4w)}%, total R: ${n(w.total_r_4w)}`,
      "TikTok and Vantage numbers are entered by hand.",
    ].join("\n"));
    return;
  }

  if (cmd === "hours") { await onHours(m); return; }
  if (cmd === "batch") { await onBatch(m); return; }

  if (cmd === "help" || cmd === "start") { await say(HELP_TEXT); return; }
  await say(`I don't know /${tg.escapeHtml(cmd)}.\n\n${HELP_TEXT}`);
}

/**
 * `/hours` — the Week-1 baseline log (decision 6). Jack only: every command in
 * the Desk already passed the jack-id check in onDeskMessage.
 */
async function onHours(m: Message): Promise<void> {
  const say = (html: string) => tg.sendMessage(m.chat.id, html, { parse_mode: "HTML", reply_to_message_id: m.message_id });
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  const parsed = parseHoursCommand(m.text ?? "");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD in MYT
  const week = mondayOf(day);
  const db = admin();

  if (parsed.kind === "bad") { await say(`✏️ ${tg.escapeHtml(parsed.error)}`); return; }

  if (parsed.kind === "log") {
    const { error } = await db.from("baseline_hours").insert({
      week_start: week, day, task: parsed.task, minutes: parsed.minutes, note: parsed.note, logged_by: "jack",
    });
    if (error) { await say(`⚠️ Could not log that: ${tg.escapeHtml(error.message)}`); return; }
    await logAction({ actor: "jack", action: "baseline.hours", payload: { task: parsed.task, minutes: parsed.minutes, day, week } });
    await say(`✅ Logged <b>${formatMinutes(parsed.minutes)}</b> on <b>${tg.escapeHtml(parsed.task)}</b> for ${day}${parsed.note ? ` — ${tg.escapeHtml(parsed.note)}` : ""}.`);
    return;
  }

  const { data } = await db.from("baseline_hours").select("task, minutes").eq("day", day);
  const byTask = new Map<string, number>();
  for (const r of data ?? []) byTask.set(r.task as string, (byTask.get(r.task as string) ?? 0) + Number(r.minutes));
  const todayTotal = [...byTask.values()].reduce((a, b) => a + b, 0);

  const { data: wk } = await db.from("baseline_hours").select("minutes").eq("week_start", week);
  const weekTotal = (wk ?? []).reduce((a, r) => a + Number(r.minutes), 0);

  const lines = [...byTask.entries()].sort((a, b) => b[1] - a[1]).map(([t, min]) => `· ${tg.escapeHtml(t)}: ${formatMinutes(min)}`);
  await say([
    `<b>Hours — ${day}</b>`,
    ...(lines.length ? lines : ["Nothing logged today yet."]),
    "",
    `Today: <b>${formatMinutes(todayTotal)}</b> · week of ${week}: <b>${formatMinutes(weekTotal)}</b>`,
    "Log with <code>/hours &lt;task&gt; &lt;minutes&gt; [note]</code>.",
  ].join("\n"));
}

async function onDeskMessage(m: Message): Promise<void> {
  const jack = await jackId();
  if (m.from?.id !== jack) return; // only Jack's inputs become drafts (plan §6: AI only on Jack's own inputs)
  const text = (m.text ?? m.caption ?? "").trim();
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";

  const command = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text);
  if (command) { await onDeskCommand(m, command[1].toLowerCase()); return; }

  // Reply to a draft message → edit or reschedule
  const replyId = m.reply_to_message?.message_id;
  if (replyId) {
    const { data: item } = await admin().from("content_items")
      .select("id, desk_state, post_type, lang").eq("desk_message_id", replyId).maybeSingle();
    if (item) {
      if (item.desk_state === "awaiting_time" || parseTime(text, tz)) {
        const when = parseTime(text, tz);
        if (!when) { await tg.sendMessage(m.chat.id, "I need a time like 13:00.", { reply_to_message_id: m.message_id }); return; }
        const r = await callApprove({ content_id: item.id, decision: "reschedule", run_at: when, via: "telegram", telegram: { user_id: jack } });
        await tg.sendMessage(m.chat.id, r.ok ? `🕒 Rescheduled to ${text}` : `Failed: ${r.message ?? r.error}`, { reply_to_message_id: m.message_id });
        return;
      }
      await applyEdit(item.id, item.post_type as PostType, item.lang, text, m);
      return;
    }
  }

  // "N: instruction" without a reply → edit the N-th draft of the day (kit's Wednesday flow)
  const numbered = /^(\d{1,2})\s*:\s*(.+)$/s.exec(text);
  if (numbered) {
    const n = Number(numbered[1]);
    // The open Wednesday batch has its own stable numbers (content_items.batch_no).
    const open = await openBatch();
    const inBatch = open?.items.find((i) => i.batch_no === n);
    if (inBatch) {
      await applyEdit(inBatch.id, inBatch.post_type as PostType, inBatch.lang, numbered[2], m);
      return;
    }
    const { data: todays } = await admin().from("content_items")
      .select("id, post_type, lang").gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .in("status", ["draft", "pending_approval"]).order("created_at", { ascending: true });
    const target = todays?.[n - 1];
    if (!target) { await tg.sendMessage(m.chat.id, `No draft #${n} today.`, { reply_to_message_id: m.message_id }); return; }
    await applyEdit(target.id, target.post_type as PostType, target.lang, numbered[2], m);
    return;
  }

  if (!text && !m.photo) return;

  // Evening line → evening wrap (template 11); otherwise the morning map (template 1).
  const isWrap = /^wrap\s*:/i.test(text) || (!m.photo && new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getHours() >= 18);
  const post_type: PostType = isWrap ? "evening_wrap" : "gold_map";
  const lang = /\b(?:bm|ms)\b\s*$/i.test(text) ? "ms" : "en";
  const raw = text.replace(/^wrap\s*:/i, "").replace(/\b(?:bm|ms)\b\s*$/i, "").trim();
  const numbers = (raw.match(/\b\d{3,5}(?:\.\d{1,2})?\b/g) ?? []).map(Number);
  const photo = largestPhoto(m);

  let draft: Awaited<ReturnType<typeof createDraft>>;
  try {
    draft = await createDraft({
      post_type,
      lang,
      fields: { raw_notes: raw, date: new Date().toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }) },
      allowed_numbers: numbers,
      media: photo ? [{ kind: "photo", file_id: photo }] : undefined,
      source: { via: "desk", message_id: m.message_id, chat_id: m.chat.id },
      actor: ACTOR,
    });
  } catch (err) {
    // Say so in the Desk instead of staying silent, then let the entry point log it.
    const why = err instanceof Error ? err.message : String(err);
    await tg.sendMessage(m.chat.id, `⚠️ I couldn't draft that: ${tg.escapeHtml(why.slice(0, 200))}`, {
      parse_mode: "HTML", reply_to_message_id: m.message_id,
    });
    throw err;
  }
  // The 08:00 slot for maps, now for wraps (plan §4.4).
  if (post_type === "gold_map") {
    const slot = parseTime("08:00", tz);
    await admin().from("content_items").update({ scheduled_at: slot }).eq("id", draft.content_id);
  }
  await pushToDesk(draft, { heading: post_type === "gold_map" ? "Gold map" : "Evening wrap", photo, actor: ACTOR });
}

/** Apply an edit: raw replacement text, or a short instruction → rendered as a note for ABDUL's rewrite job. */
async function applyEdit(content_id: string, post_type: PostType, lang: "en" | "ms", instruction: string, m: Message) {
  const db = admin();
  const { data: v } = await db.from("content_variants").select("id, body, platform").eq("content_id", content_id).limit(1).maybeSingle();
  if (!v) return;
  const short = instruction.length <= 40 && !/\n/.test(instruction);
  if (short) {
    // Short instruction: queue a rewrite job for ABDUL / the PC worker (Phase 2 voice module).
    await db.from("jobs").insert({ kind: "rewrite", payload: { content_id, variant_id: v.id, instruction, lang }, status: "queued", created_by: ACTOR });
    await db.from("content_items").update({ desk_state: null, edit_note: instruction }).eq("id", content_id);
    await tg.sendMessage(m.chat.id, `✏️ Noted: "${tg.escapeHtml(instruction)}". A rewrite is queued; you'll get the new draft here.`, { parse_mode: "HTML", reply_to_message_id: m.message_id });
    return;
  }
  const result = complianceCheck({ post_type, platform: v.platform, lang, body: instruction });
  await db.from("content_variants").update({ body: instruction, compliance: result, claim_flags: result.claim_flags, needed_fields: [] }).eq("id", v.id);
  await db.from("compliance_checks").insert({ variant_id: v.id, ok: result.ok, needs_approval: result.needs_approval, findings: result.findings });
  await db.from("content_items").update({ desk_state: null, status: "draft" }).eq("id", content_id);
  await logAction({ actor: "jack", action: "content.edit", target: content_id, payload: { via: "desk" } });
  await pushToDesk({ content_id, variant_id: v.id, body: instruction, status: "draft", compliance: result, needed: [] }, { heading: "Edited draft", actor: ACTOR });
}

/* ------------------------------ membership ------------------------------ */
async function onMember(u: ChatMemberUpdated, kind: "chat_member" | "my_chat_member") {
  await admin().from("member_events").insert({
    chat_id: u.chat.id,
    user_id: u.new_chat_member.user.id,
    username: u.new_chat_member.user.username ?? null,
    event: kind,
    old_status: u.old_chat_member.status,
    new_status: u.new_chat_member.status,
    invite_link: u.invite_link?.invite_link ?? null,
    invite_link_name: u.invite_link?.name ?? null,
    via_join_request: u.via_join_request ?? false,
    at: new Date(u.date * 1000).toISOString(),
  });
}

async function onJoinRequest(r: NonNullable<Update["chat_join_request"]>) {
  await admin().from("member_events").insert({
    chat_id: r.chat.id, user_id: r.from.id, username: r.from.username ?? null, event: "chat_join_request",
    old_status: null, new_status: "requested", invite_link: r.invite_link?.invite_link ?? null,
    invite_link_name: r.invite_link?.name ?? null, at: new Date(r.date * 1000).toISOString(),
  });
  // TODO(phase4): CAS check + captcha before approveChatJoinRequest (plan §9.I.72–73).
}

/* ------------------------------ discussion group moderation ------------------------------ */
async function onDiscussionMessage(m: Message) {
  const db = admin();
  const text = m.text ?? m.caption ?? "";
  const { data: rules } = await db.from("mod_rules").select("id, kind, pattern, action, enabled").eq("enabled", true);
  const hasLink = /(?:https?:\/\/|t\.me\/|@[a-z0-9_]{5,})/i.test(text) ||
    (m.entities ?? []).some((e) => e.type === "url" || e.type === "text_link" || e.type === "mention");
  const hits: Array<{ rule: string; action: string }> = [];
  for (const r of rules ?? []) {
    if (r.kind === "keyword" && r.pattern && new RegExp(r.pattern, "i").test(text)) hits.push({ rule: r.id, action: r.action });
    if (r.kind === "link_new_member" && hasLink) {
      const { count } = await db.from("member_events").select("id", { count: "exact", head: true })
        .eq("chat_id", m.chat.id).eq("user_id", m.from?.id ?? 0).eq("new_status", "member")
        .gte("at", new Date(Date.now() - 7 * 86400_000).toISOString());
      if ((count ?? 0) > 0) hits.push({ rule: r.id, action: r.action });
    }
    if (r.kind === "impersonation" && m.from && /\b(?:jack|ezymap)\b/i.test(`${m.from.first_name ?? ""} ${m.from.username ?? ""}`)) {
      hits.push({ rule: r.id, action: "flag" });
    }
  }
  if (!hits.length) return;
  await db.from("moderation_events").insert({
    chat_id: m.chat.id, user_id: m.from?.id ?? null, message_id: m.message_id,
    hits, text_excerpt: text.slice(0, 200), at: new Date(m.date * 1000).toISOString(),
  });
  const strongest = hits.map((h) => h.action).includes("ban") ? "ban" : hits.map((h) => h.action).includes("mute") ? "mute" : hits.map((h) => h.action).includes("delete") ? "delete" : "flag";
  try {
    if (strongest === "delete" || strongest === "mute" || strongest === "ban") await tg.deleteMessage(m.chat.id, m.message_id);
    if (strongest === "mute" && m.from) await tg.restrictChatMember(m.chat.id, m.from.id, Math.floor(Date.now() / 1000) + 3600);
    if (strongest === "ban" && m.from) await tg.banChatMember(m.chat.id, m.from.id);
  } catch (err) {
    console.warn("[moderation] action failed", err);
  }
  // No AI on group text (plan §6): only pattern rules, only the excerpt stored.
}

/* ------------------------------ reactions ------------------------------ */
async function onReactions(r: NonNullable<Update["message_reaction_count"]>) {
  const total = r.reactions.reduce((n, x) => n + x.total_count, 0);
  await admin().from("post_snapshots").insert({
    chat_id: r.chat.id, message_id: r.message_id, kind: "reactions", value: total,
    detail: r.reactions, at: new Date(r.date * 1000).toISOString(),
  });
}

/* ------------------------------ entry ------------------------------ */
serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, fn: "tg-webhook" });
  requireSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", await tg.deriveWebhookSecret(), "telegram");

  const update = (await req.json().catch(() => null)) as Update | null;
  if (!update || typeof update.update_id !== "number") return json({ ok: true });

  // De-dupe: Telegram re-sends on any non-200; store the id and ignore repeats.
  const { error: dup } = await admin().from("tg_updates").insert({ update_id: update.update_id });
  if (dup && /duplicate|unique/i.test(dup.message)) return json({ ok: true, duplicate: true });

  const deskId = Number((await setting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID")) ?? 0);
  const discussionId = Number((await setting(SETTING_KEYS.discussionChatId, "TWINOS_DISCUSSION_CHAT_ID")) ?? 0);

  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.chat_member) await onMember(update.chat_member, "chat_member");
    else if (update.my_chat_member) await onMember(update.my_chat_member, "my_chat_member");
    else if (update.chat_join_request) await onJoinRequest(update.chat_join_request);
    else if (update.message_reaction_count) await onReactions(update.message_reaction_count);
    else if (update.message) {
      const m = update.message;
      if (deskId && m.chat.id === deskId) await onDeskMessage(m);
      else if (discussionId && m.chat.id === discussionId) await onDiscussionMessage(m);
      // Any other chat: ignored on purpose (no DMs, no other groups).
    }
    await admin().from("health_checks").insert({ source: "ops_bot", status: "ok", detail: { update_id: update.update_id } });
  } catch (err) {
    console.error("[tg-webhook] handler failed", err);
    await logAction({ actor: ACTOR, action: "tg.update_failed", payload: { update_id: update.update_id, error: String(err).slice(0, 300) } });
  }
  return json({ ok: true });
});
