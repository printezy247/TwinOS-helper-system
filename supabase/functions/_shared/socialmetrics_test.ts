/**
 * Phase 8 metrics pollers (UPGRADE-PHASES: "Wire the Meta and YouTube metrics
 * pollers behind test credentials so Phase 8 can be verified").
 *
 * These are the test credentials: real provider payload shapes driven through
 * an injectable fetch, so the whole pipeline — URL shape, insight mapping,
 * account rollups, per-surface failure isolation, secret hygiene — is verified
 * without touching Meta or Google. The pins that matter:
 *
 *   - numbers only ever come from what the provider reported (no fakes);
 *   - one refused post (or a refused account rollup) warns and keeps the rest;
 *   - an error carries the provider's message but never a token or API key —
 *     prefix is host + path only, and a transport failure is rewritten to a
 *     name so a fetch URL full of query credentials cannot escape;
 *   - the pure join/diff helpers behave on their edge cases (first capture,
 *     no matching variant).
 */
import { assertEquals, assertRejects, assertStringIncludes } from "std/assert/mod.ts";
import {
  insightMap,
  insightSum,
  pickVariant,
  pollFacebook,
  pollHealthStatus,
  pollInstagram,
  pollThreads,
  pollYouTube,
  subscriberDelta,
} from "./socialmetrics.ts";

interface Hit {
  /** Substring of the request URL that selects this fixture. */
  on: string;
  body: unknown;
  status?: number;
}

