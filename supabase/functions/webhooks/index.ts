/**
 * webhooks — registry + delivery dispatch (UPGRADE-PHASES Phase 7).
 *
 *   GET    /webhooks              → registered endpoints (secret never re-shown)
 *   POST   /webhooks              { url, events: [...], name? }  → one row;
 *                                   the HMAC secret is returned ONCE, here
 *   DELETE /webhooks/{id}          → remove (its deliveries cascade)
 *   GET    /webhooks/deliveries    → the last 50 queue rows
 *   POST   /webhooks/dispatch      → deliver everything due now (pg_cron, every minute)
 *   POST   /webhooks/ping          → unauthenticated echo for the self-test:
 *                                    returns the signature it received plus
 *                                    sha256 of the body, so the HMAC can be
 *                                    verified offline. It echoes; it emits nothing.
 *
 * Who: the registry is webhooks.manage (jack). Dispatch is webhooks.dispatch
 * (cron, called through twinos_cron_call — or jack by hand). Decision 6:
 * 4 attempts total, retries at +1m, +5m, +15m. A delivery failure never
 * touches the event that produced it (emitting is an insert, queued by
 * emitWebhook) and one hung target never wedges the queue: the claim is an
 * atomic status flip, and a dispatch that dies mid-flight is reclaimed as a
 * failed attempt after 5 minutes.
 */
import { serve, json, readJson, routeOf, bad, notFound, HttpError } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin } from "_shared/supabase.ts";
import { logAction, sanitizeError } from "_shared/log.ts";
import {
  MAX_ATTEMPTS,
  WEBHOOK_EVENTS,
  backoffMs,
  signPayload,
} from "_shared/webhooks.ts";

type Hook = { id: string; url: string; secret: string; active: boolean };
type DueRow = {
  id: number;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  webhooks: Hook[] | Hook | null;
};

