/**
 * Telegram Bot API client for the ops bot (plan §9.E.33, §4.9).
 *
 * The token comes from the function secret TWINOS_OPS_BOT_TOKEN (set with
 * `supabase secrets set`, never in a file). Every call:
 *   - posts JSON to https://api.telegram.org/bot<token>/<method>
 *   - honours `retry_after` on 429 (and `parameters.retry_after` in the body)
 *     up to RETRY_LIMIT times, sleeping the advised seconds (capped)
 *   - throws TgError with the Telegram description on any other failure
 *
 * reply_to_message_id is passed through `reply_parameters` (Bot API ≥7.0)
 * with allow_sending_without_reply so a deleted original never blocks a
 * result reply.
 */
import { HttpError } from "./http.ts";
import { sha256Hex } from "./auth.ts";

export class TgError extends Error {
  constructor(public readonly method: string, public readonly code: number, desc: string) {
    super(`${method}: ${code} ${desc}`);
  }
}

export type ParseMode = "HTML" | "MarkdownV2";

export interface InlineButton {
  text: string;
  callback_data?: string; // ≤64 bytes, see shortCallback()
  url?: string;
}

export interface SendOpts {
  parse_mode?: ParseMode;
  reply_to_message_id?: number;
  disable_notification?: boolean;
  disable_web_page_preview?: boolean;
  buttons?: InlineButton[][];
  message_thread_id?: number;
  protect_content?: boolean;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  date: number;
  text?: string;
  caption?: string;
}

const RETRY_LIMIT = 3;
const MAX_RETRY_AFTER_S = 20; // an edge function cannot sleep for minutes
const CALLBACK_LIMIT_BYTES = 64;

function token(): string {
  const t = Deno.env.get("TWINOS_OPS_BOT_TOKEN") ?? "";
  if (!t) throw new HttpError(503, "not_configured", "TWINOS_OPS_BOT_TOKEN is not set");
  return t;
}

/**
 * Webhook secret derived from the bot token (ported from printezy's
 * deriveWebhookSecret): both sides compute it, nobody stores a second secret.
 */
export async function deriveWebhookSecret(): Promise<string> {
  const hex = await sha256Hex(`twinos-ops-webhook:${token()}`);
  return hex.slice(0, 48); // Telegram allows 1–256 chars of [A-Za-z0-9_-]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function call<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const body = JSON.stringify(stripUndefined(params));
  let lastDesc = "unknown";
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number; migrate_to_chat_id?: number };
    };
    if (data.ok) return data.result as T;
    lastDesc = data.description ?? `http ${res.status}`;
    const retryAfter = data.parameters?.retry_after ??
      (res.status === 429 ? Number(res.headers.get("retry-after") ?? 1) : 0);
    if ((res.status === 429 || retryAfter > 0) && attempt < RETRY_LIMIT) {
      await sleep(Math.min(retryAfter || 1, MAX_RETRY_AFTER_S) * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < RETRY_LIMIT) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new TgError(method, data.error_code ?? res.status, lastDesc);
  }
  throw new TgError(method, 429, lastDesc);
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function common(opts: SendOpts): Record<string, unknown> {
  return {
    parse_mode: opts.parse_mode,
    disable_notification: opts.disable_notification,
    protect_content: opts.protect_content,
    message_thread_id: opts.message_thread_id,
    reply_parameters: opts.reply_to_message_id
      ? { message_id: opts.reply_to_message_id, allow_sending_without_reply: true }
      : undefined,
    reply_markup: opts.buttons ? { inline_keyboard: opts.buttons } : undefined,
  };
}

export function sendMessage(chat_id: number | string, text: string, opts: SendOpts = {}) {
  return call<TgMessage>("sendMessage", {
    chat_id,
    text,
    link_preview_options: opts.disable_web_page_preview ? { is_disabled: true } : undefined,
    ...common(opts),
  });
}

export function sendPhoto(
  chat_id: number | string,
  photo: string,
  caption?: string,
  opts: SendOpts = {},
) {
  return call<TgMessage>("sendPhoto", { chat_id, photo, caption, ...common(opts) });
}

export function sendVideo(
  chat_id: number | string,
  video: string,
  caption?: string,
  opts: SendOpts = {},
) {
  return call<TgMessage>("sendVideo", {
    chat_id,
    video,
    caption,
    supports_streaming: true,
    ...common(opts),
  });
}

