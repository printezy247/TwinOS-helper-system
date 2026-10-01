/**
 * publish — the scheduler tick (plan §9.E.32). pg_cron calls it every minute:
 *
 *   select net.http_post(url := '<project>/functions/v1/publish',
 *     headers := '{"Authorization":"Bearer <service role>","x-twinos-actor":"cron"}'::jsonb,
 *     body := '{"limit": 10}'::jsonb);
 *
 * Claims due `publish_jobs` (queued, run_at <= now) one by one with an atomic
 * UPDATE … WHERE status='queued' so two ticks never send the same post, sends
 * through the platform provider, records `tg_posts` / `signal_posts`, flips
 * the content item, and on failure reschedules with exponential backoff
 * (ported from the ops dashboard's outboundQueue + classifyMetaError).
 *
 * Phase 1: Telegram only. Instagram / Facebook / Threads are stubs that fail
 * the job as `permanent: provider not enabled` so nothing silently queues.
 */
import { serve, json, readJson, bad } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { setStatus } from "_shared/content.ts";
import { check as complianceCheck } from "_shared/compliance.ts";
import { logAction, logTimeSaved } from "_shared/log.ts";
import * as tg from "_shared/tg.ts";

const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60_000;
const PACE_MS = 1100; // Telegram: ~1 msg/s to one chat, 20/min to a group

type Kind = "success" | "throttled" | "permanent" | "unknown";

/** Ported from the ops dashboard's classifyMetaError, adapted to Bot API codes. */
function classify(err: unknown): { kind: Kind; reason: string } {
  if (err instanceof tg.TgError) {
    if (err.code === 429) return { kind: "throttled", reason: err.message };
    if (err.code >= 500) return { kind: "throttled", reason: err.message };
    if (err.code === 401 || err.code === 403) return { kind: "permanent", reason: err.message };
    if (/chat not found|message to reply not found|wrong file identifier|too long|can't parse/i.test(err.message)) {
      return { kind: "permanent", reason: err.message };
    }
    return { kind: "permanent", reason: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/permanent:/.test(msg)) return { kind: "permanent", reason: msg };
  return { kind: "unknown", reason: msg };
}

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_CAP_MS);
}

interface Job {
  id: string;
  content_id: string;
  variant_id: string;
  platform: string;
  attempts: number;
}

interface Variant {
  id: string;
  body: string;
  platform: string;
  lang: "en" | "ms";
  media: Array<{ kind: "photo" | "video"; url?: string; file_id?: string; caption?: string }>;
  buttons?: Array<{ label: string; url: string }>;
  compliance?: { ok: boolean };
  needed_fields?: string[];
}

interface Item {
  id: string;
  post_type: string;
  status: string;
  signal_id: string | null;
  reply_to_message_id: number | null;
  pin: boolean | null;
  target_chat_id: number | null;
}

async function claimOne(): Promise<Job | null> {
  const db = admin();
  const { data: due } = await db
    .from("publish_jobs")
    .select("id, content_id, variant_id, platform, attempts")
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!due) return null;
  const { data: claimed } = await db
    .from("publish_jobs")
    .update({ status: "claimed", claimed_at: new Date().toISOString(), attempts: due.attempts + 1 })
    .eq("id", due.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  return claimed ? { ...(due as Job), attempts: due.attempts + 1 } : null;
}

async function sendTelegram(item: Item, v: Variant): Promise<{ chat_id: number; message_id: number }> {
  const chatId = item.target_chat_id ?? Number(await requireSetting(SETTING_KEYS.channelId, "TWINOS_CHANNEL_ID"));
  const buttons = tg.buildKeyboard(v.buttons ?? [], 2);
  const opts: tg.SendOpts = {
    parse_mode: "HTML",
    reply_to_message_id: item.reply_to_message_id ?? undefined,
    buttons,
    disable_web_page_preview: true,
  };
  const media = v.media ?? [];
  let msg: tg.TgMessage;
  if (media.length >= 2) {
    const group = await tg.sendMediaGroup(
      chatId,
      media.slice(0, 10).map((m, i) => ({
        type: m.kind,
        media: m.file_id ?? m.url ?? "",
        caption: i === 0 ? v.body.slice(0, 1024) : undefined,
        parse_mode: "HTML" as const,
      })),
      opts,
    );
    msg = group[0];
  } else if (media.length === 1 && media[0].kind === "photo") {
    msg = await tg.sendPhoto(chatId, media[0].file_id ?? media[0].url ?? "", v.body.slice(0, 1024), opts);
  } else if (media.length === 1 && media[0].kind === "video") {
    msg = await tg.sendVideo(chatId, media[0].file_id ?? media[0].url ?? "", v.body.slice(0, 1024), opts);
  } else {
    msg = await tg.sendMessage(chatId, v.body, opts);
  }
  if (item.pin) {
    try { await tg.pinChatMessage(chatId, msg.message_id); } catch (e) { console.warn("[publish] pin failed", e); }
  }
  return { chat_id: msg.chat.id, message_id: msg.message_id };
}

