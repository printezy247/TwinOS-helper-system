import { assert, assertEquals, assertRejects } from "std/assert/mod.ts";
import {
  classifyMeta, DAILY_CAPS, MetaError, metaConfigFromEnv, publishFacebookReel, publishInstagram, publishThreads,
  tokenWarnings,
} from "./meta.ts";

type Call = { method: string; url: string; body: Record<string, string>; headers: Record<string, string> };

/** A Graph API stand-in: replies come from the script in order, every call is recorded. */
function stub(script: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body: Record<string, string> = {};
    if (init?.body) for (const [k, v] of new URLSearchParams(String(init.body))) body[k] = v;
    calls.push({ method: init?.method ?? "GET", url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = script.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return Promise.resolve(new Response(JSON.stringify(next.json), { status: next.status ?? 200 }));
  };
  return { f: f as typeof fetch, calls };
}
const noSleep = () => Promise.resolve();
const CREDS = { id: "1789", token: "TOKEN" };

Deno.test("instagram reel: container, wait for FINISHED, publish", async () => {
  const s = stub([
    { json: { id: "c1" } },
    { json: { status_code: "IN_PROGRESS" } },
    { json: { status_code: "FINISHED" } },
    { json: { id: "post9" } },
  ]);
  const r = await publishInstagram(CREDS, { caption: "Map only. Not financial advice.", videoUrl: "https://x/v.mp4" }, s.f, { sleep: noSleep });
  assertEquals(r.id, "post9");
  assertEquals(s.calls[0].method, "POST");
  assert(s.calls[0].url.endsWith("/1789/media"));
  assertEquals(s.calls[0].body.media_type, "REELS");
  assertEquals(s.calls[0].body.video_url, "https://x/v.mp4");
  assertEquals(s.calls[0].body.caption, "Map only. Not financial advice.");
  assert(s.calls[3].url.endsWith("/1789/media_publish"));
  assertEquals(s.calls[3].body.creation_id, "c1");
});

Deno.test("instagram: a photo post needs no wait", async () => {
  const s = stub([{ json: { id: "c2" } }, { json: { id: "post10" } }]);
  const r = await publishInstagram(CREDS, { caption: "hi", imageUrl: "https://x/i.jpg" }, s.f, { sleep: noSleep });
  assertEquals(r.id, "post10");
  assertEquals(s.calls[0].body.image_url, "https://x/i.jpg");
  assertEquals(s.calls.length, 2);
});

Deno.test("instagram: text only is refused before any call, as permanent", async () => {
  const s = stub([]);
  const err = await assertRejects(() => publishInstagram(CREDS, { caption: "text only" }, s.f), Error);
  assert(/permanent:/.test((err as Error).message));
  assertEquals(s.calls.length, 0);
});

Deno.test("instagram: a container that ends in ERROR is permanent", async () => {
  const s = stub([{ json: { id: "c3" } }, { json: { status_code: "ERROR" } }]);
  const err = await assertRejects(
    () => publishInstagram(CREDS, { caption: "x", videoUrl: "https://x/v.mp4" }, s.f, { sleep: noSleep }), Error);
  assert(/permanent:/.test((err as Error).message));
});

Deno.test("instagram: gives up waiting after maxPolls and lets the job retry", async () => {
  const s = stub([{ json: { id: "c4" } }, ...Array(3).fill({ json: { status_code: "IN_PROGRESS" } })]);
  const err = await assertRejects(
    () => publishInstagram(CREDS, { caption: "x", videoUrl: "https://x/v.mp4" }, s.f, { sleep: noSleep, maxPolls: 3 }), Error);
  assert(!/permanent:/.test((err as Error).message));
});

Deno.test("threads: text post is create then publish", async () => {
  const s = stub([{ json: { id: "t1" } }, { json: { id: "th9" } }]);
  const r = await publishThreads({ id: "55", token: "T" }, { text: "Map update" }, s.f, { sleep: noSleep });
  assertEquals(r.id, "th9");
  assert(s.calls[0].url.includes("graph.threads.net"));
  assertEquals(s.calls[0].body.media_type, "TEXT");
  assertEquals(s.calls[0].body.text, "Map update");
  assertEquals(s.calls[1].body.creation_id, "t1");
});

Deno.test("threads: more than 500 characters is refused up front", async () => {
  const s = stub([]);
  await assertRejects(() => publishThreads({ id: "55", token: "T" }, { text: "x".repeat(501) }, s.f), Error, "permanent:");
  assertEquals(s.calls.length, 0);
});

Deno.test("facebook reel: start, upload by url, finish with the description", async () => {
  const s = stub([
    { json: { video_id: "v1", upload_url: "https://rupload.facebook.com/video-upload/v1" } },
    { json: { success: true } },
    { json: { success: true } },
  ]);
  const r = await publishFacebookReel({ id: "page1", token: "T" }, { description: "Map", videoUrl: "https://x/v.mp4" }, s.f);
  assertEquals(r.id, "v1");
  assertEquals(s.calls[0].body.upload_phase, "start");
  assertEquals(s.calls[1].url, "https://rupload.facebook.com/video-upload/v1");
  assertEquals(s.calls[1].headers["file_url"], "https://x/v.mp4");
  assertEquals(s.calls[2].body.upload_phase, "finish");
  assertEquals(s.calls[2].body.video_state, "PUBLISHED");
  assertEquals(s.calls[2].body.description, "Map");
});

Deno.test("an API error becomes a MetaError with its code", async () => {
  const s = stub([{ status: 400, json: { error: { message: "Invalid OAuth access token.", code: 190, error_subcode: 463 } } }]);
  const err = await assertRejects(() => publishThreads({ id: "5", token: "T" }, { text: "x" }, s.f), MetaError);
  assertEquals((err as MetaError).code, 190);
  assertEquals((err as MetaError).subcode, 463);
});

Deno.test("classifyMeta: rate limits retry, a bad token and bad input do not", () => {
  const e = (status: number, code: number | null) => new MetaError("m", status, code, null);
  assertEquals(classifyMeta(e(429, null)).kind, "throttled");
  assertEquals(classifyMeta(e(400, 4)).kind, "throttled"); // app rate limit
  assertEquals(classifyMeta(e(400, 17)).kind, "throttled");
  assertEquals(classifyMeta(e(400, 32)).kind, "throttled");
  assertEquals(classifyMeta(e(400, 613)).kind, "throttled");
  assertEquals(classifyMeta(e(500, null)).kind, "throttled");
  assertEquals(classifyMeta(e(400, 2)).kind, "throttled"); // temporary
  const auth = classifyMeta(e(400, 190));
  assertEquals(auth.kind, "permanent");
  assert(auth.reason.startsWith("auth:"));
  assertEquals(classifyMeta(e(400, 100)).kind, "permanent"); // invalid parameter
  assertEquals(classifyMeta(e(400, 368)).kind, "permanent"); // action blocked
});

Deno.test("daily caps are the API limits Meta documents", () => {
  assertEquals(DAILY_CAPS, { instagram: 100, facebook: 30, threads: 250 });
});

Deno.test("metaConfigFromEnv: a provider is configured only when both its id and token are set", () => {
  const cfg = metaConfigFromEnv((k) => ({
    TWINOS_META_IG_USER_ID: "1", TWINOS_META_IG_TOKEN: "a",
    TWINOS_META_PAGE_ID: "2", // token missing
    TWINOS_THREADS_USER_ID: "3", TWINOS_THREADS_TOKEN: "c",
  } as Record<string, string>)[k]);
  assertEquals(cfg.instagram, { id: "1", token: "a" });
  assertEquals(cfg.facebook, null);
  assertEquals(cfg.threads, { id: "3", token: "c" });
});

Deno.test("tokenWarnings: a token inside 7 days warns, an expired one is high, a far one is silent", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const w = tokenWarnings({ instagram: "2026-11-14", threads: "2026-11-09", facebook: "2027-01-01", bad: "not a date" }, now);
  assertEquals(w.find((x) => x.source === "instagram")!.severity, "medium");
  assertEquals(w.find((x) => x.source === "instagram")!.days_left, 4);
  assertEquals(w.find((x) => x.source === "threads")!.severity, "high");
  assertEquals(w.some((x) => x.source === "facebook"), false);
  assertEquals(w.some((x) => x.source === "bad"), false);
});