export interface MediaItem {
  type: "photo" | "video";
  media: string;
  caption?: string;
  parse_mode?: ParseMode;
}

export function sendMediaGroup(chat_id: number | string, media: MediaItem[], opts: SendOpts = {}) {
  if (media.length < 2 || media.length > 10) {
    throw new HttpError(400, "bad_request", "album needs 2–10 items");
  }
  const { reply_markup: _noButtons, ...rest } = common(opts);
  return call<TgMessage[]>("sendMediaGroup", { chat_id, media, ...rest });
}

export function sendPoll(
  chat_id: number | string,
  question: string,
  options: string[],
  opts: SendOpts & { is_anonymous?: boolean; allows_multiple_answers?: boolean } = {},
) {
  return call<TgMessage>("sendPoll", {
    chat_id,
    question,
    options: options.map((text) => ({ text })),
    is_anonymous: opts.is_anonymous ?? true,
    allows_multiple_answers: opts.allows_multiple_answers ?? false,
    ...common(opts),
  });
}

export function editMessageText(
  chat_id: number | string,
  message_id: number,
  text: string,
  opts: SendOpts = {},
) {
  return call<TgMessage | true>("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: opts.parse_mode,
    reply_markup: opts.buttons ? { inline_keyboard: opts.buttons } : undefined,
  });
}

export function editMessageCaption(
  chat_id: number | string,
  message_id: number,
  caption: string,
  opts: SendOpts = {},
) {
  return call<TgMessage | true>("editMessageCaption", {
    chat_id,
    message_id,
    caption,
    parse_mode: opts.parse_mode,
    reply_markup: opts.buttons ? { inline_keyboard: opts.buttons } : undefined,
  });
}

export function editMessageReplyMarkup(
  chat_id: number | string,
  message_id: number,
  buttons: InlineButton[][] | null,
) {
  return call<TgMessage | true>("editMessageReplyMarkup", {
    chat_id,
    message_id,
    reply_markup: buttons ? { inline_keyboard: buttons } : { inline_keyboard: [] },
  });
}

export function deleteMessage(chat_id: number | string, message_id: number) {
  return call<true>("deleteMessage", { chat_id, message_id });
}

export function pinChatMessage(
  chat_id: number | string,
  message_id: number,
  disable_notification = true,
) {
  return call<true>("pinChatMessage", { chat_id, message_id, disable_notification });
}

export function unpinChatMessage(chat_id: number | string, message_id: number) {
  return call<true>("unpinChatMessage", { chat_id, message_id });
}

/**
 * The toast on Jack's screen. Telegram refuses it once the query is ~15 s old
 * (or the id is synthetic, as in scripts/desk-tour.sh); that must never stop
 * the decision the tap carries, so a refusal is logged and returned as false.
 */
export async function answerCallbackQuery(
  callback_query_id: string,
  text?: string,
  show_alert = false,
): Promise<boolean> {
  try {
    await call<true>("answerCallbackQuery", { callback_query_id, text, show_alert });
    return true;
  } catch (err) {
    console.warn("[tg] answerCallbackQuery refused", err instanceof Error ? err.message : err);
    return false;
  }
}

export function getChatMemberCount(chat_id: number | string) {
  return call<number>("getChatMemberCount", { chat_id });
}

export function createChatInviteLink(
  chat_id: number | string,
  name: string,
  opts: { creates_join_request?: boolean; expire_date?: number; member_limit?: number } = {},
) {
  return call<{ invite_link: string; name?: string }>("createChatInviteLink", {
    chat_id,
    name,
    ...opts,
  });
}

export function setWebhook(url: string, secret_token: string, allowed_updates: string[]) {
  return call<true>("setWebhook", {
    url,
    secret_token,
    allowed_updates,
    drop_pending_updates: false,
  });
}

/** Moderation helpers (Phase 4 uses them; shipped now so the client is complete). */
export function restrictChatMember(
  chat_id: number | string,
  user_id: number,
  until_date: number,
) {
  return call<true>("restrictChatMember", {
    chat_id,
    user_id,
    permissions: { can_send_messages: false },
    until_date,
  });
}

export function getChatMember(chat_id: number | string, user_id: number) {
  return call<{ status: string }>("getChatMember", { chat_id, user_id });
}

export function banChatMember(chat_id: number | string, user_id: number) {
  return call<true>("banChatMember", { chat_id, user_id });
}

