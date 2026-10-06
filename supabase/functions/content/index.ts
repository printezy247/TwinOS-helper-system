/**
 * content — draft from a template, request approval, schedule.
 *
 *   POST /content/draft                     { post_type, lang, fields, platform?, pillar?, icp?,
 *                                             media?, allowed_numbers?, push_to_desk? }
 *   POST /content/annual-offer              { sku? }   annual-plan offer drafts from the products table (list without a sku)
 *   POST /content/batch                     { for?: YYYY-MM-DD, only?: ["lesson", ...] }   Wednesday 14:30 MYT
 *   POST /content/batch-sweep               {}                                             Thursday 09:00 MYT
 *   POST /content/{id}/fanout               { platforms?: [...], asset_id? }   one master -> a copy per platform
 *   POST /content/{id}/request-approval     {}
 *   POST /content/{id}/schedule             { run_at }   (claim posts: jack only)
 *   GET  /content/{id}                      → item + variants + checks
 *
 * Who: jack, abdul, cron, ops_bot (plan §11). Idempotency-Key honoured on POSTs.
 */
import { serve, json, readJson, routeOf, reqString, optString, oneOf, bad, HttpError, notFound } from "_shared/http.ts";
import { deskAlert } from "_shared/alerts.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin, requireSetting, setting, settingTyped, SETTING_KEYS } from "_shared/supabase.ts";
import { createDraft, enqueuePublish, loadContent, pushToDesk } from "_shared/content.ts";
import { fanOut, isStuckQueue } from "_shared/fanout.ts";
import { annualOffers, offerText, type ProductRow } from "_shared/offers.ts";
import { fanoutFailure, fanoutSummary } from "_shared/platforms.ts";
import { type PendingItem, pendingRows, type PendingVariant } from "_shared/inbox.ts";
import { logAction } from "_shared/log.ts";
import { sendMessage } from "_shared/tg.ts";
import { startOfDayInTz } from "_shared/time.ts";
import {
  cycleWeek, mondayOf, nextMonday, planBatch, runAtToInstant, slotToInstant, summaryLines, sweepPlan, topicTitle, type SweepItem,
} from "_shared/batch.ts";
import { LANGS, PLATFORMS, POST_TYPES, type PostType } from "_shared/compliance.ts";

