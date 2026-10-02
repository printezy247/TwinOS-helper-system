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
import { isPoisonedUpdate, resendPatch } from "_shared/backoff.ts";
import { HttpError, serve, json } from "_shared/http.ts";
import { requireSecret } from "_shared/auth.ts";
import { admin, requireSetting, setting, settingTyped, SETTING_KEYS } from "_shared/supabase.ts";
import * as tg from "_shared/tg.ts";
import { buildApprovePayload, promptStateExpired } from "_shared/desk.ts";
import { createDraft, pushToDesk, resolveShort, resolveVariantShort, setStatus, shortIdRange } from "_shared/content.ts";
import { check as complianceCheck, ctaCount, extractNumbers, type PostType } from "_shared/compliance.ts";
import { nextCta, nextHook } from "_shared/hooks.ts";
import { formatMinutes, mondayOf, parseHoursCommand } from "_shared/hours.ts";
import { logAction } from "_shared/log.ts";
import { fanOut } from "_shared/fanout.ts";
import { fanoutSummary } from "_shared/platforms.ts";
import { readyToApprove, summaryLines, sweepPlan, type SweepItem } from "_shared/batch.ts";
import {
  casLookup, evaluate, floodWindowS, isQuestion, matchRepeat, type ModRule, normalizeQuestion, similarity,
} from "_shared/moderation.ts";

const ACTOR = "ops_bot";

/* ------------------------------ types ------------------------------ */
interface User { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string }
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
  chat_join_request?: { chat: Chat; from: User; user_chat_id?: number; date: number; invite_link?: { invite_link: string; name?: string } };
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
  if (cq.data?.startsWith("cap:")) { await onCaptcha(cq); return; }
  const jack = await jackId();
  // callback_data is client-controlled: only Jack's id may press (ASAP decision.py).
  if (cq.from.id !== jack) {
    await tg.answerCallbackQuery(cq.id, "Only Jack can use these buttons.", true);
    await logAction({ actor: ACTOR, action: "desk.callback_refused", payload: { from: cq.from.id } });
    return;
  }
  const parsed = tg.parseCallback(cq.data ?? "");
  if (!parsed) { await tg.answerCallbackQuery(cq.id, "Unknown button."); return; }
  if (parsed.kind === "nop") {
    await tg.answerCallbackQuery(cq.id);
    return;
  }
  if (parsed.kind === "nav" || parsed.kind === "page") {
    await onNav(cq, parsed);
    return;
  }
  if (parsed.kind === "cmd") {
    await onBatchCmd(cq, parsed.name);
    return;
  }
  if (parsed.verb === "mo") {
    await onModAction(cq, parsed.short, parsed.extra);
    return;
  }
  // Pick buttons point at variants, not items: resolve before the item path.
  if (parsed.kind === "item" && parsed.verb === "pk") {
    await onPick(cq, parsed.short);
    return;
  }
  // Clip candidate taps point at candidates, not items.
  if (parsed.kind === "item" && parsed.verb === "clip") {
    await onClipAction(cq, parsed.short, parsed.extra);
    return;
  }

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
      const r = await callApprove(buildApprovePayload(content_id, "approve", cq.from.id, `cb:${cq.id}`, { callback_id: cq.id }));
      await tg.answerCallbackQuery(cq.id, r.ok ? "Approved. Publishing on schedule." : `Not approved: ${r.message ?? r.error}`, !r.ok);
      if (chat && mid && r.ok) {
        await tg.editMessageReplyMarkup(chat, mid, [
          [tg.nopButton(await approvedStamp(content_id))],
          [{ text: "📣 Fan out", callback_data: tg.shortCallback("fan", content_id) }],
        ]).catch(() => null);
      }
      return;
    }
    case "no": {
      const r = await callApprove(buildApprovePayload(content_id, "reject", cq.from.id, `cb:${cq.id}`));
      await tg.answerCallbackQuery(cq.id, r.ok ? "Rejected." : `Failed: ${r.message ?? r.error}`, !r.ok);
      if (chat && mid && r.ok) {
        await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton("❌ Rejected")]]).catch(() => null);
      }
      return;
    }
    case "edit": {
      await admin().from("content_items").update({ desk_state: "awaiting_edit", desk_state_at: new Date().toISOString() }).eq("id", content_id);
      await tg.answerCallbackQuery(cq.id);
      if (chat && mid) {
        await tg.sendMessage(chat, `✏️ Pick a preset, or reply with the new text.`, { parse_mode: "HTML", reply_to_message_id: mid, buttons: tg.editKeyboard(content_id) });
      }
      return;
    }
    case "later": {
      await admin().from("content_items").update({ desk_state: "awaiting_time", desk_state_at: new Date().toISOString() }).eq("id", content_id);
      await tg.answerCallbackQuery(cq.id);
      if (chat && mid) {
        await tg.sendMessage(chat, `🕒 Pick a time, or reply with one like <code>13:00</code> (MYT).`, { parse_mode: "HTML", reply_to_message_id: mid, buttons: tg.laterKeyboard(content_id) });
      }
      return;
    }
    case "rs": {
      const labels: Record<string, string> = { "13": "13:00", "18": "18:00", "tom": "tomorrow 08:00" };
      const label = labels[parsed.extra ?? ""];
      if (!label) { await tg.answerCallbackQuery(cq.id, "Unknown time."); return; }
      const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
      const when = parseTime(label, tz);
      if (!when) { await tg.answerCallbackQuery(cq.id, "I need a time like 13:00.", true); return; }
      const r = await callApprove(buildApprovePayload(content_id, "reschedule", cq.from.id, `rs:${cq.id}`, { run_at: when }));
      await tg.answerCallbackQuery(cq.id, r.ok ? `Rescheduled to ${label}.` : `Failed: ${r.message ?? r.error}`, !r.ok);
      if (chat && mid && r.ok) await tg.editMessageReplyMarkup(chat, mid, null).catch(() => null);
      return;
    }
    case "ed": {
      const preset = parsed.extra;
      if (preset === "own") {
        await tg.answerCallbackQuery(cq.id, "Reply with the full new text.");
        return;
      }
      const instructions: Record<string, string> = { soften: "soften", bm: "BM", shorter: "shorter" };
      const instruction = preset ? instructions[preset] : undefined;
      if (!instruction || !chat || !mid) {
        await tg.answerCallbackQuery(cq.id, !instruction ? "Unknown preset." : "That draft is gone.", true);
        return;
      }
      const { data: item } = await admin().from("content_items")
        .select("post_type, lang").eq("id", content_id).maybeSingle();
      if (!item) { await tg.answerCallbackQuery(cq.id, "That draft is gone.", true); return; }
      await applyEdit(content_id, item.post_type as PostType, item.lang as "en" | "ms", instruction, {
        message_id: mid,
        chat: { id: chat, type: "supergroup" },
        date: Math.floor(Date.now() / 1000),
      });
      await tg.answerCallbackQuery(cq.id, "Rewriting…");
      await tg.editMessageReplyMarkup(chat, mid, null).catch(() => null);
      return;
    }
    case "fan": {
      await tg.answerCallbackQuery(cq.id, "Copying to the other platforms…");
      try {
        const results = await fanOut(content_id, { actor: "jack" });
        await logAction({ actor: "jack", action: "content.fanout", target: content_id, payload: { platforms: results.map((r) => r.platform), via: "button" } });
        if (chat) {
          await tg.sendMessage(chat, results.length ? fanoutSummary(content_id.slice(0, 8), results) : "Already copied to every platform.", { parse_mode: "HTML", reply_to_message_id: mid });
        }
        if (chat && mid) {
          await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton("📣 Fanned out")]]).catch(() => null);
        }
      } catch (err) {
        if (chat) {
          await tg.sendMessage(chat, `⚠️ ${tg.escapeHtml(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, { parse_mode: "HTML", reply_to_message_id: mid });
        }
      }
      return;
    }
    case "vw": {
      const { data: v } = await admin().from("content_variants")
        .select("body").eq("content_id", content_id).limit(1).maybeSingle();
      await tg.answerCallbackQuery(cq.id);
      if (chat && v?.body) {
        await tg.sendMessage(chat, `👁 <code>#${content_id.slice(0, 8)}</code>\n\n${tg.escapeHtml(String(v.body)).slice(0, 3500)}`, { parse_mode: "HTML", reply_to_message_id: mid });
      }
      return;
    }
    case "adj": {
      await onAdjust(cq, content_id);
      return;
    }
    case "pk": {
      // Reached only for malformed data: real picks return before the item path.
      await tg.answerCallbackQuery(cq.id, "Use the Pick buttons on the angles message.", true);
      return;
    }
    case "cancel": {
      await admin().from("content_items").update({ desk_state: null, desk_state_at: null }).eq("id", content_id);
      await tg.answerCallbackQuery(cq.id, "Cancelled.");
      if (chat && mid) {
        await tg.editMessageReplyMarkup(chat, mid, null).catch(() => null);
      }
      return;
    }
    case "hp":
    case "hs": {
      // A parked send (unknown outcome): Jack checked the channel.
      const platform = parsed.extra ?? "";
      const db = admin();
      const { data: held } = await db.from("publish_jobs").select("id, result")
        .eq("content_id", content_id).eq("platform", platform)
        .eq("status", "failed").eq("error_class", "unknown");
      if (!held?.length) {
        await tg.answerCallbackQuery(cq.id, "Already handled.");
        if (chat && mid) await tg.editMessageReplyMarkup(chat, mid, null).catch(() => null);
        return;
      }
      const now = new Date().toISOString();
      if (parsed.verb === "hp") {
        await db.from("publish_jobs").update({ status: "done", done_at: now, last_error: "posted (confirmed by Jack)" })
          .in("id", held.map((j) => j.id));
        await setStatus(content_id, "published", "jack", { published_at: now, published_ref: `${platform}: confirmed by Jack` })
          .catch(() => null);
      } else {
        for (const j of held) {
          await db.from("publish_jobs").update(resendPatch(j.result as Record<string, unknown> | null, now)).eq("id", j.id);
        }
      }
      await logAction({ actor: "jack", action: parsed.verb === "hp" ? "publish.held_posted" : "publish.held_resend", target: content_id, payload: { platform } });
      await tg.answerCallbackQuery(cq.id, parsed.verb === "hp" ? "Marked as posted." : "Sending again now.");
      if (chat && mid) {
        await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton(parsed.verb === "hp" ? "✅ Posted (you confirmed)" : "🔁 Sent again")]])
          .catch(() => null);
      }
      return;
    }
    default:
      await tg.answerCallbackQuery(cq.id, "Unknown button.");
  }
}

