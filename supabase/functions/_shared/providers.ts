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

const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 120);

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
