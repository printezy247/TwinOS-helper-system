import { assertEquals } from "std/assert/mod.ts";
import { secretOrSetting, __resetSecretReport } from "./secrets.ts";
import { __resetAdminClient } from "./supabase.ts";

/**
 * A3: a platform token comes from Vault when it is there, and from the legacy
 * settings row while the move is half-done.
 *
 * These run against a stubbed PostgREST: `rpc/get_secret` answers with the
 * Vault value, `rest/v1/settings` with the old row. Nothing here is a real
 * credential — every value is invented.
 */

const VAULT_VALUE = "twk_vault_" + "1".repeat(40);
const LEGACY_VALUE = "twk_legacy_" + "2".repeat(40);

interface Seen {
  vault: number;
  settings: number;
}

function stubPostgrest(opts: {
  vault: "value" | "null" | "error";
  legacy?: string;
  seen: Seen;
  warnings: string[];
}) {
  const original = globalThis.fetch;
  const savedWarn = console.warn;
  const savedLog = console.log;
  // Both streams: `reportOnce` is informational, the Vault miss is a warning,
  // and either one carrying a value would be the bug.
  const capture = (...args: unknown[]) => {
    opts.warnings.push(args.map(String).join(" "));
  };
  console.warn = capture;
  console.log = capture;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    if (url.includes("/rpc/get_secret")) {
      opts.seen.vault += 1;
      if (opts.vault === "error") return json({ message: "function not found" }, 404);
      return json(opts.vault === "value" ? VAULT_VALUE : null);
    }
    if (url.includes("/rest/v1/settings")) {
      opts.seen.settings += 1;
      // headers are read by the SDK; the body shape is what matters here
      void init;
      return json({ value: opts.legacy ?? null });
    }
    return json({});
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    console.warn = savedWarn;
    console.log = savedLog;
  };
}

function withEnv(): () => void {
  const before = {
    url: Deno.env.get("SUPABASE_URL"),
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  Deno.env.set("SUPABASE_URL", "https://stub.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "twk_service_" + "0".repeat(40));
  // A client built against the stub must not outlive the test.
  __resetAdminClient();
  return () => {
    __resetAdminClient();
    for (const [name, value] of [
      ["SUPABASE_URL", before.url],
      ["SUPABASE_SERVICE_ROLE_KEY", before.key],
    ] as const) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  };
}

const KEY = (n: string) => ({ secretName: `test_secret_${n}`, settingKey: `test_setting_${n}` });

Deno.test("the Vault value wins and the settings row is never read", async () => {
  const restoreEnv = withEnv();
  __resetSecretReport();
  const seen: Seen = { vault: 0, settings: 0 };
  const warnings: string[] = [];
  const restore = stubPostgrest({ vault: "value", legacy: LEGACY_VALUE, seen, warnings });
  try {
    const got = await secretOrSetting(KEY("t1"));
    assertEquals(got, VAULT_VALUE);
    assertEquals(seen.vault, 1);
    assertEquals(seen.settings, 0);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("an empty Vault falls back to the legacy settings row", async () => {
  const restoreEnv = withEnv();
  __resetSecretReport();
  const seen: Seen = { vault: 0, settings: 0 };
  const warnings: string[] = [];
  const restore = stubPostgrest({ vault: "null", legacy: LEGACY_VALUE, seen, warnings });
  try {
    const got = await secretOrSetting(KEY("t2"));
    assertEquals(got, LEGACY_VALUE);
    assertEquals(seen.vault, 1);
    assertEquals(seen.settings, 1);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("a Vault that is not installed yet falls back instead of throwing", async () => {
  const restoreEnv = withEnv();
  __resetSecretReport();
  const seen: Seen = { vault: 0, settings: 0 };
  const warnings: string[] = [];
  const restore = stubPostgrest({ vault: "error", legacy: LEGACY_VALUE, seen, warnings });
  try {
    const got = await secretOrSetting(KEY("t3"));
    assertEquals(got, LEGACY_VALUE);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("neither source set is null, not an empty string", async () => {
  const restoreEnv = withEnv();
  __resetSecretReport();
  const seen: Seen = { vault: 0, settings: 0 };
  const warnings: string[] = [];
  const restore = stubPostgrest({ vault: "null", seen, warnings });
  try {
    assertEquals(await secretOrSetting(KEY("t4")), null);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("the fallback is reported once per cold start, and never with its value", async () => {
  const restoreEnv = withEnv();
  __resetSecretReport();
  const seen: Seen = { vault: 0, settings: 0 };
  const warnings: string[] = [];
  const restore = stubPostgrest({ vault: "null", legacy: LEGACY_VALUE, seen, warnings });
  try {
    await secretOrSetting(KEY("t5"));
    await secretOrSetting(KEY("t5"));
    const about = warnings.filter((w) => w.includes("test_secret_t5"));
    assertEquals(about.length, 1, warnings.join("\n"));
    assertEquals(warnings.some((w) => w.includes(LEGACY_VALUE)), false, "a value reached the log");
  } finally {
    restore();
    restoreEnv();
  }
});
