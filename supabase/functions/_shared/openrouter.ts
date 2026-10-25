import { HttpError } from "./http.ts";
import { setting, SETTING_KEYS } from "./supabase.ts";
import { PLATFORM_SECRETS, secretOrSetting } from "./secrets.ts";
import { jitteredBackoff } from "./backoff.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * The three numbers a hung provider turns on, in one place so a test can move
 * them without a second code path. Production never changes them.
 *
 *   timeoutMs    a request that has not answered by now is dead (§A1)
 *   maxRetries   one retry, only for 429/5xx. A 400 can never be fixed by
 *                asking again, and every retry costs a token spend
 *   retryDelayMs the publisher's existing full-jitter policy, reused — not a
 *                second retry loop with its own idea of how long to wait
 */
export const OpenRouterLimits = {
  timeoutMs: 20_000,
  maxRetries: 1,
  retryDelayMs: (attempt: number) => jitteredBackoff(attempt),
};

/** A timeout or abort is a 504 naming the wall clock, never a bare DOMException. */
function timeoutError(err: unknown, ms: number): HttpError | null {
  const name = (err as { name?: string } | null)?.name;
  if (name !== "TimeoutError" && name !== "AbortError") return null;
  return new HttpError(504, "upstream_timeout", `OpenRouter did not answer within ${ms} ms`);
}

/** 429 and 5xx can clear on their own; everything else is the caller's answer. */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterOptions {
  messages: OpenRouterMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export async function completeOpenRouter(opts: OpenRouterOptions): Promise<string> {
  // A3: Vault first, the legacy settings row second, the function secret last.
  const apiKey =
    (await secretOrSetting(PLATFORM_SECRETS.openrouter).catch(() => null)) ||
    Deno.env.get("OPENROUTER_API_KEY");

  if (!apiKey) {
    throw new HttpError(
      400,
      "missing_openrouter_key",
      "OpenRouter API key not configured yet. Set TWINOS_OPENROUTER_API_KEY in secrets or Settings.",
    );
  }

  const defaultModel =
    (await setting(SETTING_KEYS.openrouterModel).catch(() => null)) || "openrouter/free";
  const model = opts.model || defaultModel;

  const timeoutMs = OpenRouterLimits.timeoutMs;
  const send = () =>
    fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://twin-approval-hub.lovable.app",
        "X-Title": "TwinOS",
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 1200,
      }),
      // Without this a provider that accepts the socket and never answers
      // holds the edge function until the platform's own limit kills it, and
      // the caller sees a generic timeout with no idea which side stalled.
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res: Response;
  for (let attempt = 0;; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, OpenRouterLimits.retryDelayMs(attempt)));
    }
    try {
      res = await send();
    } catch (err) {
      const timeout = timeoutError(err, timeoutMs);
      if (timeout) throw timeout;
      throw err;
    }
    if (res.ok) break;
    // Drain the refusal before deciding, so a retried connection is free.
    const errText = await res.text().catch(() => "");
    if (!retryable(res.status) || attempt >= OpenRouterLimits.maxRetries) {
      throw new HttpError(res.status, "openrouter_failed", `OpenRouter API error: ${errText}`);
    }
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Pre-built prompts for TwinOS workflows */
export function buildAiPrompt(mode: string, params: Record<string, unknown>): OpenRouterMessage[] {
  const system =
    "You are the TwinOS AI Assistant for EzyMap, a premier gold & forex trading community. Write concise, engaging, high-converting, professional trading content. Strictly adhere to compliance: no guaranteed returns, include risk awareness, 1 call to action.";

  if (mode === "draft_post") {
    const topic = (params.topic as string) || "Gold Price Action Update";
    const pillar = (params.pillar as string) || "lesson";
    const platform = (params.platform as string) || "telegram";
    const tone = (params.tone as string) || "educational and actionable";
    const extra = (params.notes as string) || "";

    const user = `Draft a ready-to-publish ${platform} post for EzyMap.
Topic: ${topic}
Content Pillar: ${pillar}
Tone: ${tone}
${extra ? `Additional notes: ${extra}` : ""}

Structure:
1. Hook (bold, attention-grabbing, no fluff)
2. Core Insight (clear market logic / trading tip)
3. Actionable Takeaway
4. Clean CTA to join or learn more
5. Relevant hashtags if platform supports (e.g. #XAUUSD #GoldTrading #EzyMap)`;

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  if (mode === "expand_topic") {
    const topic = (params.topic as string) || "";
    const pillar = (params.pillar as string) || "";

    const user = `Expand this research topic into 3 specific content angles with target reader persona and key hooks:
Topic: ${topic}
${pillar ? `Pillar: ${pillar}` : ""}

Provide:
1. Angle 1 (Beginner friendly)
2. Angle 2 (Advanced / Institutional mechanics)
3. Angle 3 (Psychology & Risk Management)
Each with a 1-sentence hook and suggested post format.`;

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  if (mode === "feed_to_post") {
    const title = (params.title as string) || "";
    const summary = (params.summary as string) || "";
    const source = (params.source as string) || "";

    const user = `Transform this market news item into a compelling EzyMap market insight post:
Source: ${source}
Headline: ${title}
Summary: ${summary}

Provide:
1. Impact on Gold / USD / Forex
2. How traders should approach this (key level watch / volatility warning)
3. Closing thought`;

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  if (mode === "hook_variations") {
    const current = (params.current as string) || "";
    const topic = (params.topic as string) || "";

    const user = `Generate 3 high-retention opening hooks for a post about: "${topic || current}".
Hook 1: Direct question that exposes a common mistake.
Hook 2: Contrarian statement / bold market insight.
Hook 3: Step-by-step or "How to" framework.`;

    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  if (mode === "polish") {
    const text = (params.text as string) || "";
    const user = `Polish and format this post for Telegram / social media. Make it punchier, improve formatting with bolding and bullet points, remove passive voice, and ensure compliance:\n\n${text}`;
    return [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
  }

  // fallback freeform
  return [
    { role: "system", content: (params.system as string) || system },
    { role: "user", content: (params.prompt as string) || "" },
  ];
}
