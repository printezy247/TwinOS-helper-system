/**
 * Instagram, Facebook Reels and Threads publishing through Meta's Graph APIs
 * (plan §6, §9.F). Pure over an injected `fetch`, so every call sequence is
 * tested against a stand-in and nothing here touches the network in CI.
 *
 * Limits Meta documents for API publishing, per account per 24 h: Instagram
 * 100, Facebook Reels 30, Threads 250. publish/index.ts counts the finished
 * jobs and holds a job back when the cap is reached.
 *
 * Credentials are function secrets, never table rows (docs/SETUP.md 3.1):
 *   TWINOS_META_IG_USER_ID  TWINOS_META_IG_TOKEN
 *   TWINOS_META_PAGE_ID     TWINOS_META_PAGE_TOKEN
 *   TWINOS_THREADS_USER_ID  TWINOS_THREADS_TOKEN
 * and, so `health` can warn before a 60-day token lapses, the expiry dates:
 *   TWINOS_META_IG_EXPIRES  TWINOS_META_PAGE_EXPIRES  TWINOS_THREADS_EXPIRES   (YYYY-MM-DD)
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";

export const DAILY_CAPS = { instagram: 100, facebook: 30, threads: 250 } as const;
export type MetaPlatform = keyof typeof DAILY_CAPS;

export interface MetaCreds { id: string; token: string }
export interface MetaConfig { instagram: MetaCreds | null; facebook: MetaCreds | null; threads: MetaCreds | null }
export interface Waiting { sleep?: (ms: number) => Promise<void>; maxPolls?: number; intervalMs?: number }

export class MetaError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null, readonly subcode: number | null) {
    super(message);
    this.name = "MetaError";
  }
}

const THROTTLED_CODES = new Set([1, 2, 4, 17, 32, 613]);
const AUTH_CODES = new Set([10, 102, 190]);

/** Rate limits and server trouble are worth another try; a bad token or bad input is not. */
export function classifyMeta(e: MetaError): { kind: "throttled" | "permanent"; reason: string } {
  if (e.status === 429 || e.status >= 500 || (e.code !== null && THROTTLED_CODES.has(e.code))) {
    return { kind: "throttled", reason: e.message };
  }
  if (e.code !== null && AUTH_CODES.has(e.code)) return { kind: "permanent", reason: `auth: ${e.message}` };
  return { kind: "permanent", reason: e.message };
}

export function metaConfigFromEnv(get: (key: string) => string | undefined): MetaConfig {
  const pair = (id: string, token: string): MetaCreds | null => {
    const i = get(id);
    const t = get(token);
    return i && t ? { id: i, token: t } : null;
  };
  return {
    instagram: pair("TWINOS_META_IG_USER_ID", "TWINOS_META_IG_TOKEN"),
    facebook: pair("TWINOS_META_PAGE_ID", "TWINOS_META_PAGE_TOKEN"),
    threads: pair("TWINOS_THREADS_USER_ID", "TWINOS_THREADS_TOKEN"),
  };
}

export interface TokenWarning { source: string; days_left: number; severity: "high" | "medium"; message: string }

/** Tokens that lapse within 7 days (or already have). `expires` maps a source to YYYY-MM-DD. */
export function tokenWarnings(expires: Record<string, string | undefined>, now: Date = new Date()): TokenWarning[] {
  const out: TokenWarning[] = [];
  for (const [source, raw] of Object.entries(expires)) {
    const at = raw ? Date.parse(raw) : NaN;
    if (Number.isNaN(at)) continue;
    const days = Math.ceil((at - now.getTime()) / 86_400_000);
    if (days > 7) continue;
    out.push({
      source, days_left: days, severity: days <= 0 ? "high" : "medium",
      message: days <= 0 ? `${source} token has expired` : `${source} token expires in ${days} day(s)`,
    });
  }
  return out;
}

