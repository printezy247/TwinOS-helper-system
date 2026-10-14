import { assertEquals } from "std/assert/mod.ts";
import { classify } from "./backoff.ts";
import { MetaError } from "./meta.ts";
import { TgError } from "./tg.ts";
import {
  defaultMiddlewares,
  GenericMiddleware,
  MetaErrorMiddleware,
  TgErrorMiddleware,
  TransportMiddleware,
} from "./classifyMiddleware.ts";

/* ------------------------------------------------------------------ */
/* TgErrorMiddleware — claims tg.TgError instances by code            */
/* ------------------------------------------------------------------ */

Deno.test("TgErrorMiddleware: 429 rate limit → throttled", () => {
  const r = new TgErrorMiddleware().classify(new TgError("sendMessage", 429, "Too Many Requests"));
  assertEquals(r?.kind, "throttled");
  assertEquals(r?.reason, "sendMessage: 429 Too Many Requests");
});

Deno.test("TgErrorMiddleware: 500-series → throttled", () => {
  const e500 = new TgError("sendMessage", 500, "Internal Server Error");
  const e503 = new TgError("sendMessage", 503, "Service Unavailable");
  assertEquals(new TgErrorMiddleware().classify(e500)?.kind, "throttled");
  assertEquals(new TgErrorMiddleware().classify(e503)?.kind, "throttled");
});

Deno.test("TgErrorMiddleware: 401/403 auth/blocked → permanent", () => {
  assertEquals(
    new TgErrorMiddleware().classify(new TgError("sendMessage", 401, "Unauthorized"))?.kind,
    "permanent",
  );
  assertEquals(
    new TgErrorMiddleware().classify(new TgError("sendMessage", 403, "bot was blocked"))?.kind,
    "permanent",
  );
});

Deno.test("TgErrorMiddleware: other 4xx (bad payload) → permanent", () => {
  const r = new TgErrorMiddleware().classify(new TgError("sendMessage", 400, "Bad Request: chat not found"));
  assertEquals(r?.kind, "permanent");
  assertEquals(r?.reason, "sendMessage: 400 Bad Request: chat not found");
});

Deno.test("TgErrorMiddleware: non-TgError is passed through (returns null)", () => {
  const other = new Error("something else");
  assertEquals(new TgErrorMiddleware().classify(other), null);
});

/* ------------------------------------------------------------------ */
/* MetaErrorMiddleware — delegates to classifyMeta()                  */
/* ------------------------------------------------------------------ */

Deno.test("MetaErrorMiddleware: rate-limit subcodes → throttled", () => {
  // code 1 is a throttled subcode
  const throttled = new MetaError("slow down", 400, 1, null);
  assertEquals(new MetaErrorMiddleware().classify(throttled)?.kind, "throttled");
});

Deno.test("MetaErrorMiddleware: 5xx status → throttled", () => {
  const r = new MetaErrorMiddleware().classify(new MetaError("server error", 503, null, null));
  assertEquals(r?.kind, "throttled");
});

Deno.test("MetaErrorMiddleware: auth subcodes → permanent with auth: prefix", () => {
  const auth = new MetaErrorMiddleware().classify(
    new MetaError("Invalid OAuth access token.", 400, 190, null),
  );
  assertEquals(auth?.kind, "permanent");
  assertEquals(auth?.reason.startsWith("auth:"), true);
});

Deno.test("MetaErrorMiddleware: bad input → permanent", () => {
  const r = new MetaErrorMiddleware().classify(new MetaError("bad param", 400, 100, null));
  assertEquals(r?.kind, "permanent");
  assertEquals(r?.reason, "bad param");
});

Deno.test("MetaErrorMiddleware: non-MetaError is passed through (returns null)", () => {
  assertEquals(new MetaErrorMiddleware().classify(new Error("not meta")), null);
  assertEquals(new MetaErrorMiddleware().classify(new TgError("x", 429, "rate")), null);
});

/* ------------------------------------------------------------------ */
/* TransportMiddleware — transport-level failures → unknown          */
/* ------------------------------------------------------------------ */

Deno.test("TransportMiddleware: socket hang up / timeout → unknown", () => {
  const err = new Error("socket hang up");
  const r = new TransportMiddleware().classify(err);
  assertEquals(r?.kind, "unknown");
  assertEquals(r?.reason, "socket hang up");
});

