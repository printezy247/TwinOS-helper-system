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
import { serve, json } from "_shared/http.ts";
import { requireSecret } from "_shared/auth.ts";
import { admin, requireSetting, setting, SETTING_KEYS } from "_shared/supabase.ts";
import * as tg from "_shared/tg.ts";
import { createDraft, pushToDesk, resolveShort } from "_shared/content.ts";
import { check as complianceCheck, type PostType } from "_shared/compliance.ts";
import { logAction } from "_shared/log.ts";

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
  try { content_id = await resolveShort(parsed.short); } catch {
    await tg.answerCallbackQuery(cq.id, "That draft is gone or already handled.", true);
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

async function onDeskMessage(m: Message): Promise<void> {
  const jack = await jackId();
  if (m.from?.id !== jack) return; // only Jack's inputs become drafts (plan §6: AI only on Jack's own inputs)
  const text = (m.text ?? m.caption ?? "").trim();
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";

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

  const draft = await createDraft({
    post_type,
    lang,
    fields: { raw_notes: raw, date: new Date().toLocaleDateString("en-GB", { timeZone: tz }) },
    allowed_numbers: numbers,
    media: photo ? [{ kind: "photo", file_id: photo }] : undefined,
    source: { via: "desk", message_id: m.message_id, chat_id: m.chat.id },
    actor: ACTOR,
  });
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
