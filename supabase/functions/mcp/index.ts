/**
 * mcp — TwinOS as an MCP server (UPGRADE-PHASES Phase 7; Decision 5's
 * default: bearer token, same as the edge functions).
 *
 *   POST /mcp   JSON-RPC 2.0 — initialize · notifications/initialized ·
 *               tools/list · tools/call. One JSON response per POST (the
 *               simple HTTP mode; no SSE stream).
 *
 * Auth is the shared authenticate(): `Authorization: Bearer twk_partner_…`
 * is read directly (hence --no-verify-jwt in scripts/deploy.sh, next to ai
 * and webhooks), and the anon JWT + X-TwinOS-Key pair works too. Every tool
 * is checked against roles.ts for the caller's role, and against the key's
 * own scopes when the key carries them, BEFORE anything runs — the server
 * never holds more privilege than the caller itself.
 *
 * Seven tools, no approve: approving and posting stay Jack's tap (the plan's
 * Decision 5 table said approve_post; the repo's standing rule — tested in
 * apps/mcp and enforced in roles.ts — wins, see _shared/mcp.ts).
 *
 * Reads that already have a route forward the caller's own credential to it;
 * get_signals and search_feed answer from the database behind the same
 * roles.ts checks (their routes exist only as PostgREST reads for the
 * dashboard/ABDUL, not as edge routes a partner may call).
 *
 * Register with an agent (Claude Code example):
 *   claude mcp add --transport http twinos \
 *     https://<project-ref>.supabase.co/functions/v1/mcp \
 *     --header "Authorization: Bearer twk_partner_…"
 */
import { bad, CORS_HEADERS, HttpError, json, readJson, serve } from "_shared/http.ts";
import { apiKeyFrom, authenticate, type Caller } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin } from "_shared/supabase.ts";
import {
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  toolNamed,
  toolsForList,
  type McpTool,
} from "_shared/mcp.ts";

type ToolResult = { text: string; isError?: boolean };

const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

const errText = (e: unknown): string =>
  e instanceof HttpError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);

const SIGNAL_STATUSES = ["pending", "running", "tp", "tp1", "tp2", "be", "sl"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pretty = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const clampInt = (raw: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

function weekParam(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw bad("week must be YYYY-MM-DD (a Monday)");
  }
  return raw;
}

/**
 * Forward the CALLER's own credential to the function that serves the route:
 * scoped keys ride as anon + X-TwinOS-Key (the pair the gateway admits),
 * logins forward their JWT unchanged. The target re-runs authenticate() and
 * its own role check, so nothing is escalated by passing through here.
 */
async function forward(
  req: Request,
  method: string,
  path: string,
  payload?: Record<string, unknown>,
): Promise<ToolResult> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new HttpError(503, "not_configured", "SUPABASE_URL missing");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = apiKeyFrom(req);
  if (key) {
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
    headers["X-TwinOS-Key"] = key;
  } else {
    headers.Authorization = req.headers.get("authorization") ?? "";
  }
  const res = await fetch(`${base}/functions/v1${path}`, {
    method,
    headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) return { text: `HTTP ${res.status}: ${text.slice(0, 2000)}`, isError: true };
  return { text: pretty(text) };
}

async function getSignals(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = clampInt(args.limit, 50, 1, 100);
  const status = typeof args.status === "string" && args.status ? args.status : null;
  if (status && !SIGNAL_STATUSES.includes(status)) {
    throw bad(`status must be one of ${SIGNAL_STATUSES.join(", ")}`);
  }
  let q = admin().from("signals").select(
    "external_id, symbol, direction, status, entry_low, entry_high, stop_price, tp1, tp2, rr, opened_at, updated_at",
  );
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("opened_at", { ascending: false }).limit(limit);
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  return { text: pretty(JSON.stringify({ signals: data ?? [] })) };
}

async function searchFeed(args: Record<string, unknown>): Promise<ToolResult> {
  const raw = typeof args.q === "string" ? args.q.trim() : "";
  if (!raw) throw bad("q is required");
  if (raw.length > 200) throw bad("q is longer than 200 characters");
  // PostgREST .or() parses parentheses and commas as filter syntax; strip
  // them rather than letting a search phrase become an expression.
  const needle = raw.replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!needle) throw bad("q has no searchable characters");
  const limit = clampInt(args.limit, 20, 1, 100);
  const since = weekParam(args.since); // YYYY-MM-DD is the shape any caller sends
  let q = admin().from("feed_items")
    .select("id, title, summary, link, published_at, feeds(name)")
    .or(`title.ilike.%${needle}%,summary.ilike.%${needle}%`);
  if (since) q = q.gte("published_at", since);
  const { data, error } = await q.order("published_at", { ascending: false }).limit(limit);
  if (error) throw new HttpError(503, "upstream_failed", error.message);
  return { text: pretty(JSON.stringify({ items: data ?? [] })) };
}