export function approveChatJoinRequest(chat_id: number | string, user_id: number) {
  return call<true>("approveChatJoinRequest", { chat_id, user_id });
}

export function declineChatJoinRequest(chat_id: number | string, user_id: number) {
  return call<true>("declineChatJoinRequest", { chat_id, user_id });
}

/** HTML escape for parse_mode=HTML bodies built from user input. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Short callback ids under Telegram's 64-byte limit (plan §9.C.21).
 * Layout: `<verb>:<id8>` where id8 is the first 8 hex chars of a uuid.
 * The Desk looks the full id up by prefix; collisions among open drafts are
 * practically impossible and are refused by the resolver when they happen.
 */
function checkCallbackLen(data: string): string {
  if (new TextEncoder().encode(data).length > CALLBACK_LIMIT_BYTES) {
    throw new HttpError(500, "internal", "callback data over 64 bytes");
  }
  return data;
}

export function shortCallback(verb: string, id: string): string {
  return checkCallbackLen(`${verb}:${id.replace(/-/g, "").slice(0, 8)}`);
}

/**
 * Callback grammar v2 (plan §17 Wave 1 item 1). Item taps stay
 * `<verb>:<id8>`; navigation adds `nav:<screen>[:<arg>]@<fp>`,
 * `pg:<screen>:<n>@<fp>` and the `nop` no-op. `<fp>` is the layout
 * fingerprint: a tap rendered under an older layout answers "outdated"
 * and redraws (grammY menu pattern). All screens edit the same message
 * in place; the webhook keeps no memory between calls.
 */
export const NAV_LAYOUT = "v1";

export type Callback =
  | { kind: "item"; verb: string; short: string; extra?: string }
  | { kind: "nav"; screen: string; arg?: string; fp: string }
  | { kind: "page"; screen: string; n: number; fp: string }
  | { kind: "cmd"; name: string }
  | { kind: "nop" };

export function navCallback(screen: string, arg?: string, fp = NAV_LAYOUT): string {
  return checkCallbackLen(arg ? `nav:${screen}:${arg}@${fp}` : `nav:${screen}@${fp}`);
}

export function pageCallback(screen: string, n: number, fp = NAV_LAYOUT): string {
  return checkCallbackLen(`pg:${screen}:${n}@${fp}`);
}

export function nopButton(text: string): InlineButton {
  return { text, callback_data: "nop" };
}

export function isStaleFp(fp: string): boolean {
  return fp !== NAV_LAYOUT;
}

export function parseCallback(data: string): Callback | null {
  if (data === "nop") return { kind: "nop" };
  let m = /^nav:([a-z_]{1,16})(?::([a-z0-9_-]{1,16}))?@([a-z0-9]{1,8})$/.exec(data);
  if (m) return { kind: "nav", screen: m[1], arg: m[2], fp: m[3] };
  m = /^pg:([a-z_]{1,16}):(\d{1,3})@([a-z0-9]{1,8})$/.exec(data);
  if (m) return { kind: "page", screen: m[1], n: Number(m[2]), fp: m[3] };
  m = /^cmd:([a-z_]{1,16})$/.exec(data);
  if (m) return { kind: "cmd", name: m[1] };
  m = /^([a-z_]{1,16}):([0-9a-f]{8})(?::([a-z0-9]{1,16}))?$/.exec(data);
  return m ? { kind: "item", verb: m[1], short: m[2], extra: m[3] } : null;
}

/** Later quick picks: `rs:<id8>:<slot>` (13, 18, tom). Custom stays a reply. */
export function slotCallback(id: string, slot: string): string {
  return checkCallbackLen(`rs:${id.replace(/-/g, "").slice(0, 8)}:${slot}`);
}

/** Edit presets: `ed:<id8>:<preset>` (soften, bm, shorter, own). */
export function presetCallback(id: string, preset: string): string {
  return checkCallbackLen(`ed:${id.replace(/-/g, "").slice(0, 8)}:${preset}`);
}

/** Stateless command buttons (`cmd:refresh`, `cmd:ready`, …). */
export function cmdCallback(name: string): string {
  return checkCallbackLen(`cmd:${name}`);
}

