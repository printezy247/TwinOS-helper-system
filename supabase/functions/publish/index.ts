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
 * Telegram, Instagram, Facebook Reels and Threads are providers (the Meta ones
 * live in _shared/meta.ts and need their secrets; without them the job fails as
 * `permanent: … is not configured`, so nothing silently queues). YouTube, TikTok
 * and X are publish kits, never providers.
 */
import { serve, json, readJson, bad } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { parsePoll, setStatus } from "_shared/content.ts";
import { check as complianceCheck, checkComment, TELEGRAM_CAPTION_LIMIT } from "_shared/compliance.ts";
import {
  classify, isUnknownOutcome, MAX_ATTEMPTS, retryPlan, type Kind, unknownOutcomePatch,
} from "_shared/backoff.ts";
import { deskAlert } from "_shared/alerts.ts";
import {
  DAILY_CAPS, metaConfigFromEnv, type MetaPlatform, publishFacebookReel, publishInstagram, publishThreads,
} from "_shared/meta.ts";
import { logAction, logTimeSaved, sanitizeError } from "_shared/log.ts";
import * as tg from "_shared/tg.ts";

const PACE_MS = 1100; // Telegram: ~1 msg/s to one chat, 20/min to a group

interface Job {
  id: string;
  content_id: string;
  variant_id: string;
  platform: string;
  kind: string;
  attempts: number;
  result?: { unknown_hold?: boolean; held_at?: string; first_comment?: string } | null;
}

