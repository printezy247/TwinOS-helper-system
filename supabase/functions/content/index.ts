/**
 * content — draft from a template, request approval, schedule.
 *
 *   POST /content/draft                     { post_type, lang, fields, platform?, pillar?, icp?,
 *                                             media?, allowed_numbers?, push_to_desk? }
 *   POST /content/{id}/request-approval     {}
 *   POST /content/{id}/schedule             { run_at }   (claim posts: jack only)
 *   GET  /content/{id}                      → item + variants + checks
 *
 * Who: jack, abdul, cron, ops_bot (plan §11). Idempotency-Key honoured on POSTs.
 */
import { serve, json, readJson, routeOf, reqString, oneOf, bad, notFound } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin } from "_shared/supabase.ts";
import { createDraft, enqueuePublish, loadContent, pushToDesk } from "_shared/content.ts";
import { logAction } from "_shared/log.ts";
import type { Lang, Platform, PostType } from "_shared/compliance.ts";

const POST_TYPES: readonly PostType[] = [
  "gold_map", "macro_card", "signal_card", "result_reply", "lesson", "channel_audit", "scorecard",
  "outlook", "offer", "poll", "evening_wrap", "news_alert", "member_result", "holiday", "start_here",
];
const PLATFORMS: readonly Platform[] = ["telegram", "instagram", "facebook", "threads", "youtube", "tiktok", "x"];
const LANGS: readonly Lang[] = ["en", "ms"];

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "content");

  if (method === "GET" && tail.length === 1) {
    requireRole(caller.role, "reports.read");
    const id = tail[0];
    const db = admin();
    const [{ data: item }, { data: variants }] = await Promise.all([
      db.from("content_items").select("*").eq("id", id).maybeSingle(),
      db.from("content_variants").select("*").eq("content_id", id),
    ]);
    if (!item) throw notFound("content item");
    return json({ item, variants: variants ?? [] });
  }

  if (method !== "POST") throw bad("method not allowed");
  const body = await readJson(req, true);

  // POST /content/draft
  if (tail[0] === "draft") {
    requireRole(caller.role, "content.draft");
    const idem = await idemFrom(req, body, `content.draft:${caller.actor}`);
    const hit = await replay(idem);
    if (hit) return hit;

    const post_type = oneOf(body, "post_type", POST_TYPES);
    const lang = oneOf(body, "lang", LANGS, "en");
    const platform = oneOf(body, "platform", PLATFORMS, "telegram");
    const fields = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<string, unknown>;
    const allowed = Array.isArray(body.allowed_numbers)
      ? body.allowed_numbers.map(Number).filter(Number.isFinite)
      : undefined;
    const media = Array.isArray(body.media) ? body.media as DraftMedia[] : undefined;

    const draft = await createDraft({
      post_type, lang, platform, fields, allowed_numbers: allowed, media,
      pillar: typeof body.pillar === "string" ? body.pillar : null,
      icp: typeof body.icp === "string" ? body.icp : null,
      title: typeof body.title === "string" ? body.title.slice(0, 200) : null,
      source: { via: "content.draft", actor: caller.actor },
      actor: caller.actor,
    });

    let desk: { chat_id: number; message_id: number } | null = null;
    if (body.push_to_desk === true) {
      desk = await pushToDesk(draft, { heading: post_type.replace("_", " "), actor: caller.actor });
    }
    return remember(idem, 201, { ...draft, desk });
  }

  // POST /content/{id}/request-approval | /content/{id}/schedule
  if (tail.length === 2) {
    const id = tail[0];
    const item = await loadContent(id);

    if (tail[1] === "request-approval") {
      requireRole(caller.role, "content.request_approval");
      if (item.status !== "draft" && item.status !== "pending_approval") {
        throw bad(`cannot request approval from status ${item.status}`);
      }
      const { data: v } = await admin()
        .from("content_variants").select("id, body, compliance, needed_fields").eq("content_id", id).limit(1).maybeSingle();
      if (!v) throw notFound("variant");
      const desk = await pushToDesk(
        { content_id: id, variant_id: v.id, body: v.body, status: "draft", compliance: v.compliance, needed: v.needed_fields ?? [] },
        { heading: item.post_type.replace("_", " "), actor: caller.actor },
      );
      return json({ ok: true, desk });
    }

    if (tail[1] === "schedule") {
      const run_at = reqString(body, "run_at");
      if (Number.isNaN(Date.parse(run_at))) throw bad("run_at must be an ISO timestamp");
      // Claim posts (price/result/offer/signal/map) may only be scheduled by Jack,
      // and only after approval. Everything else: approved → schedule by abdul/cron.
      const { data: v } = await admin()
        .from("content_variants").select("claim_flags, compliance").eq("content_id", id).limit(1).maybeSingle();
      const hasClaim = (v?.claim_flags ?? []).length > 0;
      requireRole(caller.role, hasClaim ? "content.schedule_claim" : "content.schedule");
      if (item.status !== "approved") throw bad(`only approved items can be scheduled (status ${item.status})`);
      if (v?.compliance && v.compliance.ok === false) throw bad("compliance findings block scheduling");
      const idem = await idemFrom(req, body, `content.schedule:${id}`);
      const hit = await replay(idem);
      if (hit) return hit;
      const jobs = await enqueuePublish(id, new Date(run_at).toISOString(), caller.actor);
      return remember(idem, 200, { ok: true, content_id: id, jobs, run_at });
    }
  }

  await logAction({ actor: caller.actor, action: "content.bad_route", payload: { tail } });
  throw notFound("route");
});

interface DraftMedia { kind: "photo" | "video"; url?: string; asset_id?: string; file_id?: string }
