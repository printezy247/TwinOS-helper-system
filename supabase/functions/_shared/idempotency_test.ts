/**
 * contentIdem: the asset route's retry must replay, not re-draft.
 *
 * Regression for the 24 Oct acceptance run: with no caller key, idemFrom
 * returned null and a retry of the same file created a second draft tree.
 */
import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { contentIdem, idemFrom } from "./idempotency.ts";

const SHA = "48b1db180e05d5aa02f2b37acdfad19c6bc5a6b4dea49b942278043d9893c2d3";

Deno.test("contentIdem: no caller key falls back to the sha256", () => {
  const ctx = contentIdem("assets.ingest", SHA);
  assertEquals(ctx.scope, "assets.ingest");
  assertEquals(ctx.key, `asset:${SHA}`);
  assertEquals(ctx.requestHash, `sha256:${SHA}`);
});

Deno.test("contentIdem: the same file always maps to the same context (path never enters)", () => {
  // Two retries of one file: different signed upload paths upstream, identical
  // context here — equal key AND equal hash means replay, not a 409.
  const first = contentIdem("assets.ingest", SHA, null);
  const retry = contentIdem("assets.ingest", SHA, null);
  assertEquals(first, retry);
});

Deno.test("contentIdem: an explicit caller key wins over the default", () => {
  const ctx = contentIdem("assets.ingest", SHA, "  worker-key-1  ");
  assertEquals(ctx.key, "worker-key-1");
  assertEquals(ctx.requestHash, `sha256:${SHA}`);
});

Deno.test("contentIdem: a key over 200 chars is a 400", () => {
  assertThrows(
    () => contentIdem("assets.ingest", SHA, "k".repeat(201)),
    "idempotency key too long",
  );
});

Deno.test("idemFrom: without a header or body key there is no context", async () => {
  const req = new Request("http://x/jobs/asset", { method: "POST" });
  assertEquals(await idemFrom(req, { path: "a", sha256: SHA }, "assets.ingest"), null);
});

Deno.test("idemFrom: header key beats the body key and the hash ignores the key", async () => {
  const req = new Request("http://x/jobs/asset", {
    method: "POST",
    headers: { "idempotency-key": "from-header" },
  });
  const ctx = await idemFrom(req, { path: "a", idempotency_key: "from-body" }, "assets.ingest");
  assertEquals(ctx?.key, "from-header");
  const plain = await idemFrom(new Request("http://x", { method: "POST" }), { path: "a" }, "s");
  assertEquals(plain, null);
  const noKey = await idemFrom(
    new Request("http://x", { method: "POST", headers: { "idempotency-key": "k" } }),
    { path: "a" },
    "s",
  );
  assertEquals(noKey?.requestHash, ctx?.requestHash); // same body, hash unchanged by key
});