/* ---------- Phase 3 stubs (limits verified 2026-10-01, plan §6/§9.F) ---------- */
// TODO(phase3): Instagram Reels/feed via Graph API content_publishing.
//   Limit: 100 API-published posts per 24 h per account. Needs Meta app in Live
//   mode with Standard Access; token in function secrets (TWINOS_META_TOKEN).
//   Flow: POST /{ig-user-id}/media (video_url, media_type=REELS, caption)
//         → poll status_code until FINISHED → POST /{ig-user-id}/media_publish.
function sendInstagram(_item: Item, _v: Variant): Promise<never> {
  return Promise.reject(new Error("permanent: instagram provider not enabled until Phase 3"));
}
// TODO(phase3): Facebook Page Reels via /{page-id}/video_reels (upload phase
//   start → upload → finish with description). Limit: 30 reels per 24 h per Page.
//   Posts from a development-mode app are not public; app must be Live.
function sendFacebook(_item: Item, _v: Variant): Promise<never> {
  return Promise.reject(new Error("permanent: facebook provider not enabled until Phase 3"));
}
// TODO(phase3): Threads via /{threads-user-id}/threads (text ≤500 chars, or
//   IMAGE/VIDEO with media url) → /threads_publish. Limit: 250 posts per 24 h.
function sendThreads(_item: Item, _v: Variant): Promise<never> {
  return Promise.reject(new Error("permanent: threads provider not enabled until Phase 3"));
}
// YouTube, TikTok and X are publish kits (plan §6): never a provider here.

async function run(job: Job, actor: string): Promise<{ ok: boolean; kind: Kind; reason?: string }> {
  const db = admin();
  const [{ data: item }, { data: variant }] = await Promise.all([
    db.from("content_items")
      .select("id, post_type, status, signal_id, reply_to_message_id, pin, target_chat_id")
      .eq("id", job.content_id).maybeSingle(),
    db.from("content_variants")
      .select("id, body, platform, lang, media, buttons, compliance, needed_fields")
      .eq("id", job.variant_id).maybeSingle(),
  ]);
  if (!item || !variant) return { ok: false, kind: "permanent", reason: "item or variant missing" };
  if (!["approved", "scheduled", "publishing"].includes(item.status)) {
    return { ok: false, kind: "permanent", reason: `item status ${item.status}` };
  }

  // Last line of defence: re-run the checklist on the exact body going out.
  const final = complianceCheck({
    post_type: item.post_type as never, platform: variant.platform as never, lang: variant.lang, body: variant.body,
  });
  if (!final.ok || (variant.needed_fields ?? []).length) {
    return { ok: false, kind: "permanent", reason: "compliance block at publish: " + final.findings.map((f) => f.message).join("; ") };
  }

  await setStatus(item.id, "publishing", actor);
  let posted: { chat_id: number; message_id: number } | null = null;
  try {
    switch (job.platform) {
      case "telegram": posted = await sendTelegram(item as Item, variant as Variant); break;
      case "instagram": await sendInstagram(item as Item, variant as Variant); break;
      case "facebook": await sendFacebook(item as Item, variant as Variant); break;
      case "threads": await sendThreads(item as Item, variant as Variant); break;
      default: throw new Error(`permanent: ${job.platform} is a publish kit, not a provider`);
    }
  } catch (err) {
    const c = classify(err);
    await setStatus(item.id, c.kind === "permanent" || job.attempts >= MAX_ATTEMPTS ? "failed" : "scheduled", actor, {
      last_error: c.reason.slice(0, 500),
    });
    return { ok: false, ...c };
  }

  if (posted) {
    await db.from("tg_posts").insert({
      chat_id: posted.chat_id, message_id: posted.message_id, content_id: item.id,
      variant_id: variant.id, post_type: item.post_type, posted_at: new Date().toISOString(),
    });
    if (item.signal_id) {
      await db.from("signal_posts").insert({
        signal_id: item.signal_id, chat_id: posted.chat_id, message_id: posted.message_id,
        content_id: item.id, kind: item.post_type === "result_reply" ? "result" : "signal",
      });
    }
  }
  await setStatus(item.id, "published", actor, {
    published_at: new Date().toISOString(),
    published_ref: posted ? `${posted.chat_id}:${posted.message_id}` : null,
  });
  await logTimeSaved(actor, "content.publish", item.id);
  await logTimeSaved(actor, "log.row", item.id);
  return { ok: true, kind: "success" };
}

serve(async (req) => {
  if (req.method !== "POST") throw bad("POST only");
  const caller = await authenticate(req);
  requireRole(caller.role, "publish.run");
  const body = await readJson(req, true);
  const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 25);

  const db = admin();
  const results: Array<Record<string, unknown>> = [];
  let last = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimOne();
    if (!job) break;
    const wait = PACE_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();

    const r = await run(job, caller.actor);
    if (r.ok) {
      await db.from("publish_jobs").update({ status: "done", done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
    } else if (r.kind === "permanent" || job.attempts >= MAX_ATTEMPTS) {
      await db.from("publish_jobs").update({ status: "failed", last_error: r.reason ?? r.kind }).eq("id", job.id);
      await db.from("alerts").insert({
        kind: "publish_failed", severity: "high",
        message: `publish failed for ${job.content_id} (${job.platform}): ${r.reason ?? r.kind}`,
        payload: { job_id: job.id, content_id: job.content_id },
      });
    } else {
      await db.from("publish_jobs").update({
        status: "queued",
        run_at: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
        last_error: r.reason ?? r.kind,
      }).eq("id", job.id);
    }
    results.push({ job_id: job.id, content_id: job.content_id, platform: job.platform, ...r });
  }

  // Stuck jobs: claimed > 10 min ago (function died mid-send) → back to queued.
  await db.from("publish_jobs").update({ status: "queued" })
    .eq("status", "claimed").lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());

  await db.from("health_checks").insert({ source: "scheduler", status: "ok", detail: { ran: results.length } });
  await logAction({ actor: caller.actor, action: "publish.tick", payload: { ran: results.length } });
  return json({ ran: results.length, results });
});
