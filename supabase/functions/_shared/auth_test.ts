import { assertEquals } from "std/assert/mod.ts";
import { apiKeyFrom, bearer, isServiceKey, miniAppSession, takeKeyToken } from "./auth.ts";
import { CORS_HEADERS } from "./http.ts";

const KEY = "twk_abdul_" + "0123456789abcdef".repeat(3).slice(0, 40);
const ANON_LIKE = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln";

function req(headers: Record<string, string>): Request {
  return new Request("https://x.invalid/functions/v1/health", { headers });
}

Deno.test("an API key in X-TwinOS-Key is used behind the anon bearer", () => {
  const r = req({ authorization: `Bearer ${ANON_LIKE}`, "x-twinos-key": KEY });
  assertEquals(apiKeyFrom(r), KEY);
  assertEquals(bearer(r), ANON_LIKE);
});

Deno.test("a twk_ bearer still counts as the API key (local runs without the gateway)", () => {
  assertEquals(apiKeyFrom(req({ authorization: `Bearer ${KEY}` })), KEY);
});

Deno.test("a login JWT alone carries no API key", () => {
  assertEquals(apiKeyFrom(req({ authorization: `Bearer ${ANON_LIKE}` })), "");
  assertEquals(apiKeyFrom(req({})), "");
});

Deno.test("the header wins over a twk_ bearer and is trimmed and unquoted", () => {
  const other = KEY.replace("abdul", "ezyai");
  assertEquals(apiKeyFrom(req({ authorization: `Bearer ${other}`, "x-twinos-key": ` "${KEY}" ` })), KEY);
});

// Review 3 Oct: the gateway in front of approve/content only admits JWTs, so a
// `tma.` session on Authorization never reached the function. Like machine
// keys, the Mini App sends the anon JWT on Authorization and its session in
// x-twinos-session (allowed by CORS).
Deno.test("miniAppSession: read from x-twinos-session, or a tma. bearer; never a JWT", () => {
  const h = (headers: Record<string, string>) => new Request("https://x/approve", { headers });
  assertEquals(miniAppSession(h({ authorization: "Bearer eyJ.anon", "x-twinos-session": "tma.1.2.abc" })), "tma.1.2.abc");
  assertEquals(miniAppSession(h({ authorization: "Bearer tma.1.2.abc" })), "tma.1.2.abc");
  assertEquals(miniAppSession(h({ authorization: "Bearer eyJ.anon" })), "");
  assertEquals(miniAppSession(h({ "x-twinos-session": "eyJ.not-a-session" })), "");
  assertEquals(CORS_HEADERS["access-control-allow-headers"].includes("x-twinos-session"), true);
});

// pg_cron holds the legacy service-role JWT; when the key Supabase injects is
// in another format, Supabase Auth's admin API is the judge.
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.${"s".repeat(12)}`;
}

async function withAuthStub<T>(status: number, run: (calls: { n: number }) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const calls = { n: 0 };
  Deno.env.set("SUPABASE_URL", "https://proj.invalid");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_JWT_SECRET");
  globalThis.fetch = (() => {
    calls.n += 1;
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("isServiceKey: a service-role JWT that Supabase Auth accepts is the service key, and the answer is cached", async () => {
  const jwt = fakeJwt({ role: "service_role", ref: "proj", exp: 4_000_000_000 });
  await withAuthStub(200, async (calls) => {
    assertEquals(await isServiceKey(jwt), true);
    assertEquals(await isServiceKey(jwt), true);
    assertEquals(calls.n, 1, "the second call must come from the cache");
  });
});

Deno.test("isServiceKey: a forged service-role payload that Supabase Auth refuses is not the service key", async () => {
  const jwt = fakeJwt({ role: "service_role", ref: "proj", exp: 4_000_000_001 });
  await withAuthStub(401, async () => {
    assertEquals(await isServiceKey(jwt), false);
  });
});

Deno.test("isServiceKey: an anon or expired token never even reaches Supabase Auth", async () => {
  await withAuthStub(200, async (calls) => {
    assertEquals(await isServiceKey(fakeJwt({ role: "anon", exp: 4_000_000_002 })), false);
    assertEquals(await isServiceKey(fakeJwt({ role: "service_role", exp: 1 })), false);
    assertEquals(await isServiceKey("not-a-jwt"), false);
    assertEquals(calls.n, 0);
  });
});

// Phase 7: the per-key token bucket. takeKeyToken is the whole rate limit —
// callerFromKey only wires a bucket to a key whose rate_limit_per_min is set.
Deno.test("takeKeyToken: a fresh bucket allows exactly `limit` requests, then refuses", () => {
  const b = { tokens: 3, at: 1_000, limit: 3 };
  assertEquals(takeKeyToken(b, 1_000), true);
  assertEquals(takeKeyToken(b, 1_000), true);
  assertEquals(takeKeyToken(b, 1_000), true);
  assertEquals(takeKeyToken(b, 1_000), false);
  assertEquals(b.tokens, 0);
});

Deno.test("takeKeyToken: refills by elapsed time, capped at the limit", () => {
  // 60/min = one token per second.
  const b = { tokens: 0, at: 0, limit: 60 };
  assertEquals(takeKeyToken(b, 500), false, "half a second is not a token yet");
  assertEquals(takeKeyToken(b, 1_500), true, "a full second since the last check");
  assertEquals(b.tokens > 0 && b.tokens < 1, true, "0.5 carried over, one consumed");

  const capped = { tokens: 10, at: 0, limit: 60 };
  assertEquals(takeKeyToken(capped, 600_000), true, "ten idle minutes refill everything");
  assertEquals(capped.tokens, 59, "refill caps at the limit, then one is consumed");
});

Deno.test("takeKeyToken: a clock that moves backwards never mints tokens", () => {
  const b = { tokens: 5, at: 10_000, limit: 10 };
  assertEquals(takeKeyToken(b, 0), true, "negative elapsed clamps to 0; only the consume counts");
  assertEquals(b.tokens, 4);
});
