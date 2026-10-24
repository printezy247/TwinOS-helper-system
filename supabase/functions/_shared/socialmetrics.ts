/**
 * Phase 8 metrics pollers: Instagram, Facebook Page and Threads (Meta's
 * Graph APIs) and YouTube (Data API v3) — plan §9.H.67, §9.I.78 and the
 * UPGRADE-PHASES Phase 8 rows ("insights" for IG/FB/Threads, Analytics for
 * YouTube).
 *
 * Credentials in → post_metrics-shaped rows out. No database, no logging, and
 * no secrets in errors: every call goes through an injectable fetch so the
 * tests drive real provider payloads with TEST credentials, and an error is
 * built from the URL's host + path only — tokens and API keys travel in the
 * query string and never echo (even a fetch-level network error is rewritten
 * before it can carry the URL).
 *
 * Honest by construction: a row only ever carries numbers a provider actually
 * reported. A surface whose call fails throws (the route names it); a single
 * bad post inside a working surface becomes a warning and the rest still land.
 * The route joins rows to their variant through content_items.published_ref —
 * publish writes the provider's post id there (`chat:message` for Telegram,
 * the bare external id everywhere else).
 */

export type SocialPlatform = "instagram" | "facebook" | "threads" | "youtube";

/** One post_metrics-shaped row. `account:<id>` rows are the account rollup. */
export interface SocialRow {
  platform: SocialPlatform;
  platform_post_id: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  followers_gained: number | null;
  profile_views: number | null;
  raw: Record<string, unknown>;
}

export interface PollOutcome {
  rows: SocialRow[];
  warnings: string[];
}

type FetchFn = typeof fetch;

const GRAPH = "https://graph.facebook.com/v21.0";
const THREADS = "https://graph.threads.net/v1.0";
const YTAPI = "https://www.googleapis.com/youtube/v3";

const q = (s: unknown): string => encodeURIComponent(String(s));
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One provider JSON call. A provider `error` body becomes an Error carrying
 * its message; everything is prefixed with host + path (never the query —
 * that is where the credentials live), and a transport failure is reduced to
 * host + path + error name so a fetch URL full of tokens cannot escape.
 */
