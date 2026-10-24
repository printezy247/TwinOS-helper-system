/**
 * ai-eval — the prompt regression harness (UPGRADE-PHASES Phase 5).
 *
 *   POST /ai-eval/run {}   (content.approve = jack)  run every golden case
 *                           through the ACTIVE prompt + the real model, score
 *                           each output with the compliance check the approval
 *                           gate uses, store one ai_eval_runs row per case,
 *                           return a summary.
 *   GET  /ai-eval           (reports.read) → the last 50 runs.
 *
 * Every run spends real OpenRouter credits (one call per case), so it is
 * never a GET and never on a timer — a person or the CI workflow (which needs
 * the OPENROUTER_API_KEY repo secret) asks for it. authenticate() runs before
 * anything, so an anonymous probe gets 401 like the other JWT functions.
 *
 * The scoring itself lives in _shared/eval.ts so the CI CLI can reuse it
 * without importing this file (which starts a server on import).
 */
import { serve, json, routeOf, HttpError } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { admin } from "_shared/supabase.ts";
import { GOLDEN_CASES, runCase, saveScores, type CaseScore } from "_shared/eval.ts";
import { log } from "_shared/logger.ts";

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "ai-eval");

  if (method === "GET") {
    requireRole(caller.role, "reports.read");
    const { data, error } = await admin()
      .from("ai_eval_runs")
      .select("id, prompt_name, prompt_version, case_name, passed, error, model, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(503, "upstream_failed", error.message);
    return json({ runs: data ?? [] });
  }

  if (method === "POST" && (tail.length === 0 || tail[0] === "run")) {
    requireRole(caller.role, "content.approve"); // spends credits: jack only
    const scores: CaseScore[] = [];
    for (const c of GOLDEN_CASES) scores.push(await runCase(c));
    const meta = await saveScores(scores);
    if (!meta.saved) throw new HttpError(503, "upstream_failed", `saving eval rows failed: ${meta.error}`);

    const passed = scores.filter((s) => s.passed).length;
    log("info", "ai.eval.run", { ran: scores.length, passed, failed: scores.length - passed, prompt: meta.prompt });
    return json({
      ok: passed === scores.length,
      ran: scores.length,
      passed,
      failed: scores.length - passed,
      prompt: meta.prompt,
      scores: scores.map((s) => ({
        case_name: s.case_name,
        passed: s.passed,
        error: s.error,
        blocking: (s.findings as Array<{ severity?: string }>).filter((f) => f.severity === "blocking").length,
      })),
    });
  }

  return json({ error: "not_found" }, 404);
});