const REMINDERS: Record<string, { post_type: PostType; text: string }> = {
  "remind-map": {
    post_type: "gold_map",
    text: "☀️ No map yet. Send the chart screenshot and 3–5 raw lines when you're ready; the draft comes back here.",
  },
  "remind-wrap": {
    post_type: "evening_wrap",
    text: "🌙 No evening line yet. Send <code>wrap: …</code> with how the day closed and I'll draft the wrap.",
  },
};

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "content");

  // GET /content/pending — the Mini App's approval list (it has no Supabase
  // login, so RLS would show it nothing). Same publish rules as approve.
  if (method === "GET" && tail.length === 1 && tail[0] === "pending") {
    requireRole(caller.role, "reports.read");
    const db = admin();
    const { data: items, error } = await db.from("content_items")
      .select("id, post_type, lang, status, title, created_at, scheduled_at, source")
      .in("status", ["pending_approval", "draft"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    const ids = (items ?? []).map((i) => i.id as string);
    let variants: PendingVariant[] = [];
    if (ids.length) {
      const { data: vars, error: vErr } = await db.from("content_variants")
        .select("id, content_id, platform, body, created_at, compliance, source")
        .in("content_id", ids);
      if (vErr) throw new HttpError(503, "upstream_failed", vErr.message);
      variants = (vars ?? []) as PendingVariant[];
    }
    return json({ items: pendingRows((items ?? []) as PendingItem[], variants) });
  }

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

  // POST /content/remind-map | /content/remind-wrap — the 07:40 / 19:55 nudge.
  // Once per day (idempotency key = the MYT date) and only when nothing arrived.
  const reminder = REMINDERS[tail[0] ?? ""];
  if (reminder) {
    requireRole(caller.role, "content.remind");
    const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
    const day = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const idem = { scope: `content.${tail[0]}`, key: day, requestHash: "-" };
    const hit = await replay(idem);
    if (hit) return hit;

    const { count } = await admin().from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("post_type", reminder.post_type)
      .gte("created_at", startOfDayInTz(tz));
    if ((count ?? 0) > 0) {
      return remember(idem, 200, { ok: true, skipped: `a ${reminder.post_type} already arrived today`, day });
    }

    const deskId = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
    await sendMessage(deskId, reminder.text, { parse_mode: "HTML" });
    await logAction({ actor: caller.actor, action: `content.${tail[0]}`, payload: { day } });
    return remember(idem, 200, { ok: true, reminded: true, day });
  }

  // POST /content/batch — the Wednesday batch (§9.C.18): next week's 7 lessons, the
  // Channel Audit, the poll and the offer as numbered drafts, then one numbered list
  // in the Desk. One run per week (the idempotency key is the Monday).
  if (tail[0] === "batch") {
    requireRole(caller.role, "content.batch");
    const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
    const forDay = typeof body.for === "string" && body.for ? body.for : null;
    if (forDay && !/^\d{4}-\d{2}-\d{2}$/.test(forDay)) throw bad("for must be YYYY-MM-DD");
    const monday = forDay ? mondayOf(forDay) : nextMonday(new Date(), tz);
    const only = Array.isArray(body.only) ? (body.only as unknown[]).map(String) : [];
    const idem = { scope: "content.batch", key: `${monday}:${[...only].sort().join(",")}`, requestHash: "-" };
    const hit = await replay(idem);
    if (hit) return hit;

    const db = admin();
    const { data: slotRows } = await db.from("calendar_slots").select("dow, time_local, post_type")
      .in("kind", ["channel_daily", "channel_weekly"]).eq("active", true);
    const { data: topicRows } = await db.from("calendar_slots").select("pillar, topic")
      .eq("kind", "tiktok_28day").eq("week_no", cycleWeek(monday)).in("pillar", ["lesson", "start_safe"]);
    const topicOf = (p: string) => topicTitle(topicRows?.find((t) => t.pillar === p)?.topic);

    // At most settings.offer_posts_per_week_max offer posts in the week.
    const weekFrom = slotToInstant(monday, 1, "00:00", tz);
    const weekTo = new Date(new Date(weekFrom).getTime() + 7 * 86_400_000).toISOString();
    const { count: offers } = await db.from("content_items").select("id", { count: "exact", head: true })
      .eq("post_type", "offer").not("status", "in", "(rejected,failed)")
      .gte("scheduled_at", weekFrom).lt("scheduled_at", weekTo);
    const offerMax = Number((await settingTyped(SETTING_KEYS.offerMaxPerWeek)) ?? 1);

    const plan = planBatch({
      monday, slots: slotRows ?? [], tz, only,
      topics: { lesson: topicOf("lesson"), start_safe: topicOf("start_safe") },
      offerAlready: (offers ?? 0) >= offerMax,
    });
    if (!plan.length) throw bad("no batch slots found in calendar_slots");

    // The audit quotes the board, never a number of ours: only when there is a closed signal to count.
    const { data: statRows } = await db.rpc("results_stats", {
      p_since: new Date(Date.now() - 28 * 86_400_000).toISOString(), p_until: new Date().toISOString(),
    });
    const stat = Array.isArray(statRows) ? statRows[0] : statRows;
    const board = stat && Number(stat.wins) + Number(stat.losses) > 0
      ? { wins: Number(stat.wins), losses: Number(stat.losses), total_r: Number(stat.total_r) }
      : null;

    const made: Array<{ n: number; post_type: string; content_id: string; needed: string[] }> = [];
    const failed: Array<{ n: number; error: string }> = [];
    const needed = new Map<number, string[]>();
    for (const item of plan) {
      const fields: Record<string, unknown> = {};
      let allowed: number[] | undefined;
      if (item.post_type === "lesson") {
        fields.label = item.label;
        if (item.title) fields.title = item.title;
      }
      if (item.post_type === "channel_audit" && board) {
        Object.assign(fields, board);
        allowed = [board.wins, board.losses, board.total_r];
      }
      try {
        const draft = await createDraft({
          post_type: item.post_type, lang: "en", fields, allowed_numbers: allowed,
          pillar: item.pillar, title: item.title, scheduled_at: item.when, planned_for: item.when,
          batch: { week: monday, no: item.n },
          source: { via: "batch", week: monday, n: item.n, label: item.label },
          actor: caller.actor,
        });
        needed.set(item.n, draft.needed);
        made.push({ n: item.n, post_type: item.post_type, content_id: draft.content_id, needed: draft.needed });
      } catch (err) {
        failed.push({ n: item.n, error: String(err).slice(0, 200) });
      }
    }

    const deskId = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
    const lines = summaryLines(plan.filter((i) => made.some((m) => m.n === i.n)), needed, tz);
    const text = [
      `<b>Wednesday batch</b> · week of ${monday}`,
      "",
      ...lines,
      ...(failed.length ? ["", `⚠️ not drafted: ${failed.map((f) => f.n).join(", ")}`] : []),
      "",
      "Reply <code>N: the text</code> to fill or replace a post (it comes back here with buttons), or <code>N: softer</code> for a rewrite.",
      "<code>/batch ok</code> approves what is ready and claim-free. A price, level, result or offer always needs your own tap.",
    ].join("\n");
    await sendMessage(deskId, text.slice(0, 4096), { parse_mode: "HTML", disable_web_page_preview: true });
    await logAction({ actor: caller.actor, action: "content.batch", payload: { monday, made: made.length, failed: failed.length } });
    return remember(idem, 201, { ok: true, week: monday, items: made, failed });
  }

  // POST /content/batch-sweep — Thursday: queue anything approved but unscheduled,
  // nudge the Desk about what still waits, flag slots that have already gone.
  if (tail[0] === "batch-sweep") {
    requireRole(caller.role, "content.batch");
    const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
    const now = new Date();
    const day = now.toLocaleDateString("en-CA", { timeZone: tz });
    const idem = { scope: "content.batch-sweep", key: day, requestHash: "-" };
    const hit = await replay(idem);
    if (hit) return hit;

    const monday = nextMonday(now, tz);
    const db = admin();
    const { data: items } = await db.from("content_items")
      .select("id, batch_no, status, scheduled_at").eq("batch_week", monday).order("batch_no");
    if (!items?.length) return remember(idem, 200, { ok: true, skipped: "no batch for the coming week", monday });

    const ids = items.map((i) => i.id as string);
    const { data: variants } = await db.from("content_variants")
      .select("content_id, needed_fields, claim_flags, compliance").in("content_id", ids);
    const { data: jobs } = await db.from("publish_jobs").select("content_id, status").in("content_id", ids);
    const queued = new Set((jobs ?? []).filter((j) => j.status !== "cancelled").map((j) => j.content_id as string));

    const sweepItems: SweepItem[] = items.map((i) => {
      const v = (variants ?? []).find((x) => x.content_id === i.id);
      return {
        id: i.id as string, n: i.batch_no as number, status: i.status as string,
        when: (i.scheduled_at as string | null) ?? now.toISOString(),
        needed: (v?.needed_fields as string[] | null) ?? [],
        claims: (v?.claim_flags as string[] | null) ?? [],
        blocked: v?.compliance?.ok === false,
        hasJob: queued.has(i.id as string),
      };
    });
    const plan = sweepPlan(sweepItems, now);

    for (const id of plan.enqueue) {
      const item = sweepItems.find((s) => s.id === id)!;
      await enqueuePublish(id, item.when, caller.actor);
    }
    if (plan.nudge.length || plan.missed.length) {
      const deskId = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
      const text = [
        `<b>Batch check</b> · week of ${monday}`,
        ...plan.nudge.map((n) => `${n.n}. ${n.why}`),
        ...(plan.missed.length ? [`Slot already passed: ${plan.missed.join(", ")}`] : []),
        ...(plan.enqueue.length ? [`Queued ${plan.enqueue.length} approved post(s) that had no job.`] : []),
      ].join("\n");
      await sendMessage(deskId, text, { parse_mode: "HTML" });
    }
    await logAction({ actor: caller.actor, action: "content.batch_sweep", payload: { monday, enqueued: plan.enqueue.length, nudged: plan.nudge.length, missed: plan.missed.length } });
    return remember(idem, 200, { ok: true, monday, ...plan });
  }

  // POST /content/annual-offer { sku? } — an annual-plan offer drafted from the products table (Phase 7).
  // Without a sku it only lists what could be offered. The numbers are the table's, worked out, never typed;
  // a price is a claim, so the draft waits for Jack's approval like every offer.
  if (tail[0] === "annual-offer") {
    requireRole(caller.role, "content.draft");
    const { data: rows } = await admin().from("products").select("sku, name, billing, price_usd, term_months, active");
    const offers = annualOffers((rows ?? []) as ProductRow[]);
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    if (!sku) return json({ ok: true, offers });
    const offer = offers.find((o) => o.monthlySku === sku || o.annualSku === sku);
    if (!offer) throw notFound("annual offer for that sku");
    const day = new Date().toISOString().slice(0, 10);
    const idem = { scope: "content.annual-offer", key: `${offer.annualSku}:${day}`, requestHash: "-" };
    const hit = await replay(idem);
    if (hit) return hit;
    const draft = await createDraft({
      post_type: "offer", lang: "en", fields: { offer_text: offerText(offer) },
      allowed_numbers: [offer.monthly, offer.annual, offer.twelveMonths, offer.saves, offer.savesPct],
      title: `Annual plan: ${offer.name}`, source: { via: "annual_offer", sku: offer.annualSku }, actor: caller.actor,
    });
    const desk = await pushToDesk(draft, { heading: "Annual-plan offer", actor: caller.actor });
    return remember(idem, 201, { ok: true, content_id: draft.content_id, desk, needed: draft.needed });
  }

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

  // POST /content/fanout-drain — cron works the fan-out retry queue (Wave 4
  // item 4): one claimed job per call, backoff between tries, Desk alert on
  // the last failure. pgmq would be the nicer queue; the CI Postgres has no
  // pgmq extension, so retries ride the jobs table with the same semantics.
  if (method === "POST" && tail.length === 1 && tail[0] === "fanout-drain") {
    requireRole(caller.role, "content.fanout_drain");
    const db = admin();
    await db.from("jobs").update({ status: "queued", claimed_by: null, claimed_at: null })
      .eq("kind", "fanout_platform").eq("status", "claimed")
      .lt("claimed_at", new Date(Date.now() - 30 * 60_000).toISOString());
    // A backlog at or past the threshold means failures outpace the one-per-
    // call drain: page the Desk once (deskAlert dedupes inside its cooldown).
    const { count: backlog } = await db.from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("kind", "fanout_platform").eq("status", "queued");
    if (isStuckQueue(backlog ?? 0)) {
      await deskAlert({
        db,
        key: "fanout-stuck",
        kind: "fanout_backlog",
        severity: "high",
        message: `\u26A0\uFE0F ${backlog} fan-out retr${backlog === 1 ? "y is" : "ies are"} waiting: failures outpace the retry drain. Check the failed platforms.`,
      });
    }
    const { data: due } = await db.from("jobs")
      .select("id, payload, attempts, max_attempts")
      .eq("kind", "fanout_platform").eq("status", "queued")
      .lte("run_at", new Date().toISOString())
      .order("run_at", { ascending: true }).limit(1).maybeSingle();
    if (!due) return json({ ok: true, drained: 0 });
    const { data: claimed } = await db.from("jobs")
      .update({
        status: "claimed", claimed_by: "fanout-drain", claimed_at: new Date().toISOString(),
        attempts: (due.attempts as number) + 1,
      })
      .eq("id", due.id).eq("status", "queued").select("id").maybeSingle();
    if (!claimed) return json({ ok: true, drained: 0 });
    const p = ((due.payload ?? {}) as Record<string, unknown>);
    const attempts = (due.attempts as number) + 1;
    const max = Number(due.max_attempts ?? 3);
    const parent = String(p.parent ?? "");
    const platform = String(p.platform ?? "");
    try {
      const res = await fanOut(parent, {
        platforms: [platform],
        assetId: typeof p.asset_id === "string" ? p.asset_id : null,
        actor: "cron",
        enqueueRetry: false, // this IS the retry: no loops
      });
      // fanOut records a platform failure as a row: surface it so the
      // attempts, backoff and last-failure alert below actually run.
      const failure = fanoutFailure(res);
      if (failure) throw new Error(failure);
      await db.from("jobs").update({ status: "done" }).eq("id", due.id);
      await logAction({ actor: caller.actor, action: "content.fanout_retry_done", target: parent, payload: { platform } });
      return json({ ok: true, drained: 1 });
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      if (attempts >= max) {
        await db.from("jobs").update({ status: "failed" }).eq("id", due.id);
        await deskAlert({
          db,
          key: `fanout:${parent.slice(0, 8)}:${platform}`,
          kind: "fanout_failed",
          severity: "high",
          message: `\u26A0\uFE0F Fan-out to ${platform} failed ${attempts} times for #${parent.slice(0, 8)}: ${reason}. Retry it by hand from the dashboard.`,
        });
      } else {
        await db.from("jobs").update({
          status: "queued", claimed_by: null, claimed_at: null,
          run_at: new Date(Date.now() + 5 * 60_000 * attempts).toISOString(),
        }).eq("id", due.id);
      }
      await logAction({ actor: caller.actor, action: "content.fanout_retry_failed", target: parent, payload: { platform, attempts, reason } });
      return json({ ok: true, drained: 1, failed: attempts >= max });
    }
  }

  // POST /content/{id}/request-approval | /content/{id}/schedule
  if (tail.length === 2) {
    const id = tail[0];
    const item = await loadContent(id);

    if (tail[1] === "fanout") {
      requireRole(caller.role, "content.draft");
      const platforms = Array.isArray(body.platforms) ? (body.platforms as unknown[]).map(String) : undefined;
      const assetId = typeof body.asset_id === "string" && body.asset_id ? body.asset_id : null;
      const idem = { scope: "content.fanout", key: `${id}:${[...(platforms ?? [])].sort().join(",")}:${assetId ?? ""}`, requestHash: "-" };
      const hit = await replay(idem);
      if (hit) return hit;
      const results = await fanOut(id, { platforms, assetId, actor: caller.actor });
      if (results.length) {
        const deskId = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
        await sendMessage(deskId, fanoutSummary(id.slice(0, 8), results), { parse_mode: "HTML", disable_web_page_preview: true });
      }
      await logAction({ actor: caller.actor, action: "content.fanout", target: id, payload: { platforms: results.map((r) => r.platform) } });
      return remember(idem, 201, {
        ok: true, master: id,
        results: results.map((r) => ({
          platform: r.platform, content_id: r.content_id, kit: r.kit, compliance_ok: r.complianceOk,
          findings: r.findings, retry_queued: r.retryQueued ?? false,
        })),
      });
    }

    if (tail[1] === "request-approval") {
      requireRole(caller.role, "content.request_approval");
      if (item.status !== "draft" && item.status !== "pending_approval") {
        throw bad(`cannot request approval from status ${item.status}`);
      }
      const { data: v } = await admin()
        .from("content_variants").select("id, body, compliance, needed_fields").eq("content_id", id)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
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
      // Calendar scheduler (Wave 4 item 2): an optional first comment, posted
      // as a reply under the channel message after a delay (default 30 min).
      const firstComment = optString(body, "first_comment", 1000);
      const delayRaw = body.first_comment_delay_min;
      const delayMin = delayRaw === undefined ? 30 : Number(delayRaw);
      if (!Number.isInteger(delayMin) || delayMin < 1 || delayMin > 1440) {
        throw bad("first_comment_delay_min must be 1..1440");
      }
      // Claim posts (price/result/offer/signal/map) may only be scheduled by Jack,
      // and only after approval. Everything else: approved → schedule by abdul/cron.
      // ANY variant carrying claims makes this a claim post — an unpicked AI
      // angle must not downgrade the gate to the abdul-allowed verb.
      const { data: variantRows } = await admin()
        .from("content_variants").select("claim_flags, compliance").eq("content_id", id);
      const hasClaim = (variantRows ?? []).some((r) => Array.isArray(r.claim_flags) && r.claim_flags.length > 0);
      const blockedVariant = (variantRows ?? []).find((r) => r.compliance && r.compliance.ok === false);
      requireRole(caller.role, hasClaim ? "content.schedule_claim" : "content.schedule");
      if (item.status !== "approved") throw bad(`only approved items can be scheduled (status ${item.status})`);
      if (blockedVariant?.compliance && blockedVariant.compliance.ok === false) throw bad("compliance findings block scheduling");
      // Saved only after every gate. Comment text never passes Jack's approval
      // tap, so only a caller who may schedule claim posts (Jack) may set it;
      // publish still runs checkComment on it before it goes out.
      if (firstComment !== undefined) requireRole(caller.role, "content.schedule_claim");
      if (firstComment !== undefined || delayRaw !== undefined) {
        await admin().from("content_items").update({
          ...(firstComment !== undefined ? { first_comment: firstComment } : {}),
          first_comment_delay_min: delayMin,
        }).eq("id", id);
      }
      const idem = await idemFrom(req, body, `content.schedule:${id}`);
      const hit = await replay(idem);
      if (hit) return hit;
      // A naive run_at is wall-clock in the channel timezone (ABDUL's "07:50"
      // means Kuala Lumpur), not the server's UTC.
      const tz = (await setting(SETTING_KEYS.timezone)) ?? "Asia/Kuala_Lumpur";
      const instant = runAtToInstant(run_at, tz);
      if (!instant) throw bad("run_at must be an ISO timestamp");
      const jobs = await enqueuePublish(id, instant, caller.actor);
      return remember(idem, 200, { ok: true, content_id: id, jobs, run_at: instant });
    }
  }

  await logAction({ actor: caller.actor, action: "content.bad_route", payload: { tail } });
  throw notFound("route");
});

interface DraftMedia { kind: "photo" | "video"; url?: string; asset_id?: string; file_id?: string }
