/**
 * jobs — the PC worker's only door (plan §7: "asks the backend for jobs and
 * posts results back"; never a port on the PC).
 *
 *   POST /jobs/claim        { kinds: [...], worker: "jack-pc", max?: 1 }   → { job | null }
 *   POST /jobs/result       { job_id, ok, result?, error? }               → { ok }
 *   POST /jobs/enqueue      { kind, payload, run_at?, priority? }          (jack, abdul, cron)
 *   POST /jobs/upload-url   { filename, content_type, bytes }  → signed upload URL (assets bucket)
 *   POST /jobs/asset        { path, kind, bytes, sha256, meta? }   → assets row  (= POST /assets/ingest)
 *   POST /jobs/telechurn    { week_start, rows: [{link_name, joins, leaves, retained}] } (= /imports/telechurn)
 *   GET  /jobs              → queue counts per kind/status
 *
 * Claiming is an atomic UPDATE … WHERE status='queued'; a claimed job that
 * reports nothing for 30 min is requeued by the next claim call. Kinds the
 * Phase 1 worker understands: drop_folder_watch, telechurn_import, backup,
 * clip, research_batch, rewrite, result_reply (handled by cron, not the PC),
 * scorecard_image, llm_variants (local model only, off by default).
 */
import { serve, json, readJson, routeOf, reqString, bad, notFound, conflict, optString } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin, requireSetting, SETTING_KEYS } from "_shared/supabase.ts";
import { aiNumberGuard, check as complianceCheck, withRewriteGuard } from "_shared/compliance.ts";
import { logAction } from "_shared/log.ts";
import { nextHook } from "_shared/hooks.ts";
import * as tg from "_shared/tg.ts";

