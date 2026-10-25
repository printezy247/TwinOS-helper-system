/**
 * Live provider checks for health/check (plan §17 Wave 3 item 2).
 *
 * Telegram `getMe` and the Meta token debug (`/me` on the token's own
 * graph). A missing token is `needs-credentials`, never a fetch: unconfigured
 * providers stay silent instead of alerting. `fetchFn` is injectable so the
 * tests drive a stub.
 */
export interface ProviderResult {
  provider: string;
  ok: boolean;
  detail: string;
}

type FetchFn = typeof fetch;

async function readBody(res: Response): Promise<{ ok?: boolean; description?: string; error?: { message?: string } }> {
  return (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    error?: { message?: string };
  };
}

/**
 * Network errors quote the request URL, and both provider URLs carry a token
 * (Telegram in the path, Meta as access_token). Strip them before any text is
 * stored, returned, or sent to the Desk.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/bot\d+:[\w-]+/g, "bot<redacted>")
    // Anything shaped like a signed token, whichever gateway echoed it back
    // (Supabase JWTs, OIDC id_tokens, an SDK printing its Authorization value).
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "<redacted-jwt>")
    // The credential half of a query string or header pair: keep the name,
    // drop the value, so the line still says which credential was involved.
    .replace(/([?&](?:token|api_?key|secret|access_token)=)[^&\s"']+/gi, "$1<redacted>");
}

const errText = (err: unknown) => redactSecrets(String(err instanceof Error ? err.message : err)).slice(0, 160);

export async function checkTelegram(token: string | undefined, fetchFn: FetchFn = globalThis.fetch): Promise<ProviderResult> {
  if (!token) return { provider: "telegram", ok: false, detail: "needs-credentials" };
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/getMe`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    const data = await readBody(res);
    return data.ok
      ? { provider: "telegram", ok: true, detail: "getMe ok" }
      : { provider: "telegram", ok: false, detail: data.description ?? `http ${res.status}` };
  } catch (err) {
    return { provider: "telegram", ok: false, detail: errText(err) };
  }
}

export async function checkMetaToken(
  provider: string,
  token: string | undefined,
  fetchFn: FetchFn = globalThis.fetch,
  endpoint = "https://graph.facebook.com/v21.0",
): Promise<ProviderResult> {
  if (!token) return { provider, ok: false, detail: "needs-credentials" };
  try {
    const res = await fetchFn(`${endpoint}/me?access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await readBody(res);
    return res.ok && !data.error
      ? { provider, ok: true, detail: "token ok" }
      : { provider, ok: false, detail: data.error?.message ?? data.description ?? `http ${res.status}` };
  } catch (err) {
    return { provider, ok: false, detail: errText(err) };
  }
}

export async function runProviderChecks(
  env: Record<string, string | undefined>,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ProviderResult[]> {
  return [
    await checkTelegram(env.TWINOS_OPS_BOT_TOKEN, fetchFn),
    await checkMetaToken("instagram", env.TWINOS_META_IG_TOKEN, fetchFn),
    await checkMetaToken("facebook", env.TWINOS_META_PAGE_TOKEN, fetchFn),
    await checkMetaToken("threads", env.TWINOS_THREADS_TOKEN, fetchFn, "https://graph.threads.net/v1.0"),
  ];
}

export interface WebhookInfo {
  url?: string;
  last_error_date?: number; // unix seconds
  last_error_message?: string;
  pending_update_count?: number;
}

export interface WebhookHealth {
  status: "ok" | "degraded" | "down";
  detail: string;
}

const WEBHOOK_PATH = "/functions/v1/tg-webhook";
const WEBHOOK_ERROR_WINDOW_MS = 3600_000;
const WEBHOOK_BACKLOG = 50;

/**
 * Is Telegram able to reach the ops bot's webhook? The ops_bot beat used to be
 * written only when an update arrived, so a quiet day looked like an outage.
 * This reads Telegram's own view instead: registered, pointed here, no recent
 * delivery error, no big backlog. Never throws; `null` info means unreadable.
 */
export function webhookHealth(info: WebhookInfo | null, now = Date.now()): WebhookHealth {
  if (!info) return { status: "down", detail: "telegram webhook info unavailable" };
  if (!info.url) return { status: "down", detail: "no webhook registered with Telegram" };
  if (!info.url.includes(WEBHOOK_PATH)) {
    return { status: "degraded", detail: "webhook points at a different URL" };
  }
  const errAt = info.last_error_date ? info.last_error_date * 1000 : 0;
  if (info.last_error_message && now - errAt < WEBHOOK_ERROR_WINDOW_MS) {
    return { status: "degraded", detail: `delivery error: ${info.last_error_message}`.slice(0, 160) };
  }
  if ((info.pending_update_count ?? 0) > WEBHOOK_BACKLOG) {
    return { status: "degraded", detail: `${info.pending_update_count} updates waiting` };
  }
  return { status: "ok", detail: "webhook registered and healthy" };
}

/** Asks Telegram for the webhook state. `null` when there is no token (nothing to check). */
export async function checkWebhook(
  token: string | undefined,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<WebhookHealth | null> {
  if (!token) return null;
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: WebhookInfo } | null;
    return webhookHealth(body?.ok ? (body.result ?? null) : null);
  } catch {
    // The URL (with the token in it) must never reach a log or a beat.
    return { status: "down", detail: "telegram unreachable" };
  }
}