/**
 * Adjust a draft (Wave 3 item 7). With the local model on, it queues an
 * `llm_variants` job (3 angles per platform, strict JSON, guarded on the way
 * back in). With it off (the default), it refreshes the draft from the
 * no-AI hook + CTA library instead: hook up top, CTA at the bottom when the
 * body has none. Either way the draft stays unapproved until Jack taps ✅.
 */
async function onAdjust(cq: NonNullable<Update["callback_query"]>, content_id: string): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  const { data: item } = await admin().from("content_items")
    .select("post_type, lang, pillar, status").eq("id", content_id).maybeSingle();
  if (!item) { await tg.answerCallbackQuery(cq.id, "That draft is gone.", true); return; }
  if (["published", "publishing"].includes(String(item.status))) {
    await tg.answerCallbackQuery(cq.id, "Already out: adjust a fresh draft instead.", true);
    return;
  }
  const lang = (item.lang === "ms" ? "ms" : "en") as "en" | "ms";
  const { data: primary } = await admin().from("content_variants")
    .select("id, platform, body").eq("content_id", content_id)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!primary) { await tg.answerCallbackQuery(cq.id, "That draft is gone.", true); return; }

  const db = admin();
  if ((await settingTyped(SETTING_KEYS.llmVariantsEnabled)) === "true") {
    const angles = Math.min(Math.max(Number(await settingTyped(SETTING_KEYS.llmAngles)) || 3, 1), 5);
    const { data: variants } = await db.from("content_variants").select("platform").eq("content_id", content_id);
    const platforms = [...new Set((variants ?? []).map((v) => String(v.platform)))];
    const body = String(primary.body ?? "");
    await db.from("jobs").insert({
      kind: "llm_variants",
      payload: {
        content_id,
        platforms: platforms.length ? platforms : ["telegram"],
        lang,
        angles,
        allowed_numbers: extractNumbers(body),
        raw_lines: body.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 12),
      },
      status: "queued",
      created_by: "jack",
    });
    await logAction({ actor: "jack", action: "content.adjust_llm", target: content_id, payload: { angles } });
    await tg.answerCallbackQuery(cq.id, `Angles cooking on the PC (${angles} each) — I'll bring them here.`);
    return;
  }
  const hook = await nextHook(db, { pillar: item.pillar as string | null, lang });
  const cta = await nextCta(db, { platform: String(primary.platform), lang });
  let body = String(primary.body ?? "");
  // A/B (research 2026-10-02): record which library hook opened the draft so
  // v_hook_performance can say which hooks earn views.
  const hookUsed = hook && !body.startsWith(hook.text) ? hook : null;
  if (hookUsed) body = `${hookUsed.text}\n${body}`;
  if (cta && ctaCount(body) === 0) body = `${body}\n${cta.text}`;
  const checked = complianceCheck({
    post_type: item.post_type as PostType,
    platform: String(primary.platform) as never,
    lang,
    body,
  });
  await db.from("content_variants").update({
    body, compliance: checked, claim_flags: checked.claim_flags,
    ...(hookUsed ? { hook_id: hookUsed.id } : {}),
  }).eq("id", primary.id);
  await db.from("compliance_checks").insert({
    variant_id: primary.id, ok: checked.ok, needs_approval: true, findings: checked.findings,
  });
  await logAction({ actor: "jack", action: "content.adjust", target: content_id });
  await tg.answerCallbackQuery(cq.id, checked.ok ? "Adjusted (no AI): hook up top, CTA below." : "Adjusted, but the checklist blocks: see the draft.");
  if (chat) {
    await tg.sendMessage(chat, `🎛 Adjusted <code>#${content_id.slice(0, 8)}</code> (no AI):\n<pre>${tg.escapeHtml(body).slice(0, 3000)}</pre>`, {
      parse_mode: "HTML", reply_to_message_id: mid,
    });
  }
}