function stub(hits: Hit[]): { f: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = hits.find((h) => url.includes(h.on));
    if (!hit) throw new Error(`test stub: no fixture for ${new URL(url).pathname}`);
    return Promise.resolve(
      new Response(JSON.stringify(hit.body), {
        status: hit.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { f, calls };
}

Deno.test("pollInstagram: media insights and the 7-day account rollup become rows", async () => {
  const { f } = stub([
    {
      on: "/999/media",
      body: {
        data: [{ id: "111", timestamp: "2026-10-20T08:00:00+0000" }, {
          id: "222",
          timestamp: "2026-10-21T09:00:00+0000",
        }],
      },
    },
    {
      on: "/111/insights",
      body: {
        data: [
          { name: "impressions", values: [{ value: 420 }] },
          { name: "likes", values: [{ value: 12 }] },
          { name: "comments", values: [{ value: 3 }] },
          { name: "saved", values: [{ value: 5 }] },
          { name: "shares", values: [{ value: 2 }] },
        ],
      },
    },
    {
      on: "/222/insights",
      status: 400,
      body: { error: { message: "Media ID is not available", type: "OAuthException", code: 100 } },
    },
    {
      on: "/999/insights",
      body: {
        data: [
          { name: "profile_views", values: [{ value: 7 }, { value: 3 }] },
          { name: "follows", values: [{ value: 2 }, { value: 1 }] },
        ],
      },
    },
  ]);
  const out = await pollInstagram({ userId: "999", token: "TEST_TOKEN" }, f);

  const media = out.rows.find((r) => r.platform_post_id === "111");
  if (!media) throw new Error("row 111 missing");
  assertEquals(
    {
      views: media.views,
      likes: media.likes,
      comments: media.comments,
      saves: media.saves,
      shares: media.shares,
    },
    { views: 420, likes: 12, comments: 3, saves: 5, shares: 2 },
  );

  // The refused media is named as a warning; the run still delivers the rest.
  assertEquals(out.rows.length, 2);
  assertEquals(out.warnings.length, 1);
  assertStringIncludes(out.warnings[0], "222");

  const acc = out.rows.find((r) => r.platform_post_id === "account:999");
  if (!acc) throw new Error("account row missing");
  assertEquals(acc.profile_views, 10); // every listed day summed
  assertEquals(acc.followers_gained, 3);
});

Deno.test("pollInstagram: a missing user id is resolved from the token's /me", async () => {
  const { f, calls } = stub([
    { on: "/me?fields=id", body: { id: "999" } },
    { on: "/999/media", body: { data: [] } },
    { on: "/999/insights", body: { data: [] } },
  ]);
  const out = await pollInstagram({ token: "TEST_TOKEN" }, f);
  assertStringIncludes(calls[0], "/me?fields=id");
  assertEquals(out.warnings, []);
  assertEquals(out.rows.length, 1);
  assertEquals(out.rows[0].platform_post_id, "account:999");
});

Deno.test("pollInstagram: a provider error carries its message but never the token", async () => {
  const { f } = stub([
    {
      on: "/999/media",
      status: 401,
      body: {
        error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 },
      },
    },
  ]);
  const err = await assertRejects(
    () => pollInstagram({ userId: "999", token: "SECRET_IG_TOKEN" }, f),
    Error,
  );
  assertStringIncludes(err.message, "Invalid OAuth access token.");
  assertStringIncludes(err.message, "graph.facebook.com/v21.0/999/media"); // host + path is the whole prefix
  assertEquals(err.message.includes("SECRET_IG_TOKEN"), false);
  assertEquals(err.message.includes("access_token="), false);
});

Deno.test("pollInstagram: a transport failure cannot leak the token either", async () => {
  const f = ((input: RequestInfo | URL) =>
    Promise.reject(
      new Error(`error sending request for url (${String(input)})`),
    )) as typeof fetch;
  const err = await assertRejects(
    () => pollInstagram({ userId: "999", token: "SECRET_IG_TOKEN" }, f),
    Error,
  );
  assertStringIncludes(err.message, "network error"); // rewritten: name only, no URL
  assertEquals(err.message.includes("SECRET_IG_TOKEN"), false);
  assertEquals(err.message.includes("graph.facebook.com"), true); // still says where it failed
});

Deno.test("pollFacebook: Page post insights and the 7-day Page rollup become rows", async () => {
  const { f } = stub([
    {
      on: "/123/posts",
      body: { data: [{ id: "123_456", created_time: "2026-10-20T08:00:00+0000" }] },
    },
    {
      on: "/123_456/insights",
      body: {
        data: [
          { name: "post_impressions", values: [{ value: 900 }] },
          { name: "post_reactions_by_type_total", values: [{ value: 25 }] },
          { name: "post_comments", values: [{ value: 4 }] },
          { name: "post_shares", values: [{ value: 6 }] },
        ],
      },
    },
    {
      on: "/123/insights",
      body: {
        data: [
          { name: "page_impressions", values: [{ value: 100 }, { value: 50 }] },
          { name: "page_engaged_users", values: [{ value: 30 }, { value: 12 }] },
        ],
      },
    },
  ]);
  const out = await pollFacebook({ pageId: "123", token: "TEST_PAGE_TOKEN" }, f);
  assertEquals(out.warnings, []);

  const post = out.rows.find((r) => r.platform_post_id === "123_456");
  if (!post) throw new Error("post row missing");
  assertEquals(
    { views: post.views, likes: post.likes, comments: post.comments, shares: post.shares },
    { views: 900, likes: 25, comments: 4, shares: 6 }, // reactions land in likes, raw keeps the name
  );

  const acc = out.rows.find((r) => r.platform_post_id === "account:123");
  if (!acc) throw new Error("account row missing");
  assertEquals(acc.views, 150);
  assertEquals((acc.raw as { page_engaged_users: number }).page_engaged_users, 42);
});

Deno.test("pollFacebook: a missing Page id is resolved from the Page token's /me", async () => {
  const { f, calls } = stub([
    { on: "/me?fields=id", body: { id: "123" } },
    { on: "/123/posts", body: { data: [] } },
    { on: "/123/insights", body: { data: [] } },
  ]);
  const out = await pollFacebook({ token: "TEST_PAGE_TOKEN" }, f);
  assertStringIncludes(calls[0], "/me?fields=id");
  assertEquals(out.rows.length, 1);
  assertEquals(out.rows[0].platform_post_id, "account:123");
});

Deno.test("pollThreads: replies and reposts land as comments and shares", async () => {
  const { f } = stub([
    {
      on: "/777/threads",
      body: { data: [{ id: "12345", timestamp: "2026-10-20T10:00:00+0000" }] },
    },
    {
      on: "/12345/insights",
      body: {
        data: [
          { name: "views", values: [{ value: 500 }] },
          { name: "likes", values: [{ value: 9 }] },
          { name: "replies", values: [{ value: 2 }] },
          { name: "reposts", values: [{ value: 1 }] },
        ],
      },
    },
  ]);
  const out = await pollThreads({ userId: "777", token: "TEST_THREADS_TOKEN" }, f);
  assertEquals(out.warnings, []);
  assertEquals(out.rows.length, 1);
  const row = out.rows[0];
  assertEquals(
    { views: row.views, likes: row.likes, comments: row.comments, shares: row.shares },
    { views: 500, likes: 9, comments: 2, shares: 1 },
  );
});

Deno.test("pollYouTube: channel statistics and the newest videos become rows", async () => {
  const { f } = stub([
    {
      on: "/channels?",
      body: {
        items: [{
          statistics: { subscriberCount: "1030", viewCount: "5000" },
          contentDetails: { relatedPlaylists: { uploads: "UU1" } },
        }],
      },
    },
    {
      on: "/playlistItems?",
      body: {
        items: [{ contentDetails: { videoId: "vid1" } }, { contentDetails: { videoId: "vid2" } }],
      },
    },
    {
      on: "/videos?",
      body: {
        items: [
          { id: "vid1", statistics: { viewCount: "1200", likeCount: "34", commentCount: "5" } },
          { id: "vid2", statistics: { viewCount: "80", likeCount: "2", commentCount: "0" } },
        ],
      },
    },
  ]);
  const out = await pollYouTube({ apiKey: "TEST_YT_KEY", channelId: "UC1" }, f);
  assertEquals(out.warnings, []);
  assertEquals(out.rows.length, 3);

  const acc = out.rows.find((r) => r.platform_post_id === "account:UC1");
  if (!acc) throw new Error("account row missing");
  assertEquals(acc.views, 5000);
  assertEquals((acc.raw as { subscriber_count: number }).subscriber_count, 1030);
  assertEquals(acc.followers_gained, null); // the route diffs it against the previous capture

  const vid1 = out.rows.find((r) => r.platform_post_id === "vid1");
  if (!vid1) throw new Error("vid1 missing");
  assertEquals(
    { views: vid1.views, likes: vid1.likes, comments: vid1.comments },
    { views: 1200, likes: 34, comments: 5 },
  );
});

Deno.test("pollYouTube: a provider error never echoes the API key", async () => {
  const { f } = stub([
    {
      on: "/channels?",
      status: 403,
      body: { error: { message: "The request is missing a valid API key." } },
    },
  ]);
  const err = await assertRejects(
    () => pollYouTube({ apiKey: "SECRET_YT_KEY", channelId: "UC1" }, f),
    Error,
  );
  assertStringIncludes(err.message, "missing a valid API key");
  assertEquals(err.message.includes("SECRET_YT_KEY"), false);
  assertEquals(err.message.includes("key="), false);
  assertStringIncludes(err.message, "www.googleapis.com/youtube/v3/channels");
});

Deno.test("pollYouTube: an unknown channel says so instead of returning nothing", async () => {
  const { f } = stub([{ on: "/channels?", body: { items: [] } }]);
  const err = await assertRejects(
    () => pollYouTube({ apiKey: "K", channelId: "UC404" }, f),
    Error,
  );
  assertStringIncludes(err.message, "channel not found");
});

Deno.test("pickVariant: only the matching platform's variant joins; nothing borrowed", () => {
  const candidates = [{ id: "v-ig", platform: "instagram" }, { id: "v-tt", platform: "tiktok" }];
  assertEquals(pickVariant(candidates, "instagram"), "v-ig");
  assertEquals(pickVariant(candidates, "youtube"), null); // no sibling's numbers under the wrong copy
  assertEquals(pickVariant([], "instagram"), null);
});

Deno.test("subscriberDelta: first sight has nothing to diff against", () => {
  assertEquals(subscriberDelta(1000, 1030), 30);
  assertEquals(subscriberDelta(1030, 1000), -30);
  assertEquals(subscriberDelta(null, 1030), null); // first capture: honest null, not a fake 1030
  assertEquals(subscriberDelta(1000, null), null);
  assertEquals(subscriberDelta(undefined, undefined), null);
});

Deno.test("pollHealthStatus: partial provider failures are degraded", () => {
  assertEquals(pollHealthStatus({ instagram: { ok: true }, facebook: { ok: false } }), "degraded");
  assertEquals(pollHealthStatus({ instagram: { ok: true }, facebook: { ok: true } }), "ok");
  assertEquals(pollHealthStatus({}), "degraded");
});

Deno.test("insightMap and insightSum read the Graph insights shape", () => {
  const body = {
    data: [
      { name: "views", values: [{ value: 3 }, { value: 4 }] },
      { name: "likes", values: [{ value: 9 }] },
      { name: "empty", values: [] },
    ],
  } as unknown as Record<string, unknown>;
  assertEquals(insightMap(body).get("likes"), 9);
  assertEquals(insightMap(body).get("missing"), undefined);
  assertEquals(insightSum(body, "views"), 7);
  assertEquals(insightSum(body, "empty"), 0);
  assertEquals(insightSum(body, "missing"), 0);
});
