import { assertEquals } from "std/assert/mod.ts";
import { apiKeyFrom, bearer, miniAppSession } from "./auth.ts";
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