/**
 * Use one local-model angle (Wave 3 item 6): the picked body becomes the
 * platform draft (re-checked), the card collapses, Jack still taps ✅.
 */
async function onPick(cq: NonNullable<Update["callback_query"]>, short: string): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  let variantId: string;
  try {
    variantId = await resolveVariantShort(short);
  } catch {
    await tg.answerCallbackQuery(cq.id, "That angle is gone.", true);
    return;
  }
  const db = admin();
  const { data: v } = await db.from("content_variants")
    .select("content_id, platform, lang, body, compliance, source").eq("id", variantId).maybeSingle();
  const src = (v?.source ?? {}) as Record<string, unknown>;
  const stored = (v?.compliance ?? {}) as { ok?: boolean };
  if (!v || src.via !== "llm_variants") {
    await tg.answerCallbackQuery(cq.id, "That is not an angle.", true);
    return;
  }
  if (stored.ok !== true || src.blocked === true) {
    await tg.answerCallbackQuery(cq.id, "Blocked: the number guard refused that angle.", true);
    return;
  }
  const body = String(v.body ?? "");
  const { data: parent } = await db.from("content_items").select("post_type").eq("id", v.content_id).maybeSingle();
  const { data: sibs } = await db.from("content_variants")
    .select("id, source").eq("content_id", v.content_id).eq("platform", v.platform);
  const sibling = (sibs ?? []).find((s) => ((s.source ?? {}) as Record<string, unknown>).via !== "llm_variants");
  const sibSrc = ((sibling?.source ?? {}) as Record<string, unknown>);
  const targetId = (sibling?.id as string | undefined) ?? variantId;
  const rechecked = complianceCheck({
    post_type: (parent?.post_type ?? "gold_map") as PostType,
    platform: String(v.platform) as never,
    lang: (v.lang === "ms" ? "ms" : "en") as "en" | "ms",
    body,
    allowed_numbers: extractNumbers(body), // the pick may only repeat its own numbers
  });
  await db.from("content_variants").update({
    body, compliance: rechecked, claim_flags: rechecked.claim_flags, needed_fields: [],
    source: { ...sibSrc, picked: true },
  }).eq("id", targetId);
  await db.from("compliance_checks").insert({
    variant_id: targetId, ok: rechecked.ok, needs_approval: true, findings: rechecked.findings,
  });
  if (targetId !== variantId) {
    await db.from("content_variants").update({ source: { ...src, picked: false } }).eq("id", variantId);
  }
  await db.from("content_items").update({ status: "draft" }).eq("id", v.content_id);
  await logAction({ actor: "jack", action: "content.pick", target: String(v.content_id), payload: { variant_id: variantId } });
  await tg.answerCallbackQuery(cq.id, "Angle live on the draft. Tap ✅ to approve.");
  if (chat && mid) {
    await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton(`\u2705 Angle live · ${v.platform}`)]]).catch(() => null);
  }
}

/**
 * Clip candidate taps (Wave 4 item 3): `clip:<id8>:use` cuts the window on
 * the PC, `clip:<id8>:drop` discards it. Nothing is cut before the tap.
 */
async function onClipAction(
  cq: NonNullable<Update["callback_query"]>,
  short: string,
  action: string | undefined,
): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  const db = admin();
  let from = "";
  let to = "";
  try {
    ({ from, to } = shortIdRange(short));
  } catch {
    await tg.answerCallbackQuery(cq.id, "That moment is gone.", true);
    return;
  }
  const { data } = await db.from("clip_candidates")
    .select("id, source_path, start_s, end_s, status").gte("id", from).lte("id", to).limit(2);
  if (!data?.length || data.length > 1) {
    await tg.answerCallbackQuery(cq.id, "That moment is gone.", true);
    return;
  }
  const c = data[0];
  if (action === "drop") {
    await db.from("clip_candidates").update({ status: "dropped", decided_by: "jack" }).eq("id", c.id);
    await logAction({ actor: "jack", action: "clip.drop", target: String(c.id) });
    await tg.answerCallbackQuery(cq.id, "Dropped.");
    if (chat && mid) {
      await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton("Dropped")]]).catch(() => null);
    }
    return;
  }
  if (action !== "use") {
    await tg.answerCallbackQuery(cq.id, "Unknown button.", true);
    return;
  }
  if (c.status !== "proposed") {
    await tg.answerCallbackQuery(cq.id, "Already handled.", true);
    return;
  }
  await db.from("clip_candidates").update({ status: "approved", decided_by: "jack" }).eq("id", c.id);
  await db.from("jobs").insert({
    kind: "clip",
    payload: {
      path: String(c.source_path ?? ""),
      clip_start: Number(c.start_s),
      clip_end: Number(c.end_s),
      max_clips: 1,
    },
    status: "queued",
    created_by: "jack",
  });
  await logAction({ actor: "jack", action: "clip.use", target: String(c.id) });
  await tg.answerCallbackQuery(cq.id, "Cutting that window on the PC…");
  if (chat && mid) {
    await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton("🎬 Cutting…")]]).catch(() => null);
  }
}

/** `/clips` lists the open clip candidates (read-only; Use/Drop live on the candidates message). */
async function onClips(m: Message): Promise<void> {
  const { data } = await admin().from("clip_candidates")
    .select("id, start_s, end_s, score, reason, hook_text")
    .eq("status", "proposed").order("score", { ascending: false }).limit(5);
  const stamp = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const lines = (data ?? []).map((c) => {
    const short = String(c.id).replace(/-/g, "").slice(0, 8);
    return `🎬 <code>${short}</code> ${stamp(Number(c.start_s))}–${stamp(Number(c.end_s))} (score ${Number(c.score)}): ` +
      `${tg.escapeHtml(String(c.reason ?? "")).slice(0, 160)}`;
  });
  await tg.sendMessage(m.chat.id, lines.length ? `<b>Clip candidates</b>\n${lines.join("\n")}\nTap Use / Drop on the candidates message.` : "No open clip candidates.", {
    parse_mode: "HTML", reply_to_message_id: m.message_id,
  });
}