interface Variant {
  id: string;
  body: string;
  platform: string;
  lang: "en" | "ms";
  media: Array<{ kind: "photo" | "video"; url?: string; file_id?: string; asset_id?: string; caption?: string }>;
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
    .select("id, content_id, variant_id, platform, kind, attempts, result")
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

async function sendTelegram(item: Item, v: Variant): Promise<{ chat_id: number; message_id: number; poll_id?: string }> {
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
  // A poll post type goes out as a real poll, not as four lines of prose: the
  // tally is public in the channel and is the only read on what members want
  // next week's lesson to be. The prose around the poll still posts, before and
  // after, because the template writes an intro and a note on how answers are
  // used. A body that does not parse as a poll falls through to the text path
  // unchanged, so nothing can go out as a broken half-poll.
  const poll = item.post_type === "poll" ? parsePoll(v.body) : null;
  if (poll) {
    if (poll.preamble) await tg.sendMessage(chatId, poll.preamble, opts);
    msg = await tg.sendPoll(chatId, poll.question, poll.options, opts);
    if (poll.postamble) await tg.sendMessage(chatId, poll.postamble, opts);
  } else if (media.length >= 2) {
    const group = await tg.sendMediaGroup(
      chatId,
      media.slice(0, 10).map((m, i) => ({
        type: m.kind,
        media: m.file_id ?? m.url ?? "",
        caption: i === 0 ? v.body.slice(0, TELEGRAM_CAPTION_LIMIT) : undefined,
        parse_mode: "HTML" as const,
      })),
      opts,
    );
    msg = group[0];
  } else if (media.length === 1 && media[0].kind === "photo") {
    msg = await tg.sendPhoto(chatId, media[0].file_id ?? media[0].url ?? "", v.body.slice(0, TELEGRAM_CAPTION_LIMIT), opts);
  } else if (media.length === 1 && media[0].kind === "video") {
    msg = await tg.sendVideo(chatId, media[0].file_id ?? media[0].url ?? "", v.body.slice(0, TELEGRAM_CAPTION_LIMIT), opts);
  } else {
    msg = await tg.sendMessage(chatId, v.body, opts);
  }
  if (item.pin) {
    try { await tg.pinChatMessage(chatId, msg.message_id); } catch (e) { console.warn("[publish] pin failed", e); }
  }
  // The poll's id is what `update.poll` will arrive with later, and the only
  // link from a tally back to the post that asked it.
  return { chat_id: msg.chat.id, message_id: msg.message_id, poll_id: msg.poll?.id };
}

/* ---------- Instagram, Facebook Reels, Threads (_shared/meta.ts) ---------- */
// Secrets: TWINOS_META_IG_*, TWINOS_META_PAGE_*, TWINOS_THREADS_* (docs/SETUP.md 3.1).
// A provider with no credentials fails its job as permanent, with the secret names in the message.
const meta = metaConfigFromEnv((k) => Deno.env.get(k));

/** A URL Meta can fetch: the one stored on the variant, else a one-hour signed link to the private asset. */
async function mediaUrl(v: Variant, kind: "photo" | "video"): Promise<string | undefined> {
  const m = (v.media ?? []).find((x) => x.kind === kind);
  if (!m) return undefined;
  if (m.url) return m.url;
  if (!m.asset_id) return undefined;
  const db = admin();
  const { data: a } = await db.from("assets").select("storage_bucket, bucket, storage_path").eq("id", m.asset_id).maybeSingle();
  const bucket = a?.bucket ?? a?.storage_bucket;
  if (!bucket || !a?.storage_path) return undefined;
  const { data } = await db.storage.from(bucket).createSignedUrl(a.storage_path, 3600);
  return data?.signedUrl;
}

/** Hold the job when the platform's 24 h API cap is used up (it retries in half an hour). */
async function underCap(platform: MetaPlatform): Promise<void> {
  const { count } = await admin().from("publish_jobs").select("id", { count: "exact", head: true })
    .eq("platform", platform).eq("status", "done").gte("done_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= DAILY_CAPS[platform]) {
    throw new Error(`capped: ${platform} has reached ${DAILY_CAPS[platform]} posts in 24 h`);
  }
}

async function sendInstagram(_item: Item, v: Variant): Promise<{ id: string }> {
  if (!meta.instagram) throw new Error("permanent: instagram is not configured (TWINOS_META_IG_USER_ID, TWINOS_META_IG_TOKEN)");
  await underCap("instagram");
  return await publishInstagram(meta.instagram, { caption: v.body, videoUrl: await mediaUrl(v, "video"), imageUrl: await mediaUrl(v, "photo") });
}
async function sendFacebook(_item: Item, v: Variant): Promise<{ id: string }> {
  if (!meta.facebook) throw new Error("permanent: facebook is not configured (TWINOS_META_PAGE_ID, TWINOS_META_PAGE_TOKEN)");
  const videoUrl = await mediaUrl(v, "video");
  if (!videoUrl) throw new Error("permanent: a facebook reel needs a video");
  await underCap("facebook");
  return await publishFacebookReel(meta.facebook, { description: v.body, videoUrl });
}
async function sendThreads(_item: Item, v: Variant): Promise<{ id: string }> {
  if (!meta.threads) throw new Error("permanent: threads is not configured (TWINOS_THREADS_USER_ID, TWINOS_THREADS_TOKEN)");
  await underCap("threads");
  return await publishThreads(meta.threads, { text: v.body, videoUrl: await mediaUrl(v, "video"), imageUrl: await mediaUrl(v, "photo") });
}
// YouTube, TikTok and X are publish kits (plan §6): never a provider here.

async function run(job: Job, actor: string): Promise<{ ok: boolean; kind: Kind; reason?: string }> {
  const db = admin();
  const [{ data: item }, { data: variant }] = await Promise.all([
    db.from("content_items")
      .select("id, post_type, status, signal_id, reply_to_message_id, pin, target_chat_id, result_status")
      .eq("id", job.content_id).maybeSingle(),
    db.from("content_variants")
      .select("id, body, platform, lang, media, buttons, compliance, claim_flags, needed_fields")
      .eq("id", job.variant_id).maybeSingle(),
  ]);
  if (!item || !variant) return { ok: false, kind: "permanent", reason: "item or variant missing" };
  // A comment goes out after its post, when the item is already published.
  const allowed = job.kind === "comment" ? ["approved", "scheduled", "publishing", "published"] : ["approved", "scheduled", "publishing"];
  if (!allowed.includes(item.status)) {
    return { ok: false, kind: "permanent", reason: `item status ${item.status}` };
  }

  // Delayed first comment (Wave 4 item 2): a reply under the channel post,
  // re-checked before it goes out. No post yet (clock skew, requeue) means
  // wait, not fail: hold the job with a short backoff.
  if (job.kind === "comment") {
    const text = String(job.result?.first_comment ?? "").trim();
    if (!text) return { ok: false, kind: "permanent", reason: "comment job has no text" };
    if (job.platform !== "telegram") {
      return { ok: false, kind: "permanent", reason: `comments post to telegram, not ${job.platform}` };
    }
    const { data: posted } = await db.from("tg_posts")
      .select("chat_id, message_id")
      .eq("variant_id", job.variant_id)
      .order("posted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!posted) return { ok: false, kind: "throttled", reason: "post not out yet; the comment waits" };
    const commentCheck = checkComment(text, item.post_type as never, variant.lang);
    if (!commentCheck.ok) {
      return { ok: false, kind: "permanent", reason: "comment blocked: " + commentCheck.findings.map((f) => f.message).join("; ") };
    }
    await tg.sendMessage(posted.chat_id as number, text, {
      parse_mode: "HTML",
      reply_to_message_id: posted.message_id as number,
      disable_web_page_preview: true,
    });
    return { ok: true, kind: "success" };
  }

  // Last line of defence: re-run the checklist on the exact body going out.
  const final = complianceCheck({
    post_type: item.post_type as never, platform: variant.platform as never, lang: variant.lang, body: variant.body,
    has_media: (variant.media?.length ?? 0) > 0,
  });
  if (!final.ok || (variant.needed_fields ?? []).length) {
    return { ok: false, kind: "permanent", reason: "compliance block at publish: " + final.findings.map((f) => f.message).join("; ") };
  }

  // Board-sourced result replies must stay claim-free (the DB guard enforces
  // it when the board_rule approval is written). Re-check on the body going
  // out, so a variant edited into carrying price/offer claims in the window
  // between approval and publish can never ride a board_rule approval out.
  if (item.post_type === "result_reply") {
    const claims = (variant.claim_flags ?? []) as string[];
    if (claims.includes("price") || claims.includes("offer")) {
      const { data: approval } = await db.from("approvals")
        .select("via, by_actor").eq("content_id", item.id).eq("decision", "approve")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (approval && approval.via === "board_rule" && approval.by_actor !== "jack") {
        return { ok: false, kind: "permanent", reason: "result reply carries a price/offer claim the board rule cannot approve" };
      }
    }
  }

  await setStatus(item.id, "publishing", actor);
  let posted: { chat_id: number; message_id: number; poll_id?: string } | null = null;
  let externalId: string | null = null;
  try {
    switch (job.platform) {
      case "telegram": posted = await sendTelegram(item as Item, variant as Variant); break;
      case "instagram": externalId = (await sendInstagram(item as Item, variant as Variant)).id; break;
      case "facebook": externalId = (await sendFacebook(item as Item, variant as Variant)).id; break;
      case "threads": externalId = (await sendThreads(item as Item, variant as Variant)).id; break;
      default: throw new Error(`permanent: ${job.platform} is a publish kit, not a provider`);
    }
  } catch (err) {
    const c = classify(err);
    await setStatus(item.id, c.kind === "permanent" || job.attempts >= MAX_ATTEMPTS ? "failed" : "scheduled", actor, {
      last_error: sanitizeError(c.reason).slice(0, 500),
    });
    return { ok: false, ...c };
  }

  // The post is out. Bookkeeping errors from here must not make it look
  // unsent: a retry would post it twice. Log and carry on.
  try {
    if (posted) {
      await db.from("tg_posts").insert({
        chat_id: posted.chat_id, message_id: posted.message_id, content_id: item.id,
        variant_id: variant.id, post_type: item.post_type, posted_at: new Date().toISOString(),
        poll_id: posted.poll_id ?? null,
      });
      if (item.signal_id) {
        if (item.post_type === "result_reply") {
          // results.replyUnderCard pre-claimed (signal_id, status_posted) with a
          // null message_id; fill the claim in — never insert a second row, or
          // the dedupe guard breaks and the same result posts twice.
          await db.from("signal_posts").update({
            chat_id: posted.chat_id, message_id: posted.message_id, posted_at: new Date().toISOString(),
          }).eq("content_id", item.id).eq("kind", "result");
        } else {
          await db.from("signal_posts").insert({
            signal_id: item.signal_id, chat_id: posted.chat_id, message_id: posted.message_id,
            content_id: item.id, kind: item.post_type === "result_reply" ? "result" : "signal",
            status_posted: item.result_status ?? null,
          });
        }
      }
    }
    await setStatus(item.id, "published", actor, {
      published_at: new Date().toISOString(),
      published_ref: posted ? `${posted.chat_id}:${posted.message_id}` : externalId,
    });
    await logTimeSaved(actor, "content.publish", item.id);
    await logTimeSaved(actor, "log.row", item.id);
  } catch (err) {
    await logAction({ actor, action: "publish.bookkeeping_failed", target: item.id, payload: { error: String(err).slice(0, 300) } });
  }
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
  let claimRaces = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimOne();
    if (!job) {
      // claimOne returns null both for "queue empty" and for "picked a job but
      // lost the atomic claim to a concurrent tick". Only stop when nothing is
      // actually due; a lost race keeps going (capped, in case another tick
      // keeps winning every row).
      const { count } = await db.from("publish_jobs").select("id", { count: "exact", head: true })
        .eq("status", "queued").lte("run_at", new Date().toISOString());
      if ((count ?? 0) === 0 || (claimRaces += 1) >= 3) break;
      continue;
    }
    claimRaces = 0;
    const wait = PACE_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();

    let r: { ok: boolean; kind: Kind; reason?: string };
    try {
      r = await run(job, caller.actor);
    } catch (err) {
      // Unknown whether the send happened: treat it like a timeout (parked).
      r = { ok: false, kind: "unknown", reason: `run failed: ${String(err).slice(0, 200)}` };
    }
    if (r.ok) {
      await db.from("publish_jobs").update({ status: "done", done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
    } else if (r.kind === "permanent" || (job.attempts >= MAX_ATTEMPTS && retryPlan(job.attempts, r.reason ?? "").burnsAttempt)) {
      await db.from("publish_jobs").update({ status: "failed", last_error: r.reason ?? r.kind }).eq("id", job.id);
      await deskAlert({
        db,
        key: `failed:${job.content_id}:${job.platform}`,
        kind: "publish_failed",
        severity: "high",
        message: `\u274C Publish failed for #${job.content_id.slice(0, 8)} (${job.platform}): ${tg.escapeHtml(r.reason ?? r.kind)}`,
      });
    } else {
      // Ordinary failures retry with backoff. Unknown outcomes (the send may
      // have landed) are parked below. This covers Telegram and every fan-out
      // child: they share this queue.
      const reason = r.reason ?? r.kind;
      const unknown = r.kind === "unknown" && (isUnknownOutcome(reason) || reason.startsWith("run failed:"));
      if (unknown) {
        // It may already be posted. Never re-send on a timer: park the job and
        // let Jack answer on the Desk (It's posted / Send again).
        await db.from("publish_jobs").update({ ...unknownOutcomePatch(job.result, new Date().toISOString()), last_error: reason })
          .eq("id", job.id);
        await deskAlert({
          db,
          key: `unknown:${job.content_id}:${job.platform}`,
          kind: "publish_unknown",
          severity: "medium",
          cooldownMs: 0,
          message: `\u26A0\uFE0F Send to ${job.platform} timed out \u2014 it may already be posted. Check, then tell me:`,
          buttons: tg.heldKeyboard(job.content_id, job.platform),
        });
      } else {
        const plan = retryPlan(job.attempts, reason);
        await db.from("publish_jobs").update({
          status: "queued",
          run_at: new Date(Date.now() + plan.delayMs).toISOString(),
          last_error: reason,
          ...(plan.burnsAttempt ? {} : { attempts: Math.max(job.attempts - 1, 0) }),
        }).eq("id", job.id);
      }
    }
    results.push({ job_id: job.id, content_id: job.content_id, platform: job.platform, ...r });
  }

  // Stuck jobs: claimed > 10 min ago (the function died, maybe mid-send).
  // Re-queueing could post twice, so they are parked and Jack is asked.
  const { data: stuck } = await db.from("publish_jobs").select("id, content_id, platform, result")
    .eq("status", "claimed").lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());
  for (const j of stuck ?? []) {
    await db.from("publish_jobs").update({
      ...unknownOutcomePatch(j.result as Record<string, unknown> | null, new Date().toISOString()),
      last_error: "claimed for over 10 minutes; may have posted",
    }).eq("id", j.id);
    await deskAlert({
      db,
      key: `unknown:${j.content_id}:${j.platform}`,
      kind: "publish_unknown",
      severity: "medium",
      cooldownMs: 0,
      message: `\u26A0\uFE0F A send to ${j.platform} stopped half-way \u2014 it may already be posted. Check, then tell me:`,
      buttons: tg.heldKeyboard(j.content_id as string, j.platform as string),
    });
  }

  await db.from("health_checks").insert({ source: "scheduler", status: "ok", detail: { ran: results.length } });
  await logAction({ actor: caller.actor, action: "publish.tick", payload: { ran: results.length } });
  return json({ ran: results.length, results });
});