Deno.test("TransportMiddleware: fetch/network errors → unknown", () => {
  assertEquals(
    new TransportMiddleware().classify(new Error("fetch failed: network error"))?.kind,
    "unknown",
  );
  assertEquals(
    new TransportMiddleware().classify(new Error("econnreset"))?.kind,
    "unknown",
  );
});

Deno.test("TransportMiddleware: 'permanent:' prefix is NOT claimed (lets GenericMiddleware win)", () => {
  // Caller intent must be preserved: a caller that tags an error 'permanent:'
  // wants it permanent, not treated as an unknown transport hiccup.
  assertEquals(new TransportMiddleware().classify(new Error("permanent: bad token")), null);
});

Deno.test("TransportMiddleware: 'capped:' prefix is NOT claimed (lets GenericMiddleware win)", () => {
  assertEquals(new TransportMiddleware().classify(new Error("capped: daily limit reached")), null);
});

Deno.test("TransportMiddleware: generic message → returns null (deferred to GenericMiddleware)", () => {
  assertEquals(new TransportMiddleware().classify(new Error("some other error")), null);
});

/* ------------------------------------------------------------------ */
/* GenericMiddleware — catch-all: permanent/capped prefixes, else unknown */
/* ------------------------------------------------------------------ */

Deno.test("GenericMiddleware: 'permanent:' prefix → permanent", () => {
  const r = new GenericMiddleware().classify(new Error("permanent: bad token"));
  assertEquals(r?.kind, "permanent");
  assertEquals(r?.reason, "permanent: bad token");
});

Deno.test("GenericMiddleware: 'capped:' prefix → throttled", () => {
  const r = new GenericMiddleware().classify(new Error("capped: instagram hit 100 posts"));
  assertEquals(r?.kind, "throttled");
});

Deno.test("GenericMiddleware: bare string error → unknown", () => {
  const r = new GenericMiddleware().classify("a bare string error");
  assertEquals(r?.kind, "unknown");
  assertEquals(r?.reason, "a bare string error");
});

Deno.test("GenericMiddleware: Error with no special prefix → unknown", () => {
  const r = new GenericMiddleware().classify(new Error("something went wrong"));
  assertEquals(r?.kind, "unknown");
  assertEquals(r?.reason, "something went wrong");
});

Deno.test("GenericMiddleware: always returns a non-null result (never defers)", () => {
  // The fallback catch-all must never return null; otherwise classify() itself
  // has no final answer.
  const r = new GenericMiddleware().classify(new TypeError("weird type error"));
  assertEquals(r !== null, true);
  assertEquals(r?.kind, "unknown");
});

/* ------------------------------------------------------------------ */
/* Pipeline integration: classify() chains all four tiers            */
/* ------------------------------------------------------------------ */

Deno.test("classify() pipeline: TgError → MetaError → Transport → Generic ordering", () => {
  // TgError is claimed by TgErrorMiddleware, never reaches Transport/Generic
  assertEquals(classify(new TgError("sendMessage", 429, "rate")).kind, "throttled");

  // MetaError is claimed by MetaErrorMiddleware, never reaches Transport/Generic
  assertEquals(classify(new MetaError("slow", 400, 4, null)).kind, "throttled");

  // A transport error with no prefix is unknown (caught by TransportMiddleware)
  assertEquals(classify(new Error("socket hang up")).kind, "unknown");

  // A 'permanent:'-tagged error skips TransportMiddleware, lands in Generic
  assertEquals(classify(new Error("permanent: token revoked")).kind, "permanent");

  // A 'capped:'-tagged error skips TransportMiddleware, lands in Generic
  assertEquals(classify(new Error("capped: daily limit")).kind, "throttled");

  // A bare unknown error falls through to GenericMiddleware
  assertEquals(classify(new Error("mysterious failure")).kind, "unknown");
});

Deno.test("defaultMiddlewares has exactly 4 tiers in the right order", () => {
  assertEquals(defaultMiddlewares.length, 4);
  assertEquals(defaultMiddlewares[0] instanceof TgErrorMiddleware, true);
  assertEquals(defaultMiddlewares[1] instanceof MetaErrorMiddleware, true);
  assertEquals(defaultMiddlewares[2] instanceof TransportMiddleware, true);
  assertEquals(defaultMiddlewares[3] instanceof GenericMiddleware, true);
});