/** `/fanout` as a reply to a draft, or `/fanout #abcd1234`. */
async function onFanout(m: Message): Promise<void> {
  const say = (html: string) => tg.sendMessage(m.chat.id, html, { parse_mode: "HTML", reply_to_message_id: m.message_id });
  const short = /#?([0-9a-f]{8})\b/i.exec((m.text ?? "").replace(/^\/fanout(?:@\w+)?/i, ""))?.[1];
  let id: string | null = null;
  if (short) {
    try { id = await resolveShort(short.toLowerCase()); } catch { id = null; }
  } else if (m.reply_to_message?.message_id) {
    const { data } = await admin().from("content_items").select("id").eq("desk_message_id", m.reply_to_message.message_id).maybeSingle();
    id = (data?.id as string | undefined) ?? null;
  }
  if (!id) { await say("Reply to a draft with /fanout, or send <code>/fanout #abcd1234</code>."); return; }
  try {
    const results = await fanOut(id, { actor: ACTOR });
    await say(results.length ? fanoutSummary(id.slice(0, 8), results) : "Already copied to every platform.");
    await logAction({ actor: "jack", action: "content.fanout", target: id, payload: { platforms: results.map((r) => r.platform), via: "desk" } });
  } catch (err) {
    await say(`⚠️ ${tg.escapeHtml(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
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

  const states = await loadBatchStates(batch);

  if (arg === "ok") {
    const { done, refused } = await approveReadyBatch(states, await jackId());
    await say(batchResultLines(states, done, refused).join("\n"));
    return;
  }

  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  await tg.sendMessage(m.chat.id, renderBatchList(batch, states, tz).slice(0, 4096), {
    parse_mode: "HTML",
    reply_to_message_id: m.message_id,
    buttons: tg.batchListKeyboard(batch.items.map((i) => ({ n: i.batch_no, id: i.id })), states.filter(readyToApprove).length),
  });
}

/* ------------------------------ Desk group input ------------------------------ */
/** Status line for a collapsed decision card (Wave 1 item 4). */
async function approvedStamp(content_id: string): Promise<string> {
  const { data } = await admin().from("content_items").select("scheduled_at").eq("id", content_id).maybeSingle();
  const at = data?.scheduled_at as string | null;
  if (!at) return "✅ Approved";
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  const hm = new Date(at).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return `✅ Approved · ${hm}`;
}

/** Approve every ready batch item; shared by `/batch ok` and the Yes button. */
async function approveReadyBatch(states: SweepItem[], jack: number): Promise<{ done: number[]; refused: string[] }> {
  const done: number[] = [];
  const refused: string[] = [];
  for (const s of states) {
    if (!readyToApprove(s)) continue;
    const r = await callApprove(buildApprovePayload(s.id, "approve", jack, `batch-ok:${s.id}`));
    if (r.ok) done.push(s.n); else refused.push(`${s.n} (${tg.escapeHtml(String(r.message ?? r.error))})`);
  }
  await logAction({ actor: "jack", action: "batch.ok", payload: { approved: done, refused: refused.length } });
  return { done, refused };
}

function batchResultLines(states: SweepItem[], done: number[], refused: string[]): string[] {
  const left = sweepPlan(states.filter((s) => !done.includes(s.n)), new Date(0)).nudge
    .filter((n) => n.why !== "ready: /batch ok");
  return [
    done.length ? `✅ Approved ${done.join(", ")}. They go out at their slot.` : "Nothing was ready to approve.",
    ...(refused.length ? [`⚠️ Not approved: ${refused.join("; ")}`] : []),
    ...(left.length ? ["Still waiting on you:", ...left.map((n) => `${n.n}. ${n.why}`)] : []),
  ];
}

/** The /batch list as an editable panel (Wave 1 item 5). */
async function batchPanel(): Promise<{ text: string; buttons: tg.InlineButton[][]; states: SweepItem[] } | null> {
  const batch = await openBatch();
  if (!batch) return null;
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  const states = await loadBatchStates(batch);
  return {
    text: renderBatchList(batch, states, tz),
    buttons: tg.batchListKeyboard(batch.items.map((i) => ({ n: i.batch_no, id: i.id })), states.filter(readyToApprove).length),
    states,
  };
}

/** Refresh / Approve-ready / Yes / Cancel on the batch panel. Yes re-checks first. */
async function onBatchCmd(cq: NonNullable<Update["callback_query"]>, name: string): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  if (!chat || !mid) {
    await tg.answerCallbackQuery(cq.id, "Open /batch for the list.");
    return;
  }
  if (name === "refresh") {
    const panel = await batchPanel();
    if (!panel) { await tg.answerCallbackQuery(cq.id, "No batch yet."); return; }
    await tg.answerCallbackQuery(cq.id, "Refreshed.");
    await tg.editMessageText(chat, mid, panel.text.slice(0, 4096), { parse_mode: "HTML", buttons: panel.buttons }).catch(() => null);
    return;
  }
  if (name === "ready") {
    const panel = await batchPanel();
    const ready = (panel?.states ?? []).filter(readyToApprove);
    if (!ready.length) { await tg.answerCallbackQuery(cq.id, "Nothing is ready to approve.", true); return; }
    await tg.answerCallbackQuery(cq.id);
    await tg.editMessageText(chat, mid, `Approve ${ready.map((s) => s.n).join(", ")}? They go out at their slot.`, {
      parse_mode: "HTML",
      buttons: [[
        { text: "✅ Yes, approve", callback_data: tg.cmdCallback("batchyes") },
        { text: "Cancel", callback_data: tg.cmdCallback("batchno") },
      ]],
    }).catch(() => null);
    return;
  }
  if (name === "batchyes") {
    const panel = await batchPanel();
    const states = panel?.states ?? [];
    const { done, refused } = await approveReadyBatch(states, await jackId());
    await tg.answerCallbackQuery(cq.id, done.length ? `Approved ${done.join(", ")}.` : "Nothing was ready.");
    await tg.editMessageText(chat, mid, batchResultLines(states, done, refused).join("\n").slice(0, 4096), { parse_mode: "HTML" }).catch(() => null);
    return;
  }
  if (name === "batchno") {
    const panel = await batchPanel();
    await tg.answerCallbackQuery(cq.id, "Kept as drafts.");
    if (panel) {
      await tg.editMessageText(chat, mid, panel.text.slice(0, 4096), { parse_mode: "HTML", buttons: panel.buttons }).catch(() => null);
    }
    return;
  }
  await tg.answerCallbackQuery(cq.id, "Unknown button.");
}

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
  "/fanout - reply to a draft (or add its #id): copy it to Instagram, Facebook, Threads, TikTok, YouTube and X",
  "/batch - the Wednesday batch (<code>/batch ok</code> approves what is ready and claim-free)",
  "/hours &lt;task&gt; &lt;minutes&gt; [note] - log what a task cost by hand",
  "/hours today - today's total and the week so far",
  "/menu - buttons for Status, Batch, Friday, Hours and Help",
  "/clips - open clip candidates (Use taps cut on the PC)",
  "/help - this message",
].join("\n");

const HOME_TEXT = [
  "<b>EzyMap Desk</b>",
  "Status · Batch · Friday · Hours · Help — tap a button.",
  "Send the chart + raw lines any time; reply to a draft to edit it.",
].join("\n");

function updatedLine(tz: string): string {
  const hm = new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return `<i>updated ${hm}</i>`;
}

/** A moderation/repeat alert tap: ban, mute, ignore, propose for FAQ, dismiss. */
async function onModAction(
  cq: NonNullable<Update["callback_query"]>,
  short: string,
  action: string | undefined,
): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  interface ModEvent { id: string; chat_id: number; user_id: number; message_id: number | null; rule_key: string; detail: string | null }
  let ev: ModEvent | null = null;
  try {
    const { from, to } = shortIdRange(short);
    const { data } = await admin().from("moderation_events")
      .select("id, chat_id, user_id, message_id, rule_key, detail").gte("id", from).lte("id", to).limit(2);
    if (data?.length === 1) ev = data[0] as ModEvent;
  } catch {
    ev = null;
  }
  if (!ev) { await tg.answerCallbackQuery(cq.id, "That alert is gone.", true); return; }
  const db = admin();
  const done = async (label: string) => {
    await tg.answerCallbackQuery(cq.id, label);
    if (chat && mid) await tg.editMessageReplyMarkup(chat, mid, [[tg.nopButton(label)]]).catch(() => null);
  };
  const record = (action_taken: string) =>
    db.from("moderation_events").insert({
      chat_id: ev.chat_id, user_id: ev.user_id, message_id: ev.message_id,
      rule_key: ev.rule_key, action_taken, detail: ev.detail,
      hits: [{ rule: ev.rule_key, action: action_taken, via: "desk" }],
      text_excerpt: (ev.detail ?? "").slice(0, 200), at: new Date().toISOString(),
    });
  try {
    if (action === "ban") {
      await tg.banChatMember(ev.chat_id, ev.user_id);
      await record("banned");
      await done("🚫 Banned");
    } else if (action === "mute") {
      await tg.restrictChatMember(ev.chat_id, ev.user_id, Math.floor(Date.now() / 1000) + 24 * 3600);
      await record("muted");
      await done("🔇 Muted 24 h");
    } else if (action === "ignore" || action === "drop") {
      await logAction({ actor: "jack", action: "moderation.dismissed", payload: { event: ev.id, rule: ev.rule_key } });
      await done(action === "drop" ? "Dismissed" : "Ignored");
    } else if (action === "faq") {
      await logAction({ actor: "jack", action: "faq.proposed", payload: { event: ev.id, question: ev.detail } });
      await done("📝 Proposed for FAQ");
    } else {
      await tg.answerCallbackQuery(cq.id, "Unknown button.");
    }
  } catch (err) {
    await tg.answerCallbackQuery(cq.id, `Failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`, true);
  }
}

/** Read-only screen texts, shared by the slash commands and the nav panels. */
async function statusText(): Promise<string> {
  const db = admin();
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
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  return [
    "<b>Status</b>",
    ...(lines.length ? lines : ["No health beats in the last 15 minutes."]),
    `Open alerts: ${openAlerts ?? 0}`,
    updatedLine(tz),
  ].join("\n");
}

async function fridayText(): Promise<string> {
  const { data: w } = await admin().from("v_friday_scoreboard")
    .select("week_start, channel_members, net_joins, signals_posted, results_posted, strict_win_rate_4w, total_r_4w")
    .order("week_start", { ascending: false }).limit(1).maybeSingle();
  if (!w) return "No scoreboard data yet.";
  const n = (v: unknown) => (v === null || v === undefined ? "-" : String(v));
  return [
    `<b>Friday numbers, week of ${tg.escapeHtml(String(w.week_start))}</b>`,
    `Members: ${n(w.channel_members)} (net joins ${n(w.net_joins)})`,
    `Signals posted: ${n(w.signals_posted)}, with results: ${n(w.results_posted)}`,
    `Strict win rate (4 weeks): ${n(w.strict_win_rate_4w)}%, total R: ${n(w.total_r_4w)}`,
    "TikTok and Vantage numbers are entered by hand.",
    updatedLine((await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur"),
  ].join("\n");
}

async function hoursTodayText(): Promise<string> {
  const db = admin();
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  const day = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD in MYT
  const week = mondayOf(day);
  const { data } = await db.from("baseline_hours").select("task, minutes").eq("day", day);
  const byTask = new Map<string, number>();
  for (const r of data ?? []) byTask.set(r.task as string, (byTask.get(r.task as string) ?? 0) + Number(r.minutes));
  const todayTotal = [...byTask.values()].reduce((a, b) => a + b, 0);
  const { data: wk } = await db.from("baseline_hours").select("minutes").eq("week_start", week);
  const weekTotal = (wk ?? []).reduce((a, r) => a + Number(r.minutes), 0);
  const lines = [...byTask.entries()].sort((a, b) => b[1] - a[1]).map(([t, min]) => `· ${tg.escapeHtml(t)}: ${formatMinutes(min)}`);
  return [
    `<b>Hours — ${day}</b>`,
    ...(lines.length ? lines : ["Nothing logged today yet."]),
    "",
    `Today: <b>${formatMinutes(todayTotal)}</b> · week of ${week}: <b>${formatMinutes(weekTotal)}</b>`,
    "Log with <code>/hours &lt;task&gt; &lt;minutes&gt; [note]</code>.",
    updatedLine(tz),
  ].join("\n");
}

async function loadBatchStates(batch: { week: string; items: BatchRow[] }): Promise<SweepItem[]> {
  const { data: variants } = await admin().from("content_variants")
    .select("content_id, needed_fields, claim_flags, compliance").in("content_id", batch.items.map((i) => i.id));
  return batch.items.map((i) => {
    const v = (variants ?? []).find((x) => x.content_id === i.id);
    return {
      id: i.id, n: i.batch_no, status: i.status, when: i.scheduled_at ?? new Date().toISOString(),
      needed: (v?.needed_fields as string[] | null) ?? [], claims: (v?.claim_flags as string[] | null) ?? [],
      blocked: v?.compliance?.ok === false, hasJob: false,
    };
  });
}

function renderBatchList(batch: { week: string; items: BatchRow[] }, states: SweepItem[], tz: string): string {
  const asItems = batch.items.map((i) => ({
    n: i.batch_no, post_type: i.post_type as "lesson", pillar: null, label: i.source?.label ?? i.post_type,
    title: i.title, when: i.scheduled_at ?? new Date().toISOString(), dow: 0,
  }));
  const needed = new Map(states.map((s) => [s.n, s.needed] as [number, string[]]));
  const lines = summaryLines(asItems, needed, tz)
    .map((line, idx) => `${line} [${batch.items[idx].status}]`);
  return [`<b>Batch</b> · week of ${batch.week}`, "", ...lines, "", "<code>N: the text</code> fills or edits one. <code>/batch ok</code> approves what is ready."].join("\n");
}

async function batchListText(): Promise<string> {
  const batch = await openBatch();
  if (!batch) return "No batch yet. It is drafted on Wednesday at 14:30.";
  const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
  return renderBatchList(batch, await loadBatchStates(batch), tz);
}

const DRAFTS_PAGE_SIZE = 5;

/** Pending drafts with per-item buttons and ◀ n/N ▶ paging (Wave 1 item 10). */
async function draftsPanel(page: number): Promise<{ text: string; buttons: tg.InlineButton[][] }> {
  const db = admin();
  const { count } = await db.from("content_items").select("id", { count: "exact", head: true })
    .in("status", ["draft", "pending_approval"]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / DRAFTS_PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const { data } = await db.from("content_items")
    .select("id, post_type, lang, status, title")
    .in("status", ["draft", "pending_approval"])
    .order("created_at", { ascending: false })
    .range((p - 1) * DRAFTS_PAGE_SIZE, p * DRAFTS_PAGE_SIZE - 1);
  const rows = (data ?? []).map((i) => {
    const id8 = (i.id as string).slice(0, 8);
    const title = i.title ? ` — ${tg.escapeHtml(String(i.title)).slice(0, 60)}` : "";
    return `#${id8} ${i.post_type} ${i.lang} [${i.status}]${title}`;
  });
  const buttons: tg.InlineButton[][] = (data ?? []).map((i) => {
    const id = i.id as string;
    const n = id.slice(0, 8);
    return [
      { text: `✅ ${n}`, callback_data: tg.shortCallback("ok", id) },
      { text: `✏️ ${n}`, callback_data: tg.shortCallback("edit", id) },
      { text: `👁 ${n}`, callback_data: tg.shortCallback("vw", id) },
    ];
  });
  if (pages > 1) {
    const row: tg.InlineButton[] = [];
    if (p > 1) row.push({ text: "◀", callback_data: tg.pageCallback("drafts", p - 1) });
    row.push(tg.nopButton(`${p}/${pages}`));
    if (p < pages) row.push({ text: "▶", callback_data: tg.pageCallback("drafts", p + 1) });
    buttons.push(row);
  }
  buttons.push(...tg.backHomeRows());
  return {
    text: [`<b>Pending drafts</b> · ${total}`, "", ...(rows.length ? rows : ["Nothing pending."]), ""].join("\n"),
    buttons,
  };
}

