import { assertEquals, assertExists } from "std/assert/mod.ts";
import { KEY_SCOPES } from "./apikeys.ts";
import { can } from "./roles.ts";
import { TOOLS, toolNamed, toolsForList } from "./mcp.ts";

Deno.test("the v1 tool table is the plan's list minus approve — 7 within the 8-tool cap", () => {
  assertEquals(
    TOOLS.map((t) => t.name).sort(),
    ["draft_post", "fanout_post", "get_calendar", "get_friday", "get_health", "get_signals", "search_feed"],
  );
  // The risk register caps v1 at 8 tools (UPGRADE-PHASES Phase 7).
  assertEquals(TOOLS.length <= 8, true, `expected ≤8 tools, found ${TOOLS.length}`);
  // approve_post was in the plan's table and is deliberately absent: approval
  // is the one verb no agent holds (roles.ts content.approve = ["jack"]).
  assertEquals(toolNamed("approve_post"), undefined);
  assertEquals(TOOLS.some((t) => /approv|publish_now|force/i.test(t.name)), false);
});

Deno.test("every tool is an action the partner role holds — and partner still cannot approve", () => {
  for (const t of TOOLS) {
    assertEquals(can("partner", t.action), true, `${t.name} needs ${t.action}, which partner lacks`);
  }
  assertEquals(can("partner", "content.approve"), false);
  assertEquals(can("partner", "content.cancel"), false);
  assertEquals(can("partner", "webhooks.manage"), false);
  assertEquals(can("partner", "keys.manage"), false);
});

Deno.test("every tool declares one of the plan's three scopes; writes carry write:posts", () => {
  for (const t of TOOLS) {
    assertEquals((KEY_SCOPES as readonly string[]).includes(t.scope), true, `${t.name}: bad scope ${t.scope}`);
    assertEquals(t.inputSchema.type, "object", `${t.name} needs an object inputSchema`);
    assertExists(t.description, `${t.name} needs a description agents can read`);
  }
  for (const t of TOOLS) {
    if (t.action === "content.draft") assertEquals(t.scope, "write:posts", `${t.name} writes, so write:posts`);
    else assertEquals(t.scope === "write:posts", false, `${t.name} only reads but claims write:posts`);
  }
});

Deno.test("tools/list exposes protocol fields only — no action, no scope", () => {
  const listed = toolsForList();
  assertEquals(listed.length, TOOLS.length);
  for (const t of listed) {
    assertEquals("action" in t, false, "the permission map stays server-side");
    assertEquals("scope" in t, false, "the scope map stays server-side");
    assertExists(t.inputSchema);
  }
});