function draftBody(args: Record<string, unknown>): Record<string, unknown> {
  const postType = typeof args.post_type === "string" ? args.post_type.trim() : "";
  if (!postType) throw bad("post_type is required");
  const body: Record<string, unknown> = { post_type: postType, fields: {} };
  if (typeof args.lang === "string") body.lang = args.lang;
  if (typeof args.platform === "string") body.platform = args.platform;
  if (args.fields && typeof args.fields === "object" && !Array.isArray(args.fields)) {
    body.fields = args.fields;
  }
  if (args.push_to_desk === true) body.push_to_desk = true;
  if (Array.isArray(args.allowed_numbers)) body.allowed_numbers = args.allowed_numbers;
  return body;
}

async function fanout(args: Record<string, unknown>, req: Request): Promise<ToolResult> {
  const id = typeof args.content_id === "string" ? args.content_id : "";
  if (!UUID_RE.test(id)) throw bad("content_id must be a content id (uuid)");
  const body: Record<string, unknown> = {};
  if (Array.isArray(args.platforms)) body.platforms = args.platforms.map(String);
  return await forward(req, "POST", `/content/${id}/fanout`, body);
}

async function runTool(req: Request, caller: Caller, tool: McpTool, args: Record<string, unknown>): Promise<ToolResult> {
  // Role first — the same check the target route would run — then the key's
  // own scopes when it carries them: a read:health-only key cannot draft even
  // though the partner role may.
  try {
    requireRole(caller.role, tool.action);
  } catch (e) {
    return { text: errText(e), isError: true };
  }
  const scopes = caller.scopes ?? [];
  if (scopes.length > 0 && !scopes.includes(tool.scope)) {
    return {
      text: `forbidden: this key's scopes (${scopes.join(", ")}) do not include ${tool.scope}`,
      isError: true,
    };
  }
  try {
    switch (tool.name) {
      case "get_health":
        return await forward(req, "GET", "/health");
      case "get_friday": {
        const week = weekParam(args.week);
        return await forward(req, "GET", week ? `/friday?week=${week}` : "/friday");
      }
      case "get_calendar": {
        const week = weekParam(args.week);
        return await forward(req, "GET", week ? `/content/calendar?week=${week}` : "/content/calendar");
      }
      case "get_signals":
        return await getSignals(args);
      case "search_feed":
        return await searchFeed(args);
      case "draft_post":
        return await forward(req, "POST", "/content/draft", draftBody(args));
      case "fanout_post":
        return await fanout(args, req);
      default:
        return { text: `tool not implemented: ${tool.name}`, isError: true };
    }
  } catch (e) {
    return { text: errText(e), isError: true };
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    // The live probe sends GET with no credential: authenticate first so it
    // sees 401 (deployed and refusing) rather than a method error.
    await authenticate(req);
    throw bad("POST a JSON-RPC message to /mcp");
  }
  const caller = await authenticate(req);
  const body = await readJson(req);

  const id = body.id === undefined ? null : body.id;
  const method = typeof body.method === "string" ? body.method : "";
  if (!method) return json(rpcError(id, -32600, "invalid request: method is required"));

  // A notification (no id) gets an empty 202, never a body.
  if (id === null) return new Response(null, { status: 202, headers: CORS_HEADERS });

  const params = (body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? body.params
    : {}) as Record<string, unknown>;

  switch (method) {
    case "initialize":
      return json(rpcOk(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "TwinOS: reads and drafts only. Approving and posting stay with Jack.",
      }));
    case "ping":
      return json(rpcOk(id, {}));
    case "tools/list":
      return json(rpcOk(id, { tools: toolsForList() }));
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolNamed(name);
      if (!tool) return json(rpcError(id, -32602, `unknown tool: ${name || "(missing name)"}`));
      const args = (params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments
        : {}) as Record<string, unknown>;
      const result = await runTool(req, caller, tool, args);
      return json(rpcOk(id, {
        content: [{ type: "text", text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      }));
    }
    default:
      return json(rpcError(id, -32601, `method not found: ${method}`));
  }
});