async function navScreenText(screen: string): Promise<string> {
  switch (screen) {
    case "status": return await statusText();
    case "batch": return await batchListText();
    case "friday": return await fridayText();
    case "hours": return await hoursTodayText();
    case "help": return HELP_TEXT;
    case "home":
    default: return HOME_TEXT;
  }
}

/** A nav/page tap: stale layouts answer outdated, then the screen redraws in place. */
async function onNav(
  cq: NonNullable<Update["callback_query"]>,
  nav: { kind: "nav"; screen: string; arg?: string; fp: string } | { kind: "page"; screen: string; n: number; fp: string },
): Promise<void> {
  const chat = cq.message?.chat.id;
  const mid = cq.message?.message_id;
  if (!chat || !mid) {
    await tg.answerCallbackQuery(cq.id, "Open /menu for the panel.");
    return;
  }
  const stale = tg.isStaleFp(nav.fp);
  const screen = nav.kind === "nav" &&
      ((tg.MENU_SCREENS as readonly string[]).includes(nav.screen) || nav.screen === "home")
    ? nav.screen
    : nav.kind === "page" && nav.screen === "drafts"
      ? "drafts"
      : "home";
  await tg.answerCallbackQuery(cq.id, stale ? "Outdated menu — showing the latest." : undefined);
  if (screen === "batch") {
    const panel = await batchPanel();
    try {
      if (panel) {
        await tg.editMessageText(chat, mid, panel.text.slice(0, 4096), { parse_mode: "HTML", buttons: panel.buttons });
      } else {
        await tg.editMessageText(chat, mid, "No batch yet. It is drafted on Wednesday at 14:30.", { parse_mode: "HTML", buttons: tg.backHomeRows() });
      }
    } catch {
      await tg.sendMessage(chat, panel?.text.slice(0, 4096) ?? "No batch yet.", { parse_mode: "HTML" });
    }
    return;
  }
  if (screen === "drafts") {
    const panel = await draftsPanel(nav.kind === "page" ? nav.n : 1);
    try {
      await tg.editMessageText(chat, mid, panel.text.slice(0, 4096), { parse_mode: "HTML", buttons: panel.buttons });
    } catch {
      await tg.sendMessage(chat, panel.text.slice(0, 4096), { parse_mode: "HTML" });
    }
    return;
  }
  const text = await navScreenText(screen);
  try {
    await tg.editMessageText(chat, mid, text.slice(0, 4096), {
      parse_mode: "HTML",
      buttons: screen === "home"
        ? tg.menuKeyboard()
        : screen === "status" || screen === "friday" || screen === "hours"
          ? tg.screenKeyboard(screen)
          : tg.backHomeRows(),
    });
  } catch {
    await tg.sendMessage(chat, text.slice(0, 4096), { parse_mode: "HTML" });
  }
}

