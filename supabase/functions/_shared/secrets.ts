/**
 * A3: platform tokens live in Vault, settings still carry the old plaintext
 * row until the move is finished.
 *
 * One reader, two sources, Vault first:
 *
 *   get_secret('meta_ig_token')  →  the decrypted Vault value
 *   settings.meta_ig_token       →  the legacy plaintext value
 *
 * The fallback is deliberately permanent-running-for-one-release rather than a
 * flag: a half-migrated environment (Vault not installed, or the secret not
 * created yet) keeps working exactly as it did, and nothing has to be deployed
 * in a particular order. Callers cannot tell which source answered, and no
 * value is ever returned over HTTP.
 *
 * A token NAME is not a secret; only the value is. Everything logged here is a
 * name.
 */
import { admin, setting } from "./supabase.ts";
import { redactSecrets } from "./providers.ts";

type Source = "vault" | "settings" | "env";

/** Names already reported this cold start, so a hot path logs once, not per call. */
const reported = new Set<string>();

/** Test seam: the process-wide report cache must not leak between tests. */
export function __resetSecretReport(): void {
  reported.clear();
}

function reportOnce(secretName: string, source: Source): void {
  const key = `${secretName}:${source}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.log(`[secrets] ${secretName} came from ${source}`);
}

/** The Vault value, or null when the function, the schema or the name is absent. */
async function vaultSecret(secretName: string): Promise<string | null> {
  try {
    const { data, error } = await admin().rpc("get_secret", { p_name: secretName });
    if (error) throw new Error(error.message ?? "get_secret failed");
    return typeof data === "string" && data.length > 0 ? data : null;
  } catch (err) {
    // A project that has not run the migration yet is a supported state: the
    // complaint is one line per name per cold start, never the value.
    if (!reported.has(`${secretName}:vault-missing`)) {
      reported.add(`${secretName}:vault-missing`);
      console.warn(
        `[secrets] ${secretName}: get_secret unavailable, using the settings fallback —`,
        redactSecrets(String(err instanceof Error ? err.message : err)).slice(0, 200),
      );
    }
    return null;
  }
}

export interface SecretLookup {
  /** Vault secret name, by the one naming convention the project uses. */
  secretName: string;
  /** The settings row that still holds the plaintext value, while it exists. */
  settingKey: string;
  /** Function secret, the last resort on a fresh project. */
  envFallback?: string;
}

/**
 * Vault → settings → env. Null means "not configured", which every caller
 * already treats as a nameable skip rather than a failure.
 */
export async function secretOrSetting(lookup: SecretLookup): Promise<string | null> {
  const fromVault = await vaultSecret(lookup.secretName);
  if (fromVault) {
    reportOnce(lookup.secretName, "vault");
    return fromVault;
  }
  const legacy = await setting(lookup.settingKey, undefined);
  if (legacy) {
    reportOnce(lookup.secretName, "settings");
    return legacy;
  }
  if (lookup.envFallback) {
    const env = Deno.env.get(lookup.envFallback);
    if (env) {
      reportOnce(lookup.secretName, "env");
      return env;
    }
  }
  return null;
}

/**
 * The five platform credentials and the Vault name each one moves to.
 * `twinos_move_tokens_to_vault()` in the migration uses the same pairs, so the
 * reader and the mover cannot drift.
 */
export const PLATFORM_SECRETS = {
  openrouter: { secretName: "twinos_openrouter_key", settingKey: "openrouter_api_key", envFallback: "TWINOS_OPENROUTER_API_KEY" },
  metaIg: { secretName: "meta_ig_token", settingKey: "meta_ig_token", envFallback: "TWINOS_META_IG_TOKEN" },
  metaPage: { secretName: "meta_page_token", settingKey: "meta_page_token", envFallback: "TWINOS_META_PAGE_TOKEN" },
  threads: { secretName: "threads_token", settingKey: "threads_token", envFallback: "TWINOS_THREADS_TOKEN" },
  youtube: { secretName: "yt_api_key", settingKey: "yt_api_key", envFallback: "TWINOS_YT_API_KEY" },
} as const satisfies Record<string, SecretLookup>;
