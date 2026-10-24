/**
 * Golden cases and scoring for the prompt regression harness (Phase 5).
 *
 * Kept out of ai-eval/index.ts so `cli.ts` can import it without executing
 * Deno.serve(): CI and the HTTP route must score identically, and neither may
 * pay that price twice.
 *
 * A case passes when the completion is non-empty and the SAME compliance
 * check the approval gate runs finds nothing blocking — i.e. the output would
 * survive the draft → Desk path without a manual rewrite.
 */
import { admin } from "./supabase.ts";
import { check, type VariantInput } from "./compliance.ts";
import { buildAiPrompt, completeOpenRouter, type OpenRouterMessage } from "./openrouter.ts";
import { activePrompt } from "./prompts.ts";

export type GoldenCase = {
  name: string;
  mode: string;
  params: Record<string, unknown>;
  as: Pick<VariantInput, "post_type" | "platform" | "lang">;
};

/** The three modes drafts actually pass through: draft, hooks, polish. */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "draft_post:lesson:telegram",
    mode: "draft_post",
    params: {
      topic: "Gold retesting 4030 after a soft CPI print",
      pillar: "lesson",
      platform: "telegram",
      tone: "educational and actionable",
    },
    as: { post_type: "lesson", platform: "telegram", lang: "en" },
  },
  {
    name: "hook_variations:psychology",
    mode: "hook_variations",
    params: { topic: "stopping out early on a good setup" },
    as: { post_type: "lesson", platform: "telegram", lang: "en" },
  },
  {
    name: "polish:short-caption",
    mode: "polish",
    params: {
      text: "Gold held 4030 through the session. Levels are on the chart in the channel. Come trade the plan with us.",
    },
    as: { post_type: "lesson", platform: "telegram", lang: "en" },
  },
];

export type CaseScore = {
  case_name: string;
  passed: boolean;
  findings: unknown[];
  output: string;
  error: string | null;
};

/** Prompt assembly shared by the HTTP route and the CI CLI (active prompt wins over the code template). */
export async function buildGolden(c: GoldenCase): Promise<OpenRouterMessage[]> {
  const messages = buildAiPrompt(c.mode, c.params);
  const prompt = await activePrompt(c.mode, {
    platform: typeof c.params.platform === "string" ? c.params.platform : undefined,
    pillar: typeof c.params.pillar === "string" ? c.params.pillar : undefined,
  });
  if (prompt) messages[0] = { role: "system", content: prompt.body };
  return messages;
}

/** Pure scoring: what the harness decides about one completion. */
export function scoreOutput(text: string, c: GoldenCase): CaseScore {
  if (!text.trim()) {
    return { case_name: c.name, passed: false, findings: [], output: "", error: "empty completion" };
  }
  const result = check({ ...c.as, body: text });
  return {
    case_name: c.name,
    passed: result.ok,
    findings: result.findings as unknown[],
    output: text.slice(0, 4000),
    error: null,
  };
}

export async function runCase(c: GoldenCase): Promise<CaseScore> {
  try {
    const messages = await buildGolden(c);
    const text = await completeOpenRouter({ messages });
    return scoreOutput(text, c);
  } catch (err) {
    return {
      case_name: c.name,
      passed: false,
      findings: [],
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Persist one row per case; returns the prompt label the rows carry. */
export async function saveScores(
  scores: CaseScore[],
): Promise<{ prompt: string; saved: boolean; error: string | null }> {
  const prompt = await activePrompt("draft_post", {}).catch(() => null);
  const label = prompt ? prompt.name : "code-fallback";
  const version = prompt ? prompt.version : 0;
  const { error } = await admin()
    .from("ai_eval_runs")
    .insert(
      scores.map((s) => ({
        prompt_name: label,
        prompt_version: version,
        case_name: s.case_name,
        passed: s.passed,
        findings: s.findings,
        output: s.output,
        error: s.error,
        model: null,
      })),
    );
  return {
    prompt: prompt ? `${prompt.name}@${prompt.version}` : "code-fallback",
    saved: !error,
    error: error?.message ?? null,
  };
}