/** Slash commands in the Desk group (Jack only; read-only). */
async function onDeskCommand(m: Message, cmd: string): Promise<void> {
  const say = (html: string) => tg.sendMessage(m.chat.id, html, { parse_mode: "HTML", reply_to_message_id: m.message_id });

  if (cmd === "status") { await say(await statusText()); return; }

  if (cmd === "friday") { await say(await fridayText()); return; }

  if (cmd === "hours") { await onHours(m); return; }
  if (cmd === "batch") { await onBatch(m); return; }
  if (cmd === "fanout") { await onFanout(m); return; }
  if (cmd === "clips") { await onClips(m); return; }

  if (cmd === "menu" || cmd === "start") {
    await tg.sendMessage(m.chat.id, HOME_TEXT, {
      parse_mode: "HTML",
      reply_to_message_id: m.message_id,
      buttons: tg.menuKeyboard(),
    });
    return;
  }

  if (cmd === "help") { await say(HELP_TEXT); return; }
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

  await say(await hoursTodayText());
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
      .select("id, desk_state, desk_state_at, post_type, lang").eq("desk_message_id", replyId).maybeSingle();
    if (item) {
      if (promptStateExpired(item.desk_state as string | null, item.desk_state_at as string | null)) {
        await admin().from("content_items").update({ desk_state: null, desk_state_at: null }).eq("id", item.id);
        await tg.sendMessage(m.chat.id, "That prompt expired after 30 minutes. Tap Edit or Later again.", { reply_to_message_id: m.message_id });
        return;
      }
      if (item.desk_state === "awaiting_time" || parseTime(text, tz)) {
        const when = parseTime(text, tz);
        if (!when) { await tg.sendMessage(m.chat.id, "I need a time like 13:00.", { reply_to_message_id: m.message_id }); return; }
        const r = await callApprove(buildApprovePayload(item.id, "reschedule", jack, undefined, { run_at: when }));
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
    await db.from("content_items").update({ desk_state: null, desk_state_at: null, edit_note: instruction }).eq("id", content_id);
    await tg.sendMessage(m.chat.id, `✏️ Noted: "${tg.escapeHtml(instruction)}". A rewrite is queued; you'll get the new draft here.`, { parse_mode: "HTML", reply_to_message_id: m.message_id });
    return;
  }
  const result = complianceCheck({ post_type, platform: v.platform, lang, body: instruction });
  await db.from("content_variants").update({ body: instruction, compliance: result, claim_flags: result.claim_flags, needed_fields: [] }).eq("id", v.id);
  await db.from("compliance_checks").insert({ variant_id: v.id, ok: result.ok, needs_approval: result.needs_approval, findings: result.findings });
  await db.from("content_items").update({ desk_state: null, desk_state_at: null, status: "draft" }).eq("id", content_id);
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

/** The enabled moderation rules (seeded in mod_rules; docs/SETUP.md Phase 4). */
async function modRules(): Promise<ModRule[]> {
  const { data } = await admin().from("mod_rules").select("key, kind, patterns, params, action, enabled").eq("enabled", true);
  return (data ?? []).map((r) => ({
    key: r.key as string, kind: r.kind as string, patterns: (r.patterns as string[] | null) ?? [],
    params: (r.params as Record<string, unknown> | null) ?? {}, action: r.action as string, enabled: true,
  }));
}

const NOTED: Record<string, string> = { flag: "flagged", delete: "deleted", warn: "warned", mute: "muted", ban: "banned" };

/**
 * A join request: CAS first (a banned account is declined and logged), then the
 * captcha through Telegram's join-request flow (a button the person taps in a
 * private message from the bot; only then are they let in). With no captcha
 * rule enabled the request is approved once CAS has passed.
 */
async function onJoinRequest(r: NonNullable<Update["chat_join_request"]>) {
  const db = admin();
  await db.from("member_events").insert({
    chat_id: r.chat.id, user_id: r.from.id, username: r.from.username ?? null, event: "chat_join_request",
    old_status: null, new_status: "requested", invite_link: r.invite_link?.invite_link ?? null,
    invite_link_name: r.invite_link?.name ?? null, at: new Date(r.date * 1000).toISOString(),
  });
  const rules = await modRules();
  const cas = rules.find((x) => x.kind === "cas");
  if (cas && (await casLookup(r.from.id)) === true) {
    try { await tg.declineChatJoinRequest(r.chat.id, r.from.id); } catch (err) { console.warn("[join] decline failed", err); }
    await db.from("moderation_events").insert({
      chat_id: r.chat.id, user_id: r.from.id, rule_key: cas.key, action_taken: "cas_blocked",
      detail: "on the CAS ban list", hits: [{ rule: cas.key, action: "ban" }], at: new Date().toISOString(),
    });
    return;
  }
  const captcha = rules.find((x) => x.kind === "captcha");
  if (!captcha) { await tg.approveChatJoinRequest(r.chat.id, r.from.id); return; }
  const dm = r.user_chat_id ?? r.from.id;
  try {
    await tg.sendMessage(dm, `Welcome to ${tg.escapeHtml(r.chat.title ?? "EzyMap")}. Tap the button to confirm you are a person and you are in.`, {
      parse_mode: "HTML",
      buttons: [[{ text: "I am a person, let me in", callback_data: `cap:${r.chat.id}:${r.from.id}` }]],
    });
  } catch (err) {
    console.warn("[join] could not send the captcha", err);
  }
}

/** The captcha button. Only the person who asked to join can press it. */
async function onCaptcha(cq: NonNullable<Update["callback_query"]>): Promise<void> {
  const m = /^cap:(-?\d+):(\d+)$/.exec(cq.data ?? "");
  if (!m) return;
  const chatId = Number(m[1]);
  const userId = Number(m[2]);
  if (cq.from.id !== userId) { await tg.answerCallbackQuery(cq.id, "This button is for someone else.", true); return; }
  try {
    await tg.approveChatJoinRequest(chatId, userId);
    // Telegram answers an approval with a chat_member update, which onMember records as the join.
    await tg.answerCallbackQuery(cq.id, "Welcome! You are in.");
  } catch {
    await tg.answerCallbackQuery(cq.id, "That request has expired. Ask to join again.", true);
  }
}

/* ------------------------------ discussion group moderation ------------------------------ */
/**
 * Pattern rules only (plan §6: no AI on member text), through _shared/moderation.ts.
 * Jack and chat admins are never moderated. Every action is recorded in
 * moderation_events with only a 200-character excerpt. Flood control counts
 * this sender's flood_counters rows inside the widest flood window.
 */
async function onDiscussionMessage(m: Message) {
  if (!m.from || m.from.is_bot) return;
  const db = admin();
  const text = m.text ?? m.caption ?? "";
  const rules = await modRules();
  if (!rules.length) return;

  const { data: joined } = await db.from("member_events").select("at")
    .eq("chat_id", m.chat.id).eq("user_id", m.from.id).eq("new_status", "member")
    .order("at", { ascending: false }).limit(1).maybeSingle();
  const { count: strikes } = await db.from("moderation_events").select("id", { count: "exact", head: true })
    .eq("chat_id", m.chat.id).eq("user_id", m.from.id).in("action_taken", ["warned", "muted"])
    .gte("occurred_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

  // Flood control (migration 0031): log this message, drop rows older than a
  // day, and count this sender's rows inside the widest flood window.
  const windowS = floodWindowS(rules);
  await db.from("flood_counters").insert({ chat_id: m.chat.id, user_id: m.from.id });
  await db.from("flood_counters").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
  const { count: recentCount } = await db.from("flood_counters")
    .select("at", { count: "exact", head: true })
    .eq("chat_id", m.chat.id).eq("user_id", m.from.id)
    .gte("at", new Date(Date.now() - windowS * 1000).toISOString());

  const ctx = {
    text,
    hasLinkEntity: (m.entities ?? []).some((e) => e.type === "url" || e.type === "text_link" || e.type === "mention"),
    from: { id: m.from.id, first_name: m.from.first_name, last_name: m.from.last_name, username: m.from.username },
    joinedAt: joined?.at ? Date.parse(joined.at as string) : null,
    recent: recentCount ?? 1,
    isAdmin: m.from.id === await jackId(),
    now: Date.now(),
  };
  let verdict = evaluate(ctx, rules, strikes ?? 0);

  if (verdict.final) {
    try {
      const member = await tg.getChatMember(m.chat.id, m.from.id);
      if (member.status === "creator" || member.status === "administrator") verdict = evaluate({ ...ctx, isAdmin: true }, rules, 0);
    } catch { /* if the lookup fails we moderate, the safe side for a group */ }
  }

  if (!verdict.final) {
    await noteRepeatQuestion(m, text, rules);
    return;
  }

  const final = verdict.final;
  const { data: modEv } = await db.from("moderation_events").insert({
    chat_id: m.chat.id, user_id: m.from.id, message_id: m.message_id,
    rule_key: verdict.hits[0].rule, action_taken: NOTED[final], detail: verdict.hits.map((h) => h.rule).join(", "),
    hits: verdict.hits, text_excerpt: text.slice(0, 200), at: new Date(m.date * 1000).toISOString(),
  }).select("id").single();
  try {
    if (verdict.deleteMessage) await tg.deleteMessage(m.chat.id, m.message_id);
    if (final === "warn") {
      await tg.sendMessage(m.chat.id, `⚠️ ${tg.escapeHtml(m.from.first_name ?? "Hi")}, that kind of message is not allowed here. The next one is a 24 hour mute.`, { parse_mode: "HTML" });
    }
    if (final === "mute") await tg.restrictChatMember(m.chat.id, m.from.id, Math.floor(Date.now() / 1000) + verdict.muteSeconds);
    if (final === "ban") await tg.banChatMember(m.chat.id, m.from.id);
    if (final === "flag") {
      const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
      const who = `${m.from.first_name ?? ""}${m.from.username ? ` (@${m.from.username})` : ""}`.trim();
      const modShort = modEv?.id ? String(modEv.id).replace(/-/g, "").slice(0, 8) : null;
      await tg.sendMessage(desk, `🚩 A name that looks like yours or EzyMap's just posted in the group: <b>${tg.escapeHtml(who)}</b>. Nothing was removed. Check it.`, {
        parse_mode: "HTML",
        ...(modShort
          ? {
            buttons: [
              [
                { text: "🚫 Ban", callback_data: `mo:${modShort}:ban` },
                { text: "🔇 Mute 24 h", callback_data: `mo:${modShort}:mute` },
              ],
              [{ text: "Ignore", callback_data: `mo:${modShort}:ignore` }],
            ],
          }
          : {}),
      });
    }
  } catch (err) {
    console.warn("[moderation] action failed", err);
  }
}

/**
 * A question asked twice goes to the FAQ sheet (v_repeat_questions). Every
 * question is stored once, reduced to its words; the Desk hears about it the
 * second time, not the third.
 */
async function noteRepeatQuestion(m: Message, text: string, rules: ModRule[]): Promise<void> {
  const rule = rules.find((r) => r.kind === "repeat_question");
  if (!rule || !m.from || text.length < 12 || !isQuestion(text)) return;
  const db = admin();
  const days = Number(rule.params.window_days ?? 14);
  const min = Number(rule.params.min_similarity ?? 0.8);
  const key = normalizeQuestion(text);
  if (!key) return;
  const { data: seen } = await db.from("moderation_events").select("detail, user_id")
    .eq("rule_key", rule.key).gte("occurred_at", new Date(Date.now() - days * 86_400_000).toISOString()).limit(500);
  const earlier = (seen ?? []).filter((s) => similarity((s.detail as string) ?? "", key) >= min);
  const { data: repEv } = await db.from("moderation_events").insert({
    chat_id: m.chat.id, user_id: m.from.id, message_id: m.message_id, rule_key: rule.key, action_taken: "flagged",
    detail: key, hits: [{ rule: rule.key, action: "flag" }], text_excerpt: text.slice(0, 200), at: new Date(m.date * 1000).toISOString(),
  }).select("id").single();
  if (earlier.length === 1 && matchRepeat(earlier.map((e) => ({ detail: (e.detail as string) ?? "" })), text, min)) {
    const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
    const repShort = repEv?.id ? String(repEv.id).replace(/-/g, "").slice(0, 8) : null;
    await tg.sendMessage(desk, `❓ A question was asked twice in the group:\n<code>${tg.escapeHtml(text.slice(0, 200))}</code>\nAdd it to the FAQ reply sheet.`, {
      parse_mode: "HTML",
      ...(repShort
        ? {
          buttons: [[
            { text: "📝 Propose for FAQ", callback_data: `mo:${repShort}:faq` },
            { text: "Dismiss", callback_data: `mo:${repShort}:drop` },
          ]],
        }
        : {}),
    });
  }
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
  // A replay of a FAILED update is the retry (0 < failures < limit); past the
  // limit the update is poison and dropped, not replayed forever.
  const db = admin();
  const { data: seen } = await db.from("tg_updates").select("failures")
    .eq("update_id", update.update_id).maybeSingle();
  const failures = Number(seen?.failures ?? 0);
  if (seen) {
    if (failures <= 0) return json({ ok: true, duplicate: true });
    if (isPoisonedUpdate(failures)) {
      await logAction({ actor: ACTOR, action: "tg.update_poisoned", payload: { update_id: update.update_id, failures } });
      return json({ ok: true, poisoned: true });
    }
  } else {
    const { error: dup } = await db.from("tg_updates").insert({ update_id: update.update_id });
    if (dup && /duplicate|unique/i.test(dup.message)) return json({ ok: true, duplicate: true });
  }

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
    await db.from("tg_updates").update({ failures: failures + 1 }).eq("update_id", update.update_id);
    await logAction({ actor: ACTOR, action: "tg.update_failed", payload: { update_id: update.update_id, error: String(err).slice(0, 300) } });
  }
  return json({ ok: true });
});