async function call(f: typeof fetch, method: "GET" | "POST", url: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const init: RequestInit = { method };
  if (method === "POST") {
    init.body = new URLSearchParams(params).toString();
    init.headers = { "content-type": "application/x-www-form-urlencoded", ...headers };
  } else if (Object.keys(headers).length) {
    init.headers = headers;
  }
  const target = method === "GET" && Object.keys(params).length ? `${url}?${new URLSearchParams(params)}` : url;
  const res = await f(target, init);
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  const err = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  if (!res.ok || err) {
    throw new MetaError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code ?? null, err?.error_subcode ?? null);
  }
  return json;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll a media container until Meta says it is ready. ERROR is final; running out of polls is retryable. */
async function waitFinished(f: typeof fetch, base: string, container: string, field: string, token: string, w: Waiting) {
  const sleep = w.sleep ?? realSleep;
  const max = w.maxPolls ?? 30;
  for (let i = 0; i < max; i += 1) {
    const r = await call(f, "GET", `${base}/${container}`, { fields: field, access_token: token });
    const state = String(r[field] ?? "");
    if (state === "FINISHED") return;
    if (state === "ERROR" || state === "EXPIRED") throw new Error(`permanent: Meta could not process the media (${state})`);
    await sleep(w.intervalMs ?? 5000);
  }
  throw new Error("Meta is still processing the media; will retry");
}

export async function publishInstagram(
  c: MetaCreds, p: { caption: string; videoUrl?: string; imageUrl?: string }, f: typeof fetch = fetch, w: Waiting = {},
): Promise<{ id: string }> {
  if (!p.videoUrl && !p.imageUrl) throw new Error("permanent: instagram needs a photo or a video");
  const params: Record<string, string> = { caption: p.caption, access_token: c.token };
  if (p.videoUrl) { params.media_type = "REELS"; params.video_url = p.videoUrl; } else params.image_url = p.imageUrl!;
  const made = await call(f, "POST", `${GRAPH}/${c.id}/media`, params);
  const container = String(made.id);
  if (p.videoUrl) await waitFinished(f, GRAPH, container, "status_code", c.token, w);
  const done = await call(f, "POST", `${GRAPH}/${c.id}/media_publish`, { creation_id: container, access_token: c.token });
  return { id: String(done.id) };
}

export async function publishThreads(
  c: MetaCreds, p: { text: string; videoUrl?: string; imageUrl?: string }, f: typeof fetch = fetch, w: Waiting = {},
): Promise<{ id: string }> {
  if (p.text.length > 500) throw new Error("permanent: threads posts are 500 characters at most");
  const params: Record<string, string> = { text: p.text, access_token: c.token, media_type: "TEXT" };
  if (p.videoUrl) { params.media_type = "VIDEO"; params.video_url = p.videoUrl; }
  else if (p.imageUrl) { params.media_type = "IMAGE"; params.image_url = p.imageUrl; }
  const made = await call(f, "POST", `${THREADS}/${c.id}/threads`, params);
  const container = String(made.id);
  if (p.videoUrl) await waitFinished(f, THREADS, container, "status", c.token, w);
  const done = await call(f, "POST", `${THREADS}/${c.id}/threads_publish`, { creation_id: container, access_token: c.token });
  return { id: String(done.id) };
}

/** Facebook Page Reel: start, hand Meta the video URL, finish with the description. */
export async function publishFacebookReel(
  c: MetaCreds, p: { description: string; videoUrl: string }, f: typeof fetch = fetch,
): Promise<{ id: string }> {
  const start = await call(f, "POST", `${GRAPH}/${c.id}/video_reels`, { upload_phase: "start", access_token: c.token });
  const videoId = String(start.video_id);
  await call(f, "POST", String(start.upload_url), {}, { Authorization: `OAuth ${c.token}`, file_url: p.videoUrl });
  await call(f, "POST", `${GRAPH}/${c.id}/video_reels`, {
    upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: p.description, access_token: c.token,
  });
  return { id: videoId };
}
