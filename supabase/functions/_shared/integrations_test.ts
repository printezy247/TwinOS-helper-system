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

// The Keyring panel renders these, so a missing one is a broken setup screen
// rather than a blank line.
Deno.test("integrations: every provider carries the guidance the Keyring needs", () => {
  for (const i of integrationStatus({})) {
    assert(i.purpose.trim().length > 10, `${i.provider} needs a purpose`);
    assert(/^https:\/\//.test(i.get_url), `${i.provider} get_url must be a real link`);
    assert(i.set_command.includes("supabase secrets set"), `${i.provider} set_command must be the real command`);
  }
});

Deno.test("integrations: the set command names the secret it actually sets", () => {
  for (const p of PROVIDERS) {
    const m = /set\s+([A-Z0-9_]+)=/.exec(p.set_command);
    assert(m, `${p.provider}: set_command must be a supabase secrets set line`);
    assert(p.secrets.includes(m![1]), `${p.provider}: ${m![1]} is not one of its own secrets`);
  }
});
