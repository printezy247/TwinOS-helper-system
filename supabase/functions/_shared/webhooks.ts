/**
 * Webhook registry + delivery queue (UPGRADE-PHASES Phase 7, Decision 6).
 *
 *   WEBHOOK_EVENTS     the four events an endpoint may subscribe to
 *   RETRY_BACKOFF_MS   Decision 6: 3 retries at +1m, +5m, +15m (4 attempts)
 *   matchesEvent       subscription check ("*" subscribes to everything)
 *   signPayload        X-TwinOS-Signature = sha256 hex HMAC of the body
 *   emitWebhook        fan an event out into webhook_deliveries; never throws
 *
 * Emitting is deliberately one insert: the event that fired (a publish that
 * succeeded, an alert that opened) must not wait on, or fail because of, a
 * network call to somebody else's server. The POSTs happen later in
 * webhooks/dispatch, driven by pg_cron every minute.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const WEBHOOK_EVENTS = [
  "post.published",
  "signal.result",
  "alert.fired",
  "friday.done",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Decision 6: three retries after the first attempt — 1m, 5m, 15m. */
export const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const;
/** First attempt + the three retries of Decision 6. */
export const MAX_ATTEMPTS = 1 + RETRY_BACKOFF_MS.length;

/**
 * Delay before the next attempt after `attempt` (1-based) just failed.
 * Only called while attempts < MAX_ATTEMPTS, i.e. attempt 1..3; clamped so a
 * bad caller gets the last delay instead of `undefined` ms.
 */
export function backoffMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1;
  return RETRY_BACKOFF_MS[i];
}

/** A webhook receives an event when it subscribed to it, or to "*". */
export function matchesEvent(events: readonly string[], event: string): boolean {
  return events.includes(event) || events.includes("*");
}

/** X-TwinOS-Signature: hex HMAC-SHA256 of the exact body bytes sent. */
export async function signPayload(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Queue `event` for every active webhook subscribed to it. Never throws: a
 * broken registry must not fail the event that triggered it — a failed emit
 * leaves one action_log row instead.
 */
export async function emitWebhook(
  db: SupabaseClient,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: hooks, error } = await db.from("webhooks").select("id, events").eq("active", true);
    if (error) throw new Error(error.message);
    const targets = (hooks ?? []).filter((h) =>
      matchesEvent(((h.events ?? []) as string[]), event),
    );
    if (!targets.length) return;
    const at = new Date().toISOString();
    const rows = targets.map((h) => ({
      webhook_id: h.id as string,
      event,
      payload: { ...payload, event, at },
    }));
    const { error: ins } = await db.from("webhook_deliveries").insert(rows);
    if (ins) throw new Error(ins.message);
  } catch (err) {
    try {
      await db.from("action_log").insert({
        actor: "cron",
        action: "webhook.emit_failed",
        target_table: "webhook_deliveries",
        target_id: event,
        payload: { error: String(err).slice(0, 300) },
      });
    } catch {
      // Nothing left to do: emitting is best-effort by design.
    }
  }
}
