/**
 * Draft pipeline shared by content, tg-webhook, tv-webhook and results:
 * template → body → compliance → content_items/content_variants rows → Desk
 * group message with approve buttons.
 *
 * Status flow (plan §9.E.31):
 *   draft → pending_approval → approved → scheduled → publishing → published | failed
 *   (+ rejected)
 */
import { admin, requireSetting, SETTING_KEYS } from "./supabase.ts";
import { check, TELEGRAM_CAPTION_LIMIT, type CheckResult, type Lang, type Platform, type PostType } from "./compliance.ts";
import { HttpError, notFound } from "./http.ts";
import { approvalKeyboard, escapeHtml, sendMessage, sendPhoto } from "./tg.ts";
import { logAction, logTimeSaved } from "./log.ts";
import { isPublishableVariant } from "./platforms.ts";

export const STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "rejected",
] as const;
export type Status = (typeof STATUSES)[number];

export interface TemplateRow {
  id: string;
  post_type: PostType;
  lang: Lang;
  body: string; // {{field}} placeholders
  fields: string[]; // required field names
  required_lines: string[]; // appended if missing (risk line, disclosure)
  char_limit: number | null;
  approval_rule: "jack" | "abdul_ok" | "auto";
}

/**
 * Template `required_lines` hold brand-fact keys (risk, result_footer, ...), not
 * text. Keys listed here become the locked line from `brand_facts` (the `_ms`
 * variant for Malay when there is one); the rest (board_ref, one_cta, ...) are
 * policy markers the compliance check enforces and add no line.
 */
const REQUIRED_LINE_FACT: Record<string, (t: PostType) => string> = {
  risk: (t) => (t === "signal_card" ? "risk_line_signal" : "risk_line_map"),
  result_footer: () => "result_footer",
  past_performance: () => "past_performance",
  education: () => "education_line",
  pledge_pinned: () => "pledge_pinned",
  disclosure: () => "ib_disclosure",
};

/** The brand_facts keys a template's required_lines stand for, in order. */
export function requiredLineFacts(keys: string[], post_type: PostType): string[] {
  return keys.map((k) => REQUIRED_LINE_FACT[k]?.(post_type)).filter((f): f is string => !!f);
}

/** Pick the locked line for each fact: the Malay variant for `ms` when one exists. */
export function pickLines(facts: string[], lang: Lang, byKey: Map<string, string>): string[] {
  return facts
    .map((f) => (lang === "ms" ? byKey.get(`${f}_ms`) : undefined) ?? byKey.get(f))
    .filter((line): line is string => !!line);
}

export async function resolveRequiredLines(keys: string[], post_type: PostType, lang: Lang): Promise<string[]> {
  const facts = requiredLineFacts(keys, post_type);
  if (!facts.length) return [];
  const { data, error } = await admin().from("brand_facts").select("key, body")
    .in("key", facts.flatMap((f) => [f, `${f}_ms`]));
  if (error) throw new HttpError(503, "upstream_failed", `brand_facts: ${error.message}`);
  return pickLines(facts, lang, new Map((data ?? []).map((r) => [r.key as string, r.body as string])));
}

/**
 * Load the active template for a post type, else 404. `templates.key` is the
 * post type and the primary key, so there is one row per type; `lang` is the
 * caller's language and the voice module localises the draft.
 */
export async function loadTemplate(post_type: PostType, lang: Lang): Promise<TemplateRow> {
  const { data, error } = await admin()
    .from("templates")
    .select("id, key, body, fields_list, required_lines, char_limit, approval_rule")
    .eq("key", post_type)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new HttpError(503, "upstream_failed", `templates: ${error.message}`);
  if (!data) throw notFound(`template ${post_type}`);
  if (!data.body) {
    throw new HttpError(503, "not_configured", `the ${post_type} template has no body text yet (templates.body)`);
  }
  return {
    id: data.id,
    post_type: data.key as PostType,
    lang,
    body: data.body,
    fields: data.fields_list ?? [],
    required_lines: await resolveRequiredLines(data.required_lines ?? [], data.key as PostType, lang),
    char_limit: data.char_limit,
    approval_rule: data.approval_rule,
  } as TemplateRow;
}

/**
 * Fill {{field}} placeholders. Missing fields become `[NEEDED:field]`, which
 * the compliance check turns into a blocking finding (plan §9.C.16). A
 * placeholder written {{?field}} is optional: it renders empty when missing.
 */
