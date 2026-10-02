import { assertEquals } from "std/assert/mod.ts";
import { pendingRows } from "./inbox.ts";

// GET /content/pending feeds the Telegram Mini App, which has no Supabase
// login (RLS shows it nothing). The rows must show the variant Jack would
// publish and judge Approve exactly like approve/enqueuePublish do.

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, post_type: "gold_map", lang: "en", status: "pending_approval", title: null,
  created_at: "2026-10-03T01:00:00Z", scheduled_at: null, source: {}, ...extra,
});
const variant = (id: string, content_id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id, content_id, platform: "telegram", body: `body ${id}`, created_at,
  compliance: { ok: true, findings: [] }, source: {}, ...extra,
});

Deno.test("pendingRows: the picked angle wins; otherwise the oldest non-angle variant", () => {
  const rows = pendingRows([item("a"), item("b")], [
    variant("a1", "a", "2026-10-03T01:00:00Z"),
    variant("a2", "a", "2026-10-03T02:00:00Z", { source: { via: "llm_variants", picked: false } }),
    variant("b1", "b", "2026-10-03T01:00:00Z"),
    variant("b2", "b", "2026-10-03T02:00:00Z", { source: { via: "llm_variants", picked: true } }),
  ]);
  assertEquals(rows.find((r) => r.id === "a")?.variant?.id, "a1");
  assertEquals(rows.find((r) => r.id === "b")?.variant?.id, "b2");
});

Deno.test("pendingRows: an unpicked angle never blocks; a blocked publishable variant does", () => {
  const rows = pendingRows([item("a"), item("b")], [
    variant("a1", "a", "2026-10-03T01:00:00Z"),
    variant("a2", "a", "2026-10-03T02:00:00Z", {
      source: { via: "llm_variants", picked: false }, compliance: { ok: false, findings: [{ severity: "blocking" }] },
    }),
    variant("b1", "b", "2026-10-03T01:00:00Z", { compliance: { ok: false, findings: [{ severity: "blocking", message: "risk line missing" }] } }),
  ]);
  const a = rows.find((r) => r.id === "a")!;
  const b = rows.find((r) => r.id === "b")!;
  assertEquals([a.blocked, a.can_approve], [false, true]);
  assertEquals([b.blocked, b.can_approve], [true, false]);
  assertEquals(b.findings.length, 1);
});

Deno.test("pendingRows: kits and items without a publishable variant cannot be approved", () => {
  const rows = pendingRows([item("k", { source: { kit: true } }), item("n")], [
    variant("k1", "k", "2026-10-03T01:00:00Z"),
    variant("n1", "n", "2026-10-03T01:00:00Z", { source: { via: "llm_variants", picked: false } }),
  ]);
  const k = rows.find((r) => r.id === "k")!;
  const n = rows.find((r) => r.id === "n")!;
  assertEquals([k.kit, k.can_approve], [true, false]);
  assertEquals([n.variant, n.can_approve], [null, false]);
});
