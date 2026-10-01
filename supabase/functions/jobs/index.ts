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
 * scorecard_image.
 */
import { serve, json, readJson, routeOf, reqString, bad, notFound, optString } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { idemFrom, replay, remember } from "_shared/idempotency.ts";
import { admin } from "_shared/supabase.ts";
import { logAction } from "_shared/log.ts";

export const JOB_KINDS = [
  "drop_folder_watch", "telechurn_import", "backup", "clip", "research_batch",
  "rewrite", "result_reply", "scorecard_image", "thumbnail",
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
      // Requeue stale claims first.
      await db.from("jobs").update({ status: "queued", claimed_by: null, claimed_at: null })
        .eq("status", "claimed").lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString());
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
      await db.from("jobs").update({
        status: final, result, last_error: error, done_at: ok ? new Date().toISOString() : null,
        run_at: final === "queued" ? new Date(Date.now() + 5 * 60_000 * job.attempts).toISOString() : undefined,
      }).eq("id", job_id);
      if (final === "failed") {
        await db.from("alerts").insert({ kind: "job_failed", severity: "medium", message: `${job.kind} job failed: ${error ?? "no detail"}`, payload: { job_id } });
      }
      // A rewrite that came back re-enters the Desk flow through the content function (next tick).
      if (ok && job.kind === "rewrite" && typeof result.body === "string") {
        const p = job.payload as Record<string, unknown>;
        await db.from("content_variants").update({ body: result.body, needed_fields: [] }).eq("id", String(p.variant_id));
        await db.from("content_items").update({ status: "draft", desk_state: "rewritten" }).eq("id", String(p.content_id));
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
      // TODO(phase3): fan-out → caption variants per platform + publish kits.
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
