/**
 * ai — OpenRouter LLM generation endpoint for TwinOS.
 *
 *   POST /ai/generate  { mode?, prompt?, topic?, pillar?, platform?, tone?, text?, model? }
 *   GET  /ai/status    → { configured: boolean, model: string }
 */
import { serve, json, readJson, routeOf } from "_shared/http.ts";
import { authenticate } from "_shared/auth.ts";
import { setting, SETTING_KEYS } from "_shared/supabase.ts";
import { completeOpenRouter, buildAiPrompt } from "_shared/openrouter.ts";

serve(async (req) => {
  const { method, tail } = routeOf(req, "ai");

  // GET /ai/status
  if (method === "GET" && (tail.length === 0 || tail[0] === "status")) {
    const apiKey =
      (await setting(SETTING_KEYS.openrouterApiKey).catch(() => null)) ||
      Deno.env.get("TWINOS_OPENROUTER_API_KEY") ||
      Deno.env.get("OPENROUTER_API_KEY");
    const model =
      (await setting(SETTING_KEYS.openrouterModel).catch(() => null)) || "openrouter/free";
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
    });
  }

  // POST /ai/generate
  if (method === "POST" && (tail.length === 0 || tail[0] === "generate")) {
    await authenticate(req); // verify authenticated token
    const body = await readJson(req);
    const mode = (body.mode as string) || "draft_post";
    const messages = buildAiPrompt(mode, body as Record<string, unknown>);
    const text = await completeOpenRouter({
      messages,
      model: typeof body.model === "string" ? body.model : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    });

    return json({
      ok: true,
      mode,
      text,
    });
  }

  return json({ error: "not_found" }, 404);
});
