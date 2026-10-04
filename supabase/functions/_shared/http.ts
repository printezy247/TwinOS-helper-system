/**
 * Consistent JSON responses, error shapes and body parsing for every function.
 *
 * Every error leaves as `{ error: <code>, message?: <human>, ...detail }` with
 * an HTTP status, so the dashboard, ABDUL and the PC worker can branch on
 * `error` without parsing prose. Codes used across functions:
 *
 *   unauthorized · forbidden · bad_request · not_found · conflict ·
 *   rate_limited · not_configured · upstream_failed · internal
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message ?? code);
  }
}

/**
 * `TWINOS_CORS_ORIGIN` pins the API to one web origin (the Lovable dashboard
 * or the Mini App's domain) once Jack knows it; unset keeps the historical
 * `*`. Auth is header-token based (no cookies), so `*` was never directly
 * exploitable — this only tightens the blast radius of a leaked token.
 */
function corsOrigin(): string {
  return Deno.env.get("TWINOS_CORS_ORIGIN")?.trim() || "*";
}

export const CORS_HEADERS: Record<string, string> = {
  get "access-control-allow-origin"() {
    return corsOrigin();
  },
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-twinos-actor, x-twinos-key, x-twinos-session",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.code, message: err.message, ...err.detail }, err.status);
  }
  console.error("[twinos] unhandled", err);
  return json({ error: "internal", message: "unexpected failure" }, 500);
}

export const bad = (message: string, detail: Record<string, unknown> = {}) =>
  new HttpError(400, "bad_request", message, detail);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string, detail: Record<string, unknown> = {}) =>
  new HttpError(409, "conflict", message, detail);

/** Parse a JSON object body or throw 400. Empty body → {} when `allowEmpty`. */
export async function readJson(
  req: Request,
  allowEmpty = false,
): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) {
    if (allowEmpty) return {};
    throw bad("expected a JSON object body");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bad("body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw bad("expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Tiny validators: enough to refuse the obviously wrong without a schema library. */
export function reqString(
  obj: Record<string, unknown>,
  key: string,
  opts: { max?: number; min?: number } = {},
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim().length < (opts.min ?? 1)) {
    throw bad(`${key} is required`, { field: key });
  }
  if (opts.max && v.length > opts.max) {
    throw bad(`${key} is longer than ${opts.max} characters`, { field: key });
  }
  return v;
}

export function optString(obj: Record<string, unknown>, key: string, max = 4000): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw bad(`${key} must be a string`, { field: key });
  if (v.length > max) throw bad(`${key} is longer than ${max} characters`, { field: key });
  return v;
}

export function optNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw bad(`${key} must be a number`, { field: key });
  return n;
}

export function oneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw bad(`${key} is required (${allowed.join(", ")})`, { field: key });
  }
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw bad(`${key} must be one of ${allowed.join(", ")}`, { field: key });
  }
  return v as T;
}

/** Route on method + optional path tail. `tail` is whatever follows the function name. */
export function routeOf(req: Request, fnName: string): { method: string; tail: string[] } {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf(fnName);
  const tail = idx >= 0 ? parts.slice(idx + 1) : [];
  return { method: req.method.toUpperCase(), tail };
}

/** Standard wrapper: CORS preflight, error funnel, no stack traces to the client. */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  });
}