async function getJson(url: string, f: FetchFn): Promise<Record<string, unknown>> {
  let where = "provider";
  try {
    const u = new URL(url);
    where = u.host + u.pathname;
  } catch {
    /* keep the default prefix */
  }
  let res: Response;
  try {
    res = await f(url, {
      headers: { "user-agent": "twinos-metrics/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`${where}: network error (${e instanceof Error ? e.name : "unknown"})`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new Error(`${where}: HTTP ${res.status} with a non-JSON body`);
  const err = body.error;
  if (typeof err === "string") throw new Error(`${where}: ${err}`);
  if (err && typeof err === "object") {
    const m = (err as { message?: string }).message;
    throw new Error(`${where}: ${m ?? "provider error"}`);
  }
  if (!res.ok) throw new Error(`${where}: HTTP ${res.status}`);
  return body;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Graph insights arrive as `[{ name, values: [{ value }] }]` — first value per name. */
export function insightMap(body: Record<string, unknown>): Map<string, number> {
  const out = new Map<string, number>();
  const data = Array.isArray(body.data)
    ? (body.data as Array<{ name?: string; values?: Array<{ value?: unknown }> }>)
    : [];
  for (const m of data) {
    if (!m?.name) continue;
    out.set(m.name, Number(m.values?.[0]?.value ?? 0));
  }
  return out;
}

/** Sum every listed day of one insights entry (account rollups use period=day). */
export function insightSum(body: Record<string, unknown>, name: string): number {
  const data = Array.isArray(body.data)
    ? (body.data as Array<{ name?: string; values?: Array<{ value?: unknown }> }>)
    : [];
  const entry = data.find((m) => m?.name === name);
  if (!entry?.values) return 0;
  return entry.values.reduce((sum, v) => sum + Number(v?.value ?? 0), 0);
}

/** Follow Meta Graph cursor pagination across pages, capped to avoid runaway calls. */
async function paginateGraph(url: string, f: FetchFn, maxPages = 6): Promise<unknown[]> {
  let current = url;
  const all: unknown[] = [];
  for (let i = 0; i < maxPages; i++) {
    const body = await getJson(current, f);
    const data = Array.isArray(body.data) ? (body.data as unknown[]) : [];
    all.push(...data);
    const after = (body.paging as { cursors?: { after?: string } } | undefined)?.cursors?.after;
    if (!after) break;
    current = `${current}${current.includes("?") ? "&" : "?"}after=${q(after)}`;
  }
  return all;
}

/** Follow YouTube nextPageToken pagination for playlistItems, capped to avoid runaway calls. */
async function paginateYouTube(
  url: string,
  f: FetchFn,
  maxPages = 6,
): Promise<unknown[]> {
  let pageToken: string | null = null;
  const all: unknown[] = [];
  for (let i = 0; i < maxPages; i++) {
    const current = pageToken ? `${url}&pageToken=${q(pageToken)}` : url;
    const body = await getJson(current, f);
    const items = Array.isArray(body.items) ? (body.items as unknown[]) : [];
    all.push(...items);
    pageToken = (body.nextPageToken as string | undefined) ?? null;
    if (!pageToken) break;
  }
  return all;
}

/** A token without a stored id: `/me` resolves it (page and user tokens both answer). */
async function meId(
  base: string,
  token: string,
  id: string | null | undefined,
  f: FetchFn,
): Promise<string> {
  if (id) return id;
  const me = await getJson(`${base}/me?fields=id&access_token=${q(token)}`, f);
  const got = me.id;
  if (!got) throw new Error(`${new URL(base).host}: /me returned no id`);
  return String(got);
}

export async function pollInstagram(
  creds: { userId?: string | null; token: string },
  f: FetchFn = fetch,
): Promise<PollOutcome> {
  const userId = await meId(GRAPH, creds.token, creds.userId, f);
  const warnings: string[] = [];
  const rows: SocialRow[] = [];

  const mediaRaw = await paginateGraph(
    `${GRAPH}/${q(userId)}/media?fields=id,timestamp&limit=25&access_token=${q(creds.token)}`,
    f,
  );
  const media = (mediaRaw as Array<{ id?: string; timestamp?: string }>).filter((m) => m?.id);
  for (const m of media) {
    if (!m?.id) continue;
    try {
      const ins = await getJson(
        `${GRAPH}/${
          q(m.id)
        }/insights?metric=impressions,reach,likes,comments,saved,shares&access_token=${
          q(creds.token)
        }`,
        f,
      );
      const v = insightMap(ins);
      rows.push({
        platform: "instagram",
        platform_post_id: m.id,
        views: v.get("impressions") ?? null,
        likes: v.get("likes") ?? null,
        comments: v.get("comments") ?? null,
        shares: v.get("shares") ?? null,
        saves: v.get("saved") ?? null,
        followers_gained: null,
        profile_views: null,
        raw: { insights: Object.fromEntries(v), timestamp: m.timestamp ?? null },
      });
    } catch (e) {
      warnings.push(`${m.id}: ${msg(e)}`); // one refused media must not hide the others
    }
  }

  try {
    const acc = await getJson(
      `${GRAPH}/${
        q(userId)
      }/insights?metric=profile_views,follows&period=day&date_range=last_7d&access_token=${
        q(creds.token)
      }`,
      f,
    );
    rows.push({
      platform: "instagram",
      platform_post_id: `account:${userId}`,
      views: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      followers_gained: insightSum(acc, "follows"),
      profile_views: insightSum(acc, "profile_views"),
      raw: { account_insights: acc },
    });
  } catch (e) {
    warnings.push(`account insights: ${msg(e)}`); // an insights-permission gap still leaves the media rows
  }
  return { rows, warnings };
}

export async function pollFacebook(
  creds: { pageId?: string | null; token: string },
  f: FetchFn = fetch,
): Promise<PollOutcome> {
  const pageId = await meId(GRAPH, creds.token, creds.pageId, f);
  const warnings: string[] = [];
  const rows: SocialRow[] = [];

  const postsRaw = await paginateGraph(
    `${GRAPH}/${q(pageId)}/posts?fields=id,created_time&limit=25&access_token=${q(creds.token)}`,
    f,
  );
  const posts = (postsRaw as Array<{ id?: string; created_time?: string }>).filter((p) => p?.id);
  for (const p of posts) {
    if (!p?.id) continue;
    try {
      const ins = await getJson(
        `${GRAPH}/${
          q(p.id)
        }/insights?metric=post_impressions,post_reactions_by_type_total,post_comments,post_shares&access_token=${
          q(creds.token)
        }`,
        f,
      );
      const v = insightMap(ins);
      rows.push({
        platform: "facebook",
        platform_post_id: p.id,
        views: v.get("post_impressions") ?? null,
        // Reactions are what Facebook reports; they land in `likes` because
        // that is the column every view already charts. raw keeps the name.
        likes: v.get("post_reactions_by_type_total") ?? null,
        comments: v.get("post_comments") ?? null,
        shares: v.get("post_shares") ?? null,
        saves: null,
        followers_gained: null,
        profile_views: null,
        raw: { insights: Object.fromEntries(v), created_time: p.created_time ?? null },
      });
    } catch (e) {
      warnings.push(`${p.id}: ${msg(e)}`);
    }
  }

  try {
    const acc = await getJson(
      `${GRAPH}/${
        q(pageId)
      }/insights?metric=page_impressions,page_engaged_users&period=day&date_range=last_7d&access_token=${
        q(creds.token)
      }`,
      f,
    );
    rows.push({
      platform: "facebook",
      platform_post_id: `account:${pageId}`,
      views: insightSum(acc, "page_impressions"),
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      followers_gained: null,
      profile_views: null,
      raw: { account_insights: acc, page_engaged_users: insightSum(acc, "page_engaged_users") },
    });
  } catch (e) {
    warnings.push(`account insights: ${msg(e)}`);
  }
  return { rows, warnings };
}

export async function pollThreads(
  creds: { userId?: string | null; token: string },
  f: FetchFn = fetch,
): Promise<PollOutcome> {
  const userId = await meId(THREADS, creds.token, creds.userId, f);
  const warnings: string[] = [];
  const rows: SocialRow[] = [];

  const list = await getJson(
    `${THREADS}/${q(userId)}/threads?limit=20&access_token=${q(creds.token)}`,
    f,
  );
  const items = Array.isArray(list.data)
    ? (list.data as Array<{ id?: string; timestamp?: string }>)
    : [];
  for (const t of items) {
    if (!t?.id) continue;
    try {
      const ins = await getJson(
        `${THREADS}/${q(t.id)}/insights?metric=likes,replies,reposts,views&access_token=${
          q(creds.token)
        }`,
        f,
      );
      const v = insightMap(ins);
      rows.push({
        platform: "threads",
        platform_post_id: t.id,
        views: v.get("views") ?? null,
        likes: v.get("likes") ?? null,
        comments: v.get("replies") ?? null, // replies are the comments of Threads
        shares: v.get("reposts") ?? null,
        saves: null,
        followers_gained: null,
        profile_views: null,
        raw: { insights: Object.fromEntries(v), timestamp: t.timestamp ?? null },
      });
    } catch (e) {
      warnings.push(`${t.id}: ${msg(e)}`);
    }
  }
  return { rows, warnings }; // no account rollup in v1: per-post is what the Insights pages read
}

export async function pollYouTube(
  creds: { apiKey: string; channelId: string },
  f: FetchFn = fetch,
): Promise<PollOutcome> {
  const warnings: string[] = [];
  const rows: SocialRow[] = [];

  const ch = await getJson(
    `${YTAPI}/channels?part=statistics,contentDetails&id=${q(creds.channelId)}&key=${
      q(creds.apiKey)
    }`,
    f,
  );
  const item = ((Array.isArray(ch.items) ? ch.items : []) as Array<{
    statistics?: Record<string, unknown>;
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>)[0];
  if (!item) throw new Error("youtube: channel not found (check yt_channel_id)");

  const viewCount = num(item.statistics?.viewCount);
  rows.push({
    platform: "youtube",
    platform_post_id: `account:${creds.channelId}`,
    views: viewCount,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    followers_gained: null, // absolute subscribers go in raw; the route diffs against the previous capture
    profile_views: null,
    raw: { subscriber_count: num(item.statistics?.subscriberCount), view_count: viewCount },
  });

  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    warnings.push("the channel has no uploads playlist");
    return { rows, warnings };
  }
  const ids = (await paginateYouTube(
    `${YTAPI}/playlistItems?part=contentDetails&playlistId=${q(uploads)}&maxResults=25&key=${
      q(creds.apiKey)
    }`,
    f,
  ) as Array<{ contentDetails?: { videoId?: string } }>)
    .map((i) => i?.contentDetails?.videoId)
    .filter((v): v is string => Boolean(v))
    .map(q);
  if (!ids.length) return { rows, warnings };

  const vids = await getJson(
    `${YTAPI}/videos?part=statistics&id=${ids.join(",")}&key=${q(creds.apiKey)}`,
    f,
  );
  for (
    const v of (Array.isArray(vids.items) ? vids.items : []) as Array<{
      id?: string;
      statistics?: Record<string, unknown>;
    }>
  ) {
    if (!v?.id) continue;
    rows.push({
      platform: "youtube",
      platform_post_id: v.id,
      views: num(v.statistics?.viewCount),
      likes: num(v.statistics?.likeCount),
      comments: num(v.statistics?.commentCount),
      shares: null,
      saves: null,
      followers_gained: null,
      profile_views: null,
      raw: { statistics: v.statistics ?? {} },
    });
  }
  return { rows, warnings };
}

/**
 * The variant a provider post id belongs to. Children fan out to one variant
 * per platform, so only the matching platform's variant counts; an unmatched
 * (or account) row stays null rather than borrowing a sibling's variant — a
 * wrong join would show the wrong copy's numbers.
 */
export function pickVariant(
  candidates: Array<{ id: string; platform: string }>,
  platform: SocialPlatform,
): string | null {
  return candidates.find((c) => c.platform === platform)?.id ?? null;
}

/** Followers gained since the previous capture — null on first sight (nothing to diff). */
export function subscriberDelta(
  previous: number | null | undefined,
  next: number | null | undefined,
): number | null {
  if (previous === null || previous === undefined) return null;
  if (next === null || next === undefined) return null;
  return next - previous;
}

/** One surface's outcome — ran-and-succeeded, ran-and-failed, or skipped (no credentials). */
export interface SurfaceResult {
  ok?: boolean;
  skipped?: boolean;
  rows?: number;
  inserted?: number;
  error?: string;
  warnings?: string[];
}

/**
 * Aggregate per-surface results into a single run-level outcome.
 *  - no surfaces → skipped
 *  - all skipped → skipped
 *  - any non-skipped surface failed → degraded
 *  - otherwise → ok (sum inserted).
 */
export function pollOutcome(
  surfaces: Record<string, SurfaceResult>,
): { ok: boolean; status: "ok" | "skipped" | "degraded"; inserted: number } {
  const vals = Object.values(surfaces);
  if (!vals.length) return { ok: false, status: "skipped", inserted: 0 };
  const active = vals.filter((s) => !s.skipped);
  if (!active.length) return { ok: false, status: "skipped", inserted: 0 };
  if (active.some((s) => !s.ok)) return { ok: false, status: "degraded", inserted: 0 };
  return {
    ok: true,
    status: "ok",
    inserted: active.reduce((sum, s) => sum + (s.inserted ?? s.rows ?? 0), 0),
  };
}

/** A partial provider failure must make the shared poller health beat degraded.
 *  Surfaces that were skipped (no credentials) are treated as non-degrading;
 *  only configured-and-failed surfaces flip the beat to degraded. */
export function pollHealthStatus(
  surfaces: Record<string, { ok?: boolean; skipped?: boolean }>,
): "ok" | "degraded" {
  const active = Object.values(surfaces).filter((s) => !s.skipped);
  if (!active.length) return Object.keys(surfaces).length > 0 ? "ok" : "degraded";
  return active.every((s) => s.ok) ? "ok" : "degraded";
}
