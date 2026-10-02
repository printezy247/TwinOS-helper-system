import { assert, assertEquals } from "std/assert/mod.ts";
import { integrationStatus, PROVIDERS } from "./integrations.ts";

Deno.test("integrations: ready only when every required secret name is set", () => {
  const full: Record<string, string | undefined> = {};
  for (const p of PROVIDERS) for (const s of p.secrets) full[s] = "set";
  const ok = integrationStatus(full);
  assertEquals(ok.filter((i) => !i.ready), [], "all set means all ready");
  const none = integrationStatus({});
  const tg = none.find((i) => i.provider === "telegram")!;
  assertEquals(tg.ready, false);
  assertEquals(tg.missing, ["TWINOS_OPS_BOT_TOKEN"]);
});

Deno.test("integrations: an empty string counts as missing, values are never echoed", () => {
  const st = integrationStatus({ TWINOS_OPS_BOT_TOKEN: "", TWINOS_TV_SECRET: "x" });
  assertEquals(st.find((i) => i.provider === "telegram")!.ready, false);
  for (const i of st) assert(!("value" in i), "secret values must never leave the function");
});
