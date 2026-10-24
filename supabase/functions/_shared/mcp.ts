/**
 * The MCP server's tool table (Phase 7, Decision 5).
 *
 * Decision 5's default: bearer token, same as the edge functions — the mcp
 * function is deployed --no-verify-jwt and reads `Authorization: Bearer twk_…`
 * (or the usual anon JWT + X-TwinOS-Key) through the shared authenticate().
 *
 * Seven tools, not eight: the plan's table listed `approve_post`, but
 * approval is the one verb no agent holds (roles.ts: content.approve is Jack
 * only; apps/mcp refuses any approve path). Drafting and fanning out are
 * covered; the tap stays Jack's. The risk register caps v1 at 8 tools.
 *
 * Every tool carries the roles.ts action checked before it runs and the
 * partner-key scope checked when the caller's key has scopes — so the table
 * itself is testable without starting an HTTP server.
 */
import { KEY_SCOPES, type KeyScope } from "./apikeys.ts";
import type { Action } from "./roles.ts";

export const SERVER_NAME = "twinos-mcp";
export const SERVER_VERSION = "1.0.0";
export const PROTOCOL_VERSION = "2025-06-18";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** The permission from roles.ts, checked before the tool runs. */
  action: Action;
  /** The scope a scoped partner key must carry (unscoped keys: role only). */
  scope: KeyScope;
};

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const TOOLS: readonly McpTool[] = [
  {
    name: "get_health",
    description:
      "Anything broken? Stale beats, failed jobs, expiring tokens, quota, open alerts. One short answer.",
    inputSchema: { type: "object", properties: {} },
    action: "reports.read",
    scope: "read:health",
  },
  {
    name: "get_friday",
    description:
      "The Friday scoreboard: members, joins, TikTok, bot starts, IB numbers, revenue, signals vs results, strict win rate. Latest week unless 'week' (ISO Monday) is given.",
    inputSchema: {
      type: "object",
      properties: { week: str("ISO Monday, YYYY-MM-DD (default: latest week)") },
    },
    action: "reports.read",
    scope: "read:health",
  },
  {
    name: "get_calendar",
    description:
      "The posting calendar for one week: what is queued and when, newest slots first. Defaults to the current week.",
    inputSchema: {
      type: "object",
      properties: { week: str("ISO Monday, YYYY-MM-DD (default: current week)") },
    },
    action: "reports.read",
    scope: "read:health",
  },
  {
    name: "get_signals",
    description:
      "The trading signals board, newest first: symbol, direction, status, entry, stop, TPs, R:R. Optional status filter (pending, running, tp, tp1, tp2, be, sl).",
    inputSchema: {
      type: "object",
      properties: {
        status: str("Only this status (default: every status)"),
        limit: int("Rows, 1-100 (default 50)"),
      },
    },
    action: "reports.read",
    scope: "read:signals",
  },
  {
    name: "search_feed",
    description:
      "Search what the research feeds collected (macro news, YouTube, Bluesky, Mastodon) for one phrase: title or summary matches, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        q: str("The phrase to search for"),
        since: str("ISO date to start from (default: all history)"),
        limit: int("Rows, 1-100 (default 20)"),
      },
      required: ["q"],
    },
    action: "research.read",
    scope: "read:health",
  },
  {
    name: "draft_post",
    description:
      "Render one post from a template into a DRAFT — nothing is posted, publishing needs Jack's approval. post_type from the template set (gold_map, lesson, offer, …); fields = the fields the template names; push_to_desk sends it to Jack for approval.",
    inputSchema: {
      type: "object",
      properties: {
        post_type: str("The template key"),
        lang: str("en | ms | manglish"),
        platform: str("telegram | tiktok | instagram | …"),
        fields: { type: "object", description: "The fields the template names" },
        push_to_desk: { type: "boolean", description: "Send to Jack's Desk for approval (default false)" },
        allowed_numbers: { type: "array", description: "Jack's own numbers compliance may keep" },
      },
      required: ["post_type"],
    },
    action: "content.draft",
    scope: "write:posts",
  },
  {
    name: "fanout_post",
    description:
      "Fan an approved/master draft out to the other platforms as new drafts (still unposted). content_id required; platforms optional.",
    inputSchema: {
      type: "object",
      properties: {
        content_id: str("The master content id"),
        platforms: { type: "array", description: 'e.g. ["tiktok", "instagram"] (default: every enabled platform)' },
      },
      required: ["content_id"],
    },
    action: "content.draft",
    scope: "write:posts",
  },
];

export function toolNamed(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** tools/list exposes protocol fields only — action and scope stay server-side. */
export function toolsForList(): { name: string; description: string; inputSchema: unknown }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** The plan's three scopes, re-exported so the mcp function needs one import. */
export { KEY_SCOPES };