export const JOB_KINDS = [
  "drop_folder_watch", "telechurn_import", "backup", "clip", "research_batch",
  "rewrite", "result_reply", "scorecard_image", "thumbnail", "llm_variants", "clip_candidates", "fanout_platform",
] as const;
const ASSETS_BUCKET = "assets";
const STALE_CLAIM_MIN = 30;
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "jobs");
  const db = admin();

  if (method === "GET") {
    requireRole(caller.role, "reports.read");
    const { data } = await db.from("jobs").select("kind, status").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
    const counts: Record<string, Record<string, number>> = {};
    for (const r of data ?? []) {
      counts[r.kind] ??= {}; counts[r.kind][r.status] = (counts[r.kind][r.status] ?? 0) + 1;
    }
    return json({ counts });
  }
  if (method !== "POST") throw bad("method not allowed");
  const body = await readJson(req, true);

  switch (tail[0]) {
    case "claim": {
      requireRole(caller.role, "jobs.claim");
      const worker = reqString(body, "worker", { max: 64 });
      const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is string => typeof k === "string") : [...JOB_KINDS];
      // Stale claims: a job that keeps crashing the worker fails at the cap
      // instead of being reclaimed every 30 minutes forever; the rest requeue.
      const staleBefore = new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString();
      await db.from("jobs").update({ status: "failed", claimed_by: null, claimed_at: null })
        .eq("status", "claimed").lt("claimed_at", staleBefore).gte("attempts", MAX_ATTEMPTS);
      await db.from("jobs").update({ status: "queued", claimed_by: null, claimed_at: null })
        .eq("status", "claimed").lt("claimed_at", staleBefore);
      const { data: due } = await db.from("jobs").select("id, kind, payload, attempts, priority")
        .eq("status", "queued").in("kind", kinds).lte("run_at", new Date().toISOString())
        .order("priority", { ascending: false }).order("run_at", { ascending: true }).limit(1).maybeSingle();
      if (!due) {
        await db.from("health_checks").insert({ source: "pc_worker", status: "ok", detail: { worker, idle: true } });
        return json({ job: null });
      }
      const { data: claimed } = await db.from("jobs")
        .update({ status: "claimed", claimed_by: worker, claimed_at: new Date().toISOString(), attempts: due.attempts + 1 })
        .eq("id", due.id).eq("status", "queued").select("id, kind, payload, attempts").maybeSingle();
      await db.from("health_checks").insert({ source: "pc_worker", status: "ok", detail: { worker, claimed: claimed?.id ?? null } });
      return json({ job: claimed ?? null });
    }

    case "result": {
      requireRole(caller.role, "jobs.result");
      const job_id = reqString(body, "job_id", { max: 64 });
      const ok = body.ok === true;
      const result = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
      const error = optString(body, "error", 1000);
      const { data: job } = await db.from("jobs").select("id, kind, attempts, status, payload").eq("id", job_id).maybeSingle();
      if (!job) throw notFound("job");
      if (job.status !== "claimed") throw bad(`job is ${job.status}, not claimed`);
      const final = ok ? "done" : job.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
      // The guard on the UPDATE (not just the read above) is what makes this
      // atomic: a retry that races the first result call cannot apply twice or
      // flip a finished job back.
      const { data: finalized } = await db.from("jobs").update({
        status: final, result, last_error: error, done_at: ok ? new Date().toISOString() : null,
        run_at: final === "queued" ? new Date(Date.now() + 5 * 60_000 * job.attempts).toISOString() : undefined,
      }).eq("id", job_id).eq("status", "claimed").select("id").maybeSingle();
      if (!finalized) throw conflict("job was already finalized by another caller");
      if (final === "failed") {
        await db.from("alerts").insert({ kind: "job_failed", severity: "medium", message: `${job.kind} job failed: ${error ?? "no detail"}`, payload: { job_id } });
      }
      // A rewrite that came back re-enters the Desk flow through the content function (next tick).
      if (ok && job.kind === "rewrite" && typeof result.body === "string") {
        const p = job.payload as Record<string, unknown>;
        const variantId = String(p.variant_id);
        const contentId = String(p.content_id);
        const { data: v } = await db.from("content_variants").select("platform, body").eq("id", variantId).maybeSingle();
        const { data: it } = await db.from("content_items").select("post_type, lang").eq("id", contentId).maybeSingle();
        const lang = (typeof p.lang === "string" ? p.lang : it?.lang) === "ms" ? "ms" : "en";
        // A rewritten body is a new body: run the checklist again and keep the
        // evidence, exactly like createDraft and the Desk edit path do. Without
        // this the variant kept the old compliance/claim_flags and no row was
        // written to compliance_checks.
        const checked = withRewriteGuard(complianceCheck({
          post_type: (it?.post_type ?? "gold_map") as never,
          platform: (v?.platform ?? "telegram") as never,
          lang,
          body: result.body,
          long_form: ["lesson", "start_here", "channel_audit"].includes(String(it?.post_type)),
        }), String(v?.body ?? ""), result.body);
        await db.from("content_variants").update({
          body: result.body,
          compliance: checked,
          claim_flags: checked.claim_flags,
          needed_fields: [],
        }).eq("id", variantId);
        await db.from("compliance_checks").insert({
          variant_id: variantId, ok: checked.ok, needs_approval: checked.needs_approval, findings: checked.findings,
        });
        await db.from("content_items").update({ status: "draft", desk_state: "rewritten" }).eq("id", contentId);
      }
      // An llm_variants answer re-enters as candidate angles: every variant
      // runs the checklist plus the blocking AI number guard, and Jack picks
      // one on the Desk. Blocked angles are stored flagged but get no button.
      if (ok && job.kind === "llm_variants" && Array.isArray(result.variants)) {
        const p = job.payload as Record<string, unknown>;
        const contentId = String(p.content_id ?? "");
        const lang = p.lang === "ms" ? "ms" : "en";
        const allowed = Array.isArray(p.allowed_numbers)
          ? (p.allowed_numbers as unknown[]).map(Number).filter((n) => Number.isFinite(n))
          : undefined;
        const { data: it } = await db.from("content_items")
          .select("post_type").eq("id", contentId).maybeSingle();
        const lines: string[] = [];
        const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
        let shown = 0;
        for (const v of (result.variants as Array<Record<string, unknown>>).slice(0, 12)) {
          const platform = String(v.platform ?? "telegram");
          const body = String(v.body ?? "").trim();
          if (!body) continue;
          const angle = Number(v.angle ?? 0) || 0;
          const checked = complianceCheck({
            post_type: ((it?.post_type ?? "gold_map") as never),
            platform: (platform as never),
            lang,
            body,
            long_form: ["lesson", "start_here", "channel_audit"].includes(String(it?.post_type)),
            allowed_numbers: allowed,
          });
          const guard = aiNumberGuard(body, allowed);
          const findings = [...checked.findings, ...guard];
          const pass = checked.ok && guard.length === 0;
          const { data: row } = await db.from("content_variants").insert({
            content_id: contentId, item_id: contentId, platform, lang, body,
            claim_flags: checked.claim_flags, needed_fields: [],
            compliance: { ok: pass, needs_approval: true, findings, claim_flags: checked.claim_flags },
            source: { via: "llm_variants", angle, picked: false, blocked: !pass },
          }).select("id").maybeSingle();
          if (row?.id) {
            await db.from("compliance_checks").insert({
              variant_id: row.id, ok: pass, needs_approval: true, findings,
            });
          }
          shown += 1;
          const label = `angle ${angle || shown} · ${platform}`;
          const preview = body.length > 120 ? body.slice(0, 120) + "…" : body;
          lines.push(`${pass ? "\u2705" : "\uD83D\uDEAB"} ${tg.escapeHtml(label)}: ${tg.escapeHtml(preview)}`);
          if (pass && typeof row?.id === "string") {
            buttons.push([{ text: `Use ${label}`.slice(0, 40), callback_data: tg.shortCallback("pk", row.id) }]);
          }
        }
        if (shown) {
          const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
          await tg.sendMessage(
            desk,
            `<b>${shown} angles</b> from the local model for <code>#${tg.escapeHtml(contentId.slice(0, 8))}</code> (blocked ones kept out):\n${lines.join("\n")}`,
            { parse_mode: "HTML", buttons: buttons.slice(0, 6) },
          );
        }
      }
      // Clip candidates wait for Jack: each moment lands in clip_candidates
      // with a hook line, and the Desk gets Use / Drop buttons per moment.
      if (ok && job.kind === "clip_candidates" && Array.isArray(result.candidates)) {
        const p = job.payload as Record<string, unknown>;
        const lang = p.lang === "ms" ? "ms" : "en";
        const stamp = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
        const lines: string[] = [];
        const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
        for (const c of (result.candidates as Array<Record<string, unknown>>).slice(0, 8)) {
          const start = Number(c.start_s);
          const end = Number(c.end_s);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
          const hook = await nextHook(db, { pillar: null, lang });
          const { data: row } = await db.from("clip_candidates").insert({
            job_id,
            source_path: String(result.source_path ?? p.path ?? ""),
            start_s: start,
            end_s: end,
            score: Number(c.score ?? 0),
            reason: String(c.reason ?? "").slice(0, 300),
            hook_text: hook?.text ?? null,
          }).select("id").maybeSingle();
          if (!row?.id || typeof row.id !== "string") continue;
          const short = row.id.replace(/-/g, "").slice(0, 8);
          lines.push(
            `🎬 <code>${short}</code> ${stamp(start)}\u2013${stamp(end)} (score ${Number(c.score ?? 0)}): ` +
            `${tg.escapeHtml(String(c.reason ?? ""))}` +
            (hook ? `\nopen: ${tg.escapeHtml(hook.text)}` : ""),
          );
          buttons.push([
            { text: `Use ${short}`, callback_data: "clip:" + short + ":use" },
            { text: `Drop ${short}`, callback_data: "clip:" + short + ":drop" },
          ]);
        }
        if (lines.length) {
          const desk = Number(await requireSetting(SETTING_KEYS.deskChatId, "TWINOS_DESK_CHAT_ID"));
          await tg.sendMessage(desk, `<b>Clip candidates</b> (tap Use to cut, Drop to discard):\n${lines.join("\n")}`, {
            parse_mode: "HTML", buttons: buttons.slice(0, 8),
          });
        }
      }
      await logAction({ actor: caller.actor, action: `job.${final}`, target: job_id, payload: { kind: job.kind, error } });
      return json({ ok: true, status: final });
    }

    case "enqueue": {
      requireRole(caller.role, "jobs.enqueue");
      const kind = reqString(body, "kind", { max: 40 });
      if (!JOB_KINDS.includes(kind as typeof JOB_KINDS[number])) throw bad(`kind must be one of ${JOB_KINDS.join(", ")}`);
      const idem = await idemFrom(req, body, `jobs.enqueue:${caller.actor}`);
      const hit = await replay(idem);
      if (hit) return hit;
      const run_at = optString(body, "run_at", 64) ?? new Date().toISOString();
      if (Number.isNaN(Date.parse(run_at))) throw bad("run_at must be an ISO timestamp");
      const { data, error } = await db.from("jobs").insert({
        kind, payload: body.payload ?? {}, status: "queued", priority: Number(body.priority ?? 0),
        run_at: new Date(run_at).toISOString(), created_by: caller.actor,
      }).select("id").single();
      if (error || !data) throw bad(`jobs insert failed: ${error?.message}`);
      return remember(idem, 201, { ok: true, job_id: data.id });
    }

    case "upload-url": {
      requireRole(caller.role, "assets.ingest");
      const filename = reqString(body, "filename", { max: 200 }).replace(/[^a-zA-Z0-9._-]/g, "_");
      const bytes = Number(body.bytes ?? 0);
      if (bytes <= 0 || bytes > 45 * 1024 * 1024) throw bad("bytes must be 1..45MB (plan §7 storage limit)");
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}-${filename}`;
      const { data, error } = await db.storage.from(ASSETS_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw bad(`signed upload failed: ${error?.message}`);
      return json({ path, signed_url: data.signedUrl, token: data.token, bucket: ASSETS_BUCKET });
    }

    case "asset": {
      requireRole(caller.role, "assets.ingest");
      const path = reqString(body, "path", { max: 300 });
      const sha256 = reqString(body, "sha256", { max: 64 });
      const idem = await idemFrom(req, { path, sha256 }, "assets.ingest");
      const hit = await replay(idem);
      if (hit) return hit;
      const row = {
        storage_path: path, bucket: ASSETS_BUCKET, kind: optString(body, "kind", 20) ?? "video",
        bytes: Number(body.bytes ?? 0), sha256, source: "drop_folder", meta: body.meta ?? {},
        created_by: caller.actor,
      };
      // assets.sha256 is unique only where it is not null (a partial index), which
      // ON CONFLICT cannot infer: look the row up, then update or insert.
      const { data: known } = await db.from("assets").select("id").eq("sha256", sha256).maybeSingle();
      const { data, error } = known
        ? await db.from("assets").update(row).eq("id", known.id).select("id").single()
        : await db.from("assets").insert(row).select("id").single();
      if (error || !data) throw bad(`assets ingest failed: ${error?.message}`);
      await logAction({ actor: caller.actor, action: "assets.ingest", target: data.id, payload: { path, bytes: body.bytes } });
      return remember(idem, 201, { ok: true, asset_id: data.id });
    }

    case "telechurn": {
      requireRole(caller.role, "imports.telechurn");
      const week = reqString(body, "week_start", { max: 10 });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw bad("week_start must be YYYY-MM-DD");
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length || rows.length > 500) throw bad("rows: 1..500");
      const clean = rows.map((r: Record<string, unknown>) => ({
        week_start: week, link_name: String(r.link_name ?? "").slice(0, 80),
        joins: Number(r.joins ?? 0), leaves: Number(r.leaves ?? 0), retained: Number(r.retained ?? 0),
        raw: r, imported_by: caller.actor,
      }));
      const { error } = await db.from("telechurn_imports").upsert(clean, { onConflict: "week_start,link_name" });
      if (error) throw bad(`telechurn_imports: ${error.message}`);
      await logAction({ actor: caller.actor, action: "imports.telechurn", target: week, payload: { rows: clean.length } });
      return json({ ok: true, week_start: week, rows: clean.length });
    }
  }
  throw notFound("route");
});
