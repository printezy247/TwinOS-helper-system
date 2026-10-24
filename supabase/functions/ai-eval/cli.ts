/**
 * CI entry for .github/workflows/ai-eval.yml: run every golden case against
 * the live model and exit non-zero when one fails. Plain Deno — no edge
 * runtime — so it needs the env the functions use:
 *   OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (admin() in _shared/supabase.ts reads the last two; the workflow checks for
 * the key before ever calling this, so CI never fails over a credential the
 * owner has not supplied).
 *
 * Deliberately does NOT import ai-eval/index.ts — that file calls serve()
 * at module scope and would try to bind a port in CI.
 */
import { GOLDEN_CASES, runCase, saveScores, type CaseScore } from "../_shared/eval.ts";

const scores: CaseScore[] = [];
for (const c of GOLDEN_CASES) {
  const s = await runCase(c);
  scores.push(s);
  console.log(`${s.passed ? "PASS" : "FAIL"}  ${s.case_name}${s.error ? `  (${s.error})` : ""}`);
}

const meta = await saveScores(scores);
if (!meta.saved) {
  console.error(`could not persist ai_eval_runs rows: ${meta.error}`);
  Deno.exit(1);
}

const passed = scores.filter((s) => s.passed).length;
console.log(`\n${passed}/${scores.length} passed · prompt ${meta.prompt}`);
Deno.exit(passed === scores.length ? 0 : 1);
