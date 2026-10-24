import { assert, assertEquals } from "std/assert/mod.ts";
import { currentTrace, runWithTrace, traceHeaders, traceIdFromReq, withTrace } from "./trace.ts";

Deno.test("traceIdFromReq adopts a well-formed header value", () => {
  const id = crypto.randomUUID();
  const req = new Request("https://x/", { headers: { "x-twinos-trace": id } });
  assertEquals(traceIdFromReq(req), id);
});

Deno.test("traceIdFromReq ignores junk and mints a UUID", () => {
  for (const bad of ["not-a-uuid", "1", "../../etc", ""]) {
    const req = new Request("https://x/", { headers: { "x-twinos-trace": bad } });
    const got = traceIdFromReq(req);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(got), `bad input accepted: ${bad}`);
  }
});

Deno.test("currentTrace is visible inside runWithTrace and null outside", async () => {
  const id = crypto.randomUUID();
  assertEquals(currentTrace(), null);
  const seen = await runWithTrace(id, async () => {
    await new Promise((r) => setTimeout(r, 1));
    return currentTrace();
  });
  assertEquals(seen, id);
  assertEquals(currentTrace(), null);
});

Deno.test("traceHeaders emits the current id, nothing outside a request", () => {
  assertEquals(traceHeaders(), {});
  const id = crypto.randomUUID();
  runWithTrace(id, () => assertEquals(traceHeaders(), { "x-twinos-trace": id }));
});

Deno.test("withTrace stamps once and never overwrites an existing id", () => {
  const id = crypto.randomUUID();
  const fresh = withTrace({ kind: "clip" });
  assertEquals(fresh, { kind: "clip" }); // no request context → untouched
  runWithTrace(id, () => {
    assertEquals(withTrace({ kind: "clip" }), { kind: "clip", trace_id: id });
    assertEquals(withTrace({ kind: "clip", trace_id: "keep-me" }), { kind: "clip", trace_id: "keep-me" });
    assertEquals(withTrace(undefined), undefined);
  });
});