export function render(
  template: Pick<TemplateRow, "body" | "fields" | "required_lines">,
  fields: Record<string, unknown>,
): { body: string; needed: string[] } {
  const needed = new Set<string>();
  let body = template.body.replace(/\{\{\s*(\??)([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, optional: string, key: string) => {
    const v = fields[key];
    if (v === undefined || v === null || v === "") {
      if (optional) return "";
      needed.add(key);
      return `[NEEDED:${key}]`;
    }
    return String(v);
  });
  body = body.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  for (const f of template.fields) {
    if (fields[f] === undefined || fields[f] === null || fields[f] === "") needed.add(f);
  }
  for (const line of template.required_lines) {
    if (line && !body.includes(line)) body = `${body.trimEnd()}\n\n${line}`;
  }
  return { body, needed: Array.from(needed) };
}

export interface DraftInput {
  post_type: PostType;
  lang: Lang;
  platform?: Platform;
  fields: Record<string, unknown>;
  pillar?: string | null;
  icp?: string | null;
  title?: string | null;
  source?: Record<string, unknown>;
  allowed_numbers?: number[];
  media?: Array<{ kind: "photo" | "video"; url?: string; asset_id?: string; file_id?: string }>;
  signal_id?: string | null;
  scheduled_at?: string | null;
  /** When the post is meant to go out (the batch plan); scheduled_at is what the publisher acts on. */
  planned_for?: string | null;
  /** The Wednesday batch this draft belongs to: the Monday it is for, and its number in the list. */
  batch?: { week: string; no: number };
  actor: string;
  /** Skip the template and use this body verbatim (results replies built from the board). */
  body_override?: string;
}

export interface DraftResult {
  content_id: string;
  variant_id: string;
  body: string;
  status: Status;
  compliance: CheckResult;
  needed: string[];
}

export async function createDraft(input: DraftInput): Promise<DraftResult> {
  const platform = input.platform ?? "telegram";
  let body: string;
  let needed: string[] = [];
  let templateId: string | null = null;
  if (input.body_override !== undefined) {
    body = input.body_override;
  } else {
    const tpl = await loadTemplate(input.post_type, input.lang);
    templateId = tpl.id;
    ({ body, needed } = render(tpl, input.fields));
  }

  const compliance = check({
    post_type: input.post_type,
    platform,
    lang: input.lang,
    body,
    allowed_numbers: input.allowed_numbers,
    long_form: ["lesson", "start_here", "channel_audit"].includes(input.post_type),
    has_media: (input.media?.length ?? 0) > 0,
  });

  const db = admin();
  const { data: item, error: e1 } = await db
    .from("content_items")
    .insert({
      post_type: input.post_type,
      lang: input.lang,
      pillar: input.pillar ?? null,
      icp: input.icp ?? null,
      title: input.title ?? null,
      status: "draft",
      template_id: templateId,
      source: input.source ?? {},
      signal_id: input.signal_id ?? null,
      scheduled_at: input.scheduled_at ?? null,
      planned_for: input.planned_for ?? null,
      batch_week: input.batch?.week ?? null,
      batch_no: input.batch?.no ?? null,
      created_by: input.actor,
    })
    .select("id")
    .single();
  if (e1 || !item) throw new HttpError(503, "upstream_failed", `content_items: ${e1?.message}`);

  const { data: variant, error: e2 } = await db
    .from("content_variants")
    .insert({
      content_id: item.id,
      platform,
      lang: input.lang,
      body,
      media: input.media ?? [],
      claim_flags: compliance.claim_flags,
      needed_fields: needed,
      compliance,
    })
    .select("id")
    .single();
  if (e2 || !variant) throw new HttpError(503, "upstream_failed", `content_variants: ${e2?.message}`);

  await db.from("compliance_checks").insert({
    variant_id: variant.id,
    ok: compliance.ok,
    needs_approval: compliance.needs_approval,
    findings: compliance.findings,
  });

  await logAction({
    actor: input.actor,
    action: "content.draft",
    target: item.id,
    payload: { post_type: input.post_type, lang: input.lang, platform, needed, ok: compliance.ok },
  });
  await logTimeSaved(input.actor, "content.draft", item.id);

  return {
    content_id: item.id,
    variant_id: variant.id,
    body,
    status: "draft",
    compliance,
    needed,
  };
}

export async function setStatus(
  content_id: string,
  status: Status,
  actor: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin()
    .from("content_items")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", content_id);
  if (error) throw new HttpError(503, "upstream_failed", `status update: ${error.message}`);
  await logAction({ actor, action: `content.${status}`, target: content_id, payload: extra });
}

/** Resolve the 8-hex short id from a callback button to the full content id. */
/**
 * The uuid range a short id covers. The short id is the uuid's first 8 hex
 * chars (its whole first group), so every match lies between these bounds.
 * A range, because Postgres has no LIKE on uuid: `.ilike("id", …)` failed with
 * "operator does not exist: uuid ~~* unknown" and every Desk button answered
 * "That draft is gone".
 */
export function shortIdRange(short: string): { from: string; to: string } {
  const s = short.toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(s)) throw notFound("draft");
  return { from: `${s}-0000-0000-0000-000000000000`, to: `${s}-ffff-ffff-ffff-ffffffffffff` };
}

export async function resolveShort(short: string): Promise<string> {
  const { from, to } = shortIdRange(short);
  const { data, error } = await admin()
    .from("content_items")
    .select("id")
    .gte("id", from)
    .lte("id", to)
    .limit(2);
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  if (!data || data.length === 0) throw notFound("draft");
  if (data.length > 1) throw new HttpError(409, "conflict", "short id is ambiguous");
  return data[0].id as string;
}

/** Resolve an 8-hex variant prefix the same way (Wave 3 item 6: Pick buttons). */
export async function resolveVariantShort(short: string): Promise<string> {
  const { from, to } = shortIdRange(short);
  const { data, error } = await admin()
    .from("content_variants")
    .select("id")
    .gte("id", from)
    .lte("id", to)
    .limit(2);
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  if (!data || data.length === 0) throw notFound("variant");
  if (data.length > 1) throw new HttpError(409, "conflict", "short id is ambiguous");
  return data[0].id as string;
}

/**
 * Post the draft to the EzyMap Desk group with the approval keyboard and
 * record the message id on the item (plan §9.C.13–14).
 */
export async function pushToDesk(
  draft: DraftResult,
  opts: { heading?: string; photo?: string; actor: string },
): Promise<{ chat_id: number; message_id: number }> {
  const deskId = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
  const findings = draft.compliance.findings;
  const checks = findings.length
    ? findings.map((f) => `${f.severity === "blocking" ? "✗" : f.severity === "needs_approval" ? "!" : "·"} ${escapeHtml(f.message)}`).join("\n")
    : "✓ checks clear";
  const header = `<b>${escapeHtml(opts.heading ?? "Draft")}</b> <code>#${draft.content_id.slice(0, 8)}</code>`;
  const text = `${header}\n\n${escapeHtml(draft.body)}\n\n<i>${checks}</i>`;
  const buttons = approvalKeyboard(draft.content_id);
  const msg = opts.photo
    ? await sendPhoto(deskId, opts.photo, text.slice(0, TELEGRAM_CAPTION_LIMIT), { parse_mode: "HTML", buttons })
    : await sendMessage(deskId, text.slice(0, 4096), {
      parse_mode: "HTML",
      buttons,
      disable_web_page_preview: true,
    });
  await setStatus(draft.content_id, "pending_approval", opts.actor, {
    desk_chat_id: msg.chat.id,
    desk_message_id: msg.message_id,
  });
  return { chat_id: msg.chat.id, message_id: msg.message_id };
}

export interface ContentRow {
  id: string;
  post_type: PostType;
  lang: Lang;
  status: Status;
  signal_id: string | null;
  scheduled_at: string | null;
  desk_chat_id: number | null;
  desk_message_id: number | null;
  source?: Record<string, unknown> | null;
}

export async function loadContent(id: string): Promise<ContentRow> {
  const { data, error } = await admin()
    .from("content_items")
    .select("id, post_type, lang, status, signal_id, scheduled_at, desk_chat_id, desk_message_id, source")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  if (!data) throw notFound("content item");
  return data as ContentRow;
}

/**
 * Delayed first-comment jobs (plan §17 Wave 4 item 2): one `comment` job per
 * telegram variant, due first_comment_delay_min after the post. The comment
 * text rides in result (the queue has no payload column); kind keeps the
 * comment job apart from the post job for the same variant.
 */
export interface CommentJobRow {
  content_id: string;
  variant_id: string;
  platform: string;
  kind: "comment";
  run_at: string;
  status: "queued";
  attempts: number;
  result: { first_comment: string };
  created_by: string;
}

export function buildCommentJobs(
  content_id: string,
  variants: Array<{ id: string; platform: string }>,
  run_at: string,
  firstComment: string | null | undefined,
  delayMin: number | null | undefined,
  actor: string,
): CommentJobRow[] {
  if (!firstComment) return [];
  const due = new Date(Date.parse(run_at) + Math.max(delayMin ?? 30, 1) * 60_000).toISOString();
  return variants
    .filter((v) => v.platform === "telegram") // replies under the channel message only
    .map((v) => ({
      content_id,
      variant_id: v.id,
      platform: v.platform,
      kind: "comment" as const,
      run_at: due,
      status: "queued" as const,
      attempts: 0,
      result: { first_comment: firstComment },
      created_by: actor,
    }));
}

/** Create one publish_jobs row per variant (plan §9.E.30), plus comment jobs. */
export async function enqueuePublish(
  content_id: string,
  run_at: string,
  actor: string,
): Promise<number> {
  const db = admin();
  const { data: variants, error } = await db
    .from("content_variants")
    .select("id, platform, source")
    .eq("content_id", content_id);
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  // Only what Jack approved goes out: never an unpicked AI angle.
  const publishable = (variants ?? []).filter((v) => isPublishableVariant(v.source as Record<string, unknown> | null));
  const rows = publishable.map((v) => ({
    content_id,
    variant_id: v.id,
    platform: v.platform,
    kind: "post",
    run_at,
    status: "queued",
    attempts: 0,
    created_by: actor,
  }));
  if (rows.length) {
    const { error: e2 } = await db
      .from("publish_jobs")
      .upsert(rows, { onConflict: "variant_id,kind", ignoreDuplicates: true });
    if (e2) throw new HttpError(503, "upstream_failed", e2.message);
    // Approval may have queued these jobs before /schedule ran (or a job may
    // have failed earlier): the ignoreDuplicates upsert above leaves the old
    // run_at on the existing row, so the post would go out at the old time
    // while the item says otherwise. Move waiting jobs to the new time and
    // requeue failed ones. Done/claimed jobs are history — never touched.
    for (const v of publishable) {
      await db.from("publish_jobs").update({ run_at }).eq("variant_id", v.id).eq("kind", "post")
        .in("status", ["queued"]);
      await db.from("publish_jobs").update({
        status: "queued", run_at, attempts: 0, last_error: null,
      }).eq("variant_id", v.id).eq("kind", "post").in("status", ["failed"]);
    }
  }
  const { data: item } = await db.from("content_items")
    .select("first_comment, first_comment_delay_min").eq("id", content_id).maybeSingle();
  const comments = buildCommentJobs(
    content_id,
    publishable.map((v) => ({ id: v.id as string, platform: String(v.platform) })),
    run_at,
    (item?.first_comment as string | null) ?? null,
    Number(item?.first_comment_delay_min ?? 30),
    actor,
  );
  if (comments.length) {
    const { error: e3 } = await db
      .from("publish_jobs")
      .upsert(comments, { onConflict: "variant_id,kind", ignoreDuplicates: true });
    if (e3) throw new HttpError(503, "upstream_failed", e3.message);
  }
  await setStatus(content_id, "scheduled", actor, { scheduled_at: run_at });
  return rows.length;
}

/** What a body looks like once it is a poll: the poll itself, and the prose around it. */
export interface PollParts {
  question: string;
  options: string[];
  preamble: string;
  postamble: string;
}

const OPTION_MARK = /^\s*(?:[-•*–]|\d{1,2}[.)])\s+/;
const POLL_LIMITS = { question: 300, option: 100, options: 10 };

/**
 * Read a Telegram poll out of a drafted body.
 *
 * The poll template renders a question line, a bulleted option list and two
 * lines of prose around it (plan §9.E.36 asks for a *native* poll, because
 * its results feed next week's lesson topics). This finds that shape and
 * returns the pieces; anything that is not clearly a poll is null, and the
 * publisher falls back to sending the body as ordinary text — never the other
 * way round, so a prose post can never become a broken poll.
 */
export function parsePoll(body: string): PollParts | null {
  const lines = (body ?? "").split("\n");
  const qi = lines.findIndex((l) => l.trim().endsWith("?") && !OPTION_MARK.test(l));
  if (qi < 0) return null;

  const raw = lines[qi].trim();
  const question = raw.length > POLL_LIMITS.question ? raw.slice(0, POLL_LIMITS.question - 1).trimEnd() + "?" : raw;

  const options: string[] = [];
  let blank = false;
  let i = qi + 1;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) {
      blank = true;
      continue;
    }
    if (!OPTION_MARK.test(lines[i])) break;
    // A blank line inside the list ends it: that is where the prose resumes.
    if (blank && options.length) break;
    blank = false;
    const text = lines[i].replace(OPTION_MARK, "").trim();
    if (text) options.push(text.slice(0, POLL_LIMITS.option));
    if (options.length === POLL_LIMITS.options) { i += 1; break; }
  }
  if (options.length < 2) return null;

  return {
    question,
    options,
    preamble: lines.slice(0, qi).join("\n").trim(),
    postamble: lines.slice(i).join("\n").trim(),
  };
}
