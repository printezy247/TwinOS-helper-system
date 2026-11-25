/** Single-process host for the TwinOS Edge Functions on Railway.
 *
 * Supabase Envoy strips `/functions/v1/` and forwards `/<function>/<tail>`.
 * This router owns the only HTTP listener, loads each function once and
 * dispatches on the first path segment to the handler registered by serve().
 * Set `TWINOS_NO_SERVE=1` (done below) so serve() registers instead of
 * starting its own listener on the same port.
 */
import { CORS_HEADERS, errorResponse } from "./_shared/http.ts";

const NAMES = [
  "ai", "ai-eval", "approve", "content", "friday", "health", "jobs", "keys",
  "links", "mcp", "metrics", "publish", "research", "results", "tg-auth",
  "tg-webhook", "tv-webhook", "webhooks",
] as const;

type Handler = (req: Request) => Promise<Response>;
type Registry = { __twinosHandler?: Handler };
const registry = globalThis as unknown as Registry;
const handlers = new Map<string, Handler>();

Deno.env.set("TWINOS_NO_SERVE", "1");

for (const name of NAMES) {
  try {
    registry.__twinosHandler = undefined;
    await import(`./${name}/index.ts`);
    const handler = registry.__twinosHandler;
    if (typeof handler === "function") handlers.set(name, handler);
    else console.error(`[router] ${name} did not register a handler`);
  } catch (err) {
    console.error(`[router] failed to load ${name}:`, err);
  }
}
console.log(`[router] loaded ${handlers.size}/${NAMES.length} functions`);

const port = Number(Deno.env.get("PORT") ?? "9000");
Deno.serve({ hostname: "::", port }, async (req) => {
  const path = new URL(req.url).pathname;
  const name = path.split("/").filter(Boolean)[0] ?? "";
  const handler = handlers.get(name);
  if (!handler) {
    return new Response(
      JSON.stringify({ error: "not_found", message: `Unknown function: ${name}` }),
      { status: 404, headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS } },
    );
  }
  try {
    return await handler(req);
  } catch (err) {
    console.error(`[router] ${name} failed:`, err);
    return errorResponse(err);
  }
});
