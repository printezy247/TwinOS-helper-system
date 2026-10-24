/**
 * Partner API key vocabulary (Phase 7: "Scoped keys (read:health,
 * write:posts, read:signals) + rate limits per key; dashboard manages keys").
 *
 * Scopes are the per-key labels the dashboard mints and the MCP server
 * enforces per tool. The ROLE is what bounds a partner key on the ordinary
 * REST routes (roles.ts); the scopes narrow that further where they are
 * checked. Exactly the three the plan names exist — inventing a fourth would
 * be a scope no partner's key was documented to carry.
 */
import { bad } from "./http.ts";

export const KEY_SCOPES = ["read:health", "read:signals", "write:posts"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

/** Partner keys mint with this limit; the dashboard may change it per key. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 60;
export const MAX_RATE_LIMIT_PER_MIN = 100_000;

/** Validate + dedupe a requested scope list; refuses anything not in the plan. */
export function validateScopes(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw bad("scopes must be a non-empty array", { field: "scopes", allowed: [...KEY_SCOPES] });
  }
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== "string" || !(KEY_SCOPES as readonly string[]).includes(s)) {
      throw bad(`unknown scope: ${String(s)}`, { field: "scopes", allowed: [...KEY_SCOPES] });
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** The per-key requests-per-minute: default when omitted, whole 1..MAX otherwise. */
export function validateRate(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_RATE_LIMIT_PER_MIN;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RATE_LIMIT_PER_MIN) {
    throw bad(`rate_limit_per_min must be a whole number between 1 and ${MAX_RATE_LIMIT_PER_MIN}`, {
      field: "rate_limit_per_min",
    });
  }
  return n;
}