/** Later prompt: quick picks + Custom (reply) + Cancel. */
export function laterKeyboard(contentId: string): InlineButton[][] {
  const rs = (slot: string, text: string): InlineButton => ({ text, callback_data: slotCallback(contentId, slot) });
  return [
    [rs("13", "13:00"), rs("18", "18:00")],
    [
      rs("tom", "Tomorrow 08:00"),
      { text: "Custom…", callback_data: shortCallback("later", contentId) },
    ],
    [{ text: "✖ Cancel", callback_data: shortCallback("cancel", contentId) }],
  ];
}

/** Edit prompt: presets + write-your-own (reply) + Cancel. */
export function editKeyboard(contentId: string): InlineButton[][] {
  const ed = (preset: string, text: string): InlineButton => ({
    text,
    callback_data: presetCallback(contentId, preset),
  });
  return [
    [ed("soften", "Soften"), ed("bm", "BM")],
    [ed("shorter", "Shorter"), ed("own", "Write my own")],
    [{ text: "✖ Cancel", callback_data: shortCallback("cancel", contentId) }],
  ];
}

/** /batch list: per-item approve/edit/preview, Refresh, confirmed approve-ready. */
export function batchListKeyboard(items: Array<{ n: number; id: string }>, ready: number): InlineButton[][] {
  const rows: InlineButton[][] = items.map((i) => [
    { text: `✅ ${i.n}`, callback_data: shortCallback("ok", i.id) },
    { text: `✏️ ${i.n}`, callback_data: shortCallback("edit", i.id) },
    { text: `👁 ${i.n}`, callback_data: shortCallback("vw", i.id) },
  ]);
  rows.push([{ text: "🔄 Refresh", callback_data: cmdCallback("refresh") }]);
  rows.push([{ text: `✅ Approve ready (${ready})`, callback_data: cmdCallback("ready") }]);
  return rows;
}

/**
 * /menu home panel (Wave 1 item 2): the five screens. Every other screen
 * carries backHomeRows; both land on home (one-level nav, thumb reach).
 * Unknown screens fall back home.
 */
export const MENU_SCREENS = ["status", "batch", "friday", "hours", "help", "drafts"] as const;

export function menuKeyboard(fp = NAV_LAYOUT): InlineButton[][] {
  return [
    [
      { text: "📊 Status", callback_data: navCallback("status", undefined, fp) },
      { text: "🗂 Batch", callback_data: navCallback("batch", undefined, fp) },
    ],
    [
      { text: "📈 Friday", callback_data: navCallback("friday", undefined, fp) },
      { text: "⏱ Hours", callback_data: navCallback("hours", undefined, fp) },
    ],
    [{ text: "❓ Help", callback_data: navCallback("help", undefined, fp) }],
    [{ text: "📥 Pending drafts", callback_data: navCallback("drafts", undefined, fp) }],
  ];
}

/** Status/Friday/Hours panels: Refresh on top, Back + Home below. */
export function screenKeyboard(screen: string, fp = NAV_LAYOUT): InlineButton[][] {
  return [
    [{ text: "🔄 Refresh", callback_data: navCallback(screen, undefined, fp) }],
    ...backHomeRows(fp),
  ];
}

export function backHomeRows(fp = NAV_LAYOUT): InlineButton[][] {
  return [
    [
      { text: "⬅️ Back", callback_data: navCallback("home", undefined, fp) },
      { text: "🏠 Home", callback_data: navCallback("home", undefined, fp) },
    ],
  ];
}

/**
 * Desk approval keyboard (ported in spirit from ASAP `build_keyboard`, two
 * columns). The verbs are fixed; tg-webhook routes on them.
 */
export function approvalKeyboard(contentId: string): InlineButton[][] {
  return [
    [
      { text: "✅ Approve", callback_data: shortCallback("ok", contentId) },
      { text: "✏️ Edit", callback_data: shortCallback("edit", contentId) },
    ],
    [
      { text: "🕒 Reschedule", callback_data: shortCallback("later", contentId) },
      { text: "❌ Reject", callback_data: shortCallback("no", contentId) },
    ],
  ];
}

/** Render ASAP-style post buttons (link only; reveal buttons stay in ASAP). */
export function buildKeyboard(
  buttons: Array<{ label: string; url: string }>,
  columns = 1,
): InlineButton[][] | undefined {
  if (!buttons.length) return undefined;
  const per = Math.max(columns, 1);
  const rows: InlineButton[][] = [];
  let row: InlineButton[] = [];
  for (const b of buttons) {
    row.push({ text: b.label, url: b.url });
    if (row.length >= per) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}