async function sha256Hex(raw: string): Promise<string> {
  const mac = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Record one failed attempt: requeue with the Decision-6 delay, or exhaust. */
async function settleFailure(
  db: ReturnType<typeof admin>,
  id: number,
  attempt: number,
  error: string,
): Promise<void> {
  const exhausted = attempt >= MAX_ATTEMPTS;
  const patch: Record<string, unknown> = {
    status: exhausted ? "failed" : "pending",
    attempts: attempt,
    next_attempt_at: exhausted
      ? undefined
      : new Date(Date.now() + backoffMs(attempt)).toISOString(),
    last_error: error,
    claimed_at: null,
  };
  if (exhausted) delete patch.next_attempt_at;
  await db.from("webhook_deliveries").update(patch).eq("id", id);
}

serve(async (req) => {
  const { method, tail } = routeOf(req, "webhooks");

  // The echo runs before auth on purpose: dispatch POSTs to a registered URL
  // carrying no credentials — a receiver identifies us by the signature.
  if (method === "POST" && tail.length === 1 && tail[0] === "ping") {
    const raw = await req.text();
    return json({
      ok: true,
      signature: req.headers.get("x-twinos-signature"),
      body_sha256: await sha256Hex(raw),
      event: req.headers.get("x-twinos-event"),
      attempt: req.headers.get("x-twinos-attempt"),
    });
  }

  const caller = await authenticate(req);
  const db = admin();

  // ---- registry ------------------------------------------------------ (jack)
  if (method === "GET" && tail.length === 0) {
    requireRole(caller.role, "webhooks.manage");
    const { data, error } = await db.from("webhooks")
      .select("id, name, url, events, active, created_by, created_at, last_delivery_at, last_status")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    // `secret` is deliberately absent: it is shown once, at register.
    return json({ webhooks: data ?? [] });
  }

  if (method === "GET" && tail.length === 1 && tail[0] === "deliveries") {
    requireRole(caller.role, "webhooks.manage");
    const { data, error } = await db.from("webhook_deliveries")
      .select(
        "id, webhook_id, event, payload, status, attempts, next_attempt_at, last_error, created_at, delivered_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    return json({ deliveries: data ?? [] });
  }

  if (method === "POST" && tail.length === 0) {
    requireRole(caller.role, "webhooks.manage");
    const body = await readJson(req);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      throw bad("url must be an http(s) URL with no spaces");
    }
    const events = Array.isArray(body.events) ? body.events.map((e: unknown) => String(e)) : [];
    if (!events.length) {
      throw bad(`events must name at least one of: ${WEBHOOK_EVENTS.join(", ")} (or "*")`);
    }
    for (const e of events) {
      if (e !== "*" && !(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
        throw bad(`unknown event: ${e} (known: ${WEBHOOK_EVENTS.join(", ")})`);
      }
    }
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : null;
    const secret = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { data, error } = await db.from("webhooks")
      .insert({ name, url, events, secret, created_by: caller.actor })
      .select("id, name, url, events, active, created_at, secret")
      .single();
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    await logAction({
      actor: caller.actor,
      action: "webhook.register",
      target: data.id as string,
      payload: { url, events },
    });
    // The one and only time the secret leaves the database.
    return json({ webhook: data }, 201);
  }

  if (method === "DELETE" && tail.length === 1 && tail[0] !== "dispatch" && tail[0] !== "deliveries") {
    requireRole(caller.role, "webhooks.manage");
    const { data, error } = await db.from("webhooks").delete().eq("id", tail[0]).select("id");
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    if (!data?.length) throw notFound("webhook");
    await logAction({ actor: caller.actor, action: "webhook.remove", target: tail[0] });
    return json({ ok: true, deleted: tail[0] });
  }

  // ---- dispatch ------------------------------------------------------ (cron)
  if (method === "POST" && tail.length === 1 && tail[0] === "dispatch") {
    requireRole(caller.role, "webhooks.dispatch");
    const summary = { reclaimed: 0, processed: 0, delivered: 0, retried: 0, failed: 0 };

    // A dispatch that died mid-flight leaves rows 'delivering'. After five
    // minutes they count as failed attempts — otherwise one hung target
    // would wedge its row forever.
    const { data: stale } = await db.from("webhook_deliveries")
      .select("id, attempts").eq("status", "delivering")
      .lt("claimed_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .limit(10);
    for (const row of stale ?? []) {
      await settleFailure(db, row.id as number, Number(row.attempts), "dispatch stalled mid-delivery");
      summary.reclaimed += 1;
    }

    // What is due. The guarded UPDATE below (status = 'pending' in its WHERE)
    // is what makes a second cron tick in the same minute harmless.
    const { data: due, error: dueErr } = await db.from("webhook_deliveries")
      .select("id, webhook_id, event, payload, attempts, webhooks(id, url, secret, active)")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .lt("attempts", MAX_ATTEMPTS)
      .order("next_attempt_at", { ascending: true })
      .limit(20);
    if (dueErr) throw new HttpError(503, "upstream_failed", dueErr.message);

    for (const row of (due ?? []) as DueRow[]) {
      const attempt = Number(row.attempts) + 1;
      const claim = await db.from("webhook_deliveries")
        .update({ status: "delivering", claimed_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "pending")
        .select("id");
      if (!claim.data?.length) continue; // another tick already took it
      summary.processed += 1;

      const embedded = Array.isArray(row.webhooks) ? row.webhooks[0] : row.webhooks;
      if (!embedded || !embedded.active) {
        await settleFailure(db, row.id, attempt, "webhook inactive or removed");
        summary.failed += 1;
        continue;
      }

      const bodyStr = JSON.stringify(row.payload);
      const sig = await signPayload(embedded.secret, bodyStr);
      let ok = false;
      let errText = "";
      try {
        const res = await fetch(embedded.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "TwinOS-Webhook/1",
            "x-twinos-event": row.event,
            "x-twinos-delivery": String(row.id),
            "x-twinos-attempt": String(attempt),
            "x-twinos-signature": sig,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(10_000),
        });
        ok = res.ok;
        if (!ok) errText = `HTTP ${res.status}`;
        await res.text().catch(() => ""); // drain so the connection closes
      } catch (err) {
        errText = sanitizeError(err).slice(0, 400);
      }

      const at = new Date().toISOString();
      if (ok) {
        await db.from("webhook_deliveries").update({
          status: "delivered", delivered_at: at, attempts: attempt, last_error: null,
        }).eq("id", row.id);
        await db.from("webhooks").update({
          last_delivery_at: at, last_status: "delivered",
        }).eq("id", row.webhook_id);
        summary.delivered += 1;
      } else {
        await settleFailure(db, row.id, attempt, errText || "delivery failed");
        await db.from("webhooks").update({
          last_delivery_at: at, last_status: attempt >= MAX_ATTEMPTS ? "failed" : "retrying",
        }).eq("id", row.webhook_id);
        if (attempt >= MAX_ATTEMPTS) summary.failed += 1;
        else summary.retried += 1;
      }
    }

    await logAction({ actor: caller.actor, action: "webhook.dispatch", payload: summary });
    return json(summary);
  }

  throw bad("unknown route");
});
