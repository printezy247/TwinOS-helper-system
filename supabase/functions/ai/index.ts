/**
 * ai — OpenRouter LLM generation endpoint for TwinOS.
 *
 *   POST /ai/generate  { mode?, topic?, pillar?, platform?, tone?, text?, model?,
 *                        prompt_name?, prompt_version? }   picker pin from the dashboard
 *   POST /ai/memory    { kind, content, pillar?, platform?, lang?, weight? }   remember a line (jack)
 *   GET  /ai/status    → { configured, model, available_modes, prompts, memories, last_eval }
 *
 * Phase 5 (UPGRADE-PHASES): the system prompt comes from the versioned prompt
 * library when a row matches (prompts.ts) and up to three remembered lines
 * are prepended; the hard-coded template in openrouter.ts stays the fallback,
 * so an empty library never breaks generation. The response reports what was
 * applied (`applied.prompt`, `applied.memories`) instead of leaving the caller
 * to guess.
 *
 * authenticate() runs on every route — status included — so only a signed-in
 * caller learns whether the key exists, and the deploy probe's 401 keeps
 * working.
 */
import { serve, json, readJson, routeOf, bad, HttpError } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { require as requireRole } from "_shared/roles.ts";
import { setting, SETTING_KEYS, admin } from "_shared/supabase.ts";
import { PLATFORM_SECRETS, secretOrSetting } from "_shared/secrets.ts";
import { buildAiPrompt, completeOpenRouterWithUsage } from "_shared/openrouter.ts";
import { activePrompt, loadMemories, memoryBlock, promptCatalog } from "_shared/prompts.ts";

serve(async (req) => {
  const caller = await authenticate(req);
  const { method, tail } = routeOf(req, "ai");

  // GET /ai/status
  if (method === "GET" && (tail.length === 0 || tail[0] === "status")) {
    const apiKey =
      (await secretOrSetting(PLATFORM_SECRETS.openrouter).catch(() => null)) ||
      Deno.env.get("OPENROUTER_API_KEY");
    const model =
      (await setting(SETTING_KEYS.openrouterModel).catch(() => null)) || "openrouter/free";
    const [prompts, memoryCount, evals, pinned] = await Promise.all([
      promptCatalog().catch(() => []),
      admin().from("ai_memory").select("id", { count: "exact", head: true }),
      admin().from("ai_eval_runs")
        .select("id, prompt_name, prompt_version, case_name, passed, created_at")
        .order("created_at", { ascending: false }).limit(1),
      setting("prompt_version").catch(() => null),
    ]);
    return json({
      configured: !!apiKey,
      model,
      available_modes: [
        "draft_post",
        "expand_topic",
        "feed_to_post",
        "hook_variations",
        "polish",
        "freeform",
      ],
      prompts: (prompts ?? []).map((p) => ({
        name: p.name,
        version: p.version,
        mode: p.mode,
        platform: p.platform,
        pillar: p.pillar,
        lang: p.lang,
        active: p.active,
      })),
      memories: memoryCount.count ?? 0,
      last_eval: evals.data?.[0] ?? null,
      prompt_version: pinned,
    });
  }

  // POST /ai/generate
  if (method === "POST" && (tail.length === 0 || tail[0] === "generate")) {
    const body = await readJson(req);
    const mode = (body.mode as string) || "draft_post";
    const messages = buildAiPrompt(mode, body as Record<string, unknown>);

    const want = {
      platform: typeof body.platform === "string" ? body.platform : undefined,
      pillar: typeof body.pillar === "string" ? body.pillar : undefined,
      lang: typeof body.lang === "string" ? body.lang : undefined,
    };
    const prompt = await activePrompt(mode, {
      ...want,
      pinName: typeof body.prompt_name === "string" ? body.prompt_name : undefined,
      pinVersion: typeof body.prompt_version === "number" ? body.prompt_version : undefined,
    });
    const memories = await loadMemories(want);

    if (prompt || memories.length) {
      const sys = { ...messages[0] };
      if (prompt) sys.content = prompt.body;
      const mem = memoryBlock(memories);
      if (mem) sys.content += mem;
      messages[0] = sys;
    }

    const result = await completeOpenRouterWithUsage({
      messages,
      model: typeof body.model === "string" ? body.model : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    });

    // C4: one row per generation, recorded after the answer is known. It
    // never blocks the response — if the insert fails the draft still ships,
    // and the error is visible in the function log. usage_unknown rows carry
    // null tokens; nothing here estimates a number that was not returned.
    admin().from("ai_usage").insert({
      mode,
      model: result.model,
      prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens,
      usage_unknown: result.usage_unknown,
    }).then(({ error }) => {
      if (error) console.error(`ai_usage insert failed: ${error.message}`);
    });

    return json({
      ok: true,
      mode,
      text: result.content,
      model: result.model,
      usage: {
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        usage_unknown: result.usage_unknown,
      },
      applied: {
        prompt: prompt ? `${prompt.name}@${prompt.version}` : null,
        memories: memories.length,
      },
    });
  }

  // POST /ai/memory — remember a line. content.approve (jack) on purpose:
  // this changes what EVERY future draft sees, so it is approval-level, not
  // draft-level.
  if (method === "POST" && tail[0] === "memory") {
    requireRole(caller.role, "content.approve");
    const body = await readJson(req);
    const kind = body.kind;
    if (kind !== "preference" && kind !== "hook" && kind !== "correction") {
      throw bad("kind must be preference | hook | correction");
    }
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 500) throw bad("content must be 1..500 chars");
    const weight = Number(body.weight);
    const { data, error } = await admin()
      .from("ai_memory")
      .insert({
        kind,
        content,
        pillar: typeof body.pillar === "string" ? body.pillar : null,
        platform: typeof body.platform === "string" ? body.platform : null,
        lang: body.lang === "ms" ? "ms" : "en",
        weight: Number.isFinite(weight) ? Math.min(5, Math.max(0.1, weight)) : 1,
      })
      .select("id")
      .single();
    if (error || !data) throw new HttpError(503, "upstream_failed", error?.message ?? "memory insert failed");
    return json({ ok: true, id: data.id }, 201);
  }

  return json({ error: "not_found" }, 404);
});
