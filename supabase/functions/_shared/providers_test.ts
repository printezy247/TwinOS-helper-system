import { assertEquals } from "std/assert/mod.ts";
import { checkMetaToken, checkTelegram } from "./providers.ts";

const json = (body: unknown, status = 200) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const fetchOf = (fn: () => Promise<Response>) => fn as unknown as typeof fetch;

Deno.test("telegram: getMe ok is up", async () => {
  const r = await checkTelegram("tok", fetchOf(json({ ok: true, result: { username: "EzyOps_bot" } })));
  assertEquals(r, { provider: "telegram", ok: true, detail: "getMe ok" });
});

Deno.test("telegram: a 401 is down, not a throw", async () => {
  const r = await checkTelegram(
    "tok",
    fetchOf(json({ ok: false, error_code: 401, description: "Unauthorized" }, 401)),
  );
  assertEquals(r.ok, false);
});

Deno.test("providers: no token means needs-credentials and no fetch at all", async () => {
  let called = 0;
  const never = (() => {
    called++;
    throw new Error("must not fetch without a token");
  }) as unknown as typeof fetch;
  assertEquals((await checkTelegram(undefined, never)).detail, "needs-credentials");
  assertEquals((await checkMetaToken("instagram", undefined, never)).detail, "needs-credentials");
  assertEquals(called, 0);
});

Deno.test("meta: a good token is up, a bad one names the failure", async () => {
  const up = await checkMetaToken(
    "instagram",
    "tok",
    fetchOf(json({ id: "123" })),
  );
  assertEquals(up.ok, true);
  const down = await checkMetaToken(
    "threads",
    "tok",
    fetchOf(json({ error: { message: "Invalid OAuth access token." } }, 400)),
  );
  assertEquals(down, { provider: "threads", ok: false, detail: "Invalid OAuth access token." });
});
