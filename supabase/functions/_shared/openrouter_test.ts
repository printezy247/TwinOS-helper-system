import { assertEquals, assertRejects } from "std/assert/mod.ts";
import {
  completeOpenRouter,
  completeOpenRouterWithUsage,
  OpenRouterLimits,
} from "./openrouter.ts";
import { HttpError } from "./http.ts";

/**
 * A1: a hung OpenRouter call must not hang the caller forever.
 *
 * Three shapes, in the order they bite in production:
 *   T1 the provider accepts the request and never answers
 *   T2 the provider returns 429 and then answers
 *   T3 the provider returns 400 — a retry cannot help, so there must not be one
 *
 * `setting()` reads `settings` through the service client; an empty
 * SUPABASE_URL makes that read throw immediately (caught, value null), so the
 * key comes from the env fallback and no test touches the network by accident.
 */

const KEY_ENV = "TWINOS_OPENROUTER_API_KEY";

function useTestKey(): () => void {
  const before = {
    url: Deno.env.get("SUPABASE_URL"),
    key: Deno.env.get(KEY_ENV),
  };
  Deno.env.set("SUPABASE_URL", "");
  Deno.env.set(KEY_ENV, "twk_openrouter_" + "0".repeat(40));
  return () => {
    for (const [name, value] of [
      ["SUPABASE_URL", before.url],
      [KEY_ENV, before.key],
    ] as const) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  };
}

/** A fetch that behaves like the real one: it rejects when the signal aborts. */
function hangingFetch(calls: { n: number }) {
  return (_input: string | URL | Request, init?: RequestInit) => {
    calls.n += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // never settles — exactly the bug
      signal.addEventListener("abort", () => {
        const err = new Error("The signal has been aborted.");
        err.name = "TimeoutError";
        reject(err);
      });
    });
  };
}

/** Answers by index: 429 then a valid body, or a single fixed response. */
function scriptedFetch(responses: Array<Response | "hang">, calls: { n: number }) {
  return (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const step = responses[Math.min(calls.n, responses.length - 1)];
      calls.n += 1;
      if (step === "hang") {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The signal has been aborted.");
          err.name = "TimeoutError";
          reject(err);
        });
        return;
      }
      resolve(step.clone());
    });
}

const body = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const prompt = { messages: [{ role: "user" as const, content: "hi" }] };

Deno.test("T1 a provider that never answers times out instead of hanging", async () => {
  const restore = useTestKey();
  const original = globalThis.fetch;
  const calls = { n: 0 };
  // @ts-ignore — the stub is narrower than fetch, which is the point
  globalThis.fetch = hangingFetch(calls);
  const started = Date.now();
  try {
    const err = await assertRejects(() => completeOpenRouter(prompt), HttpError);
    const code = (err as HttpError).code;
    assertEquals(code, "upstream_timeout");
    const elapsed = Date.now() - started;
    assertEquals(elapsed < 21_000, true, `took ${elapsed} ms, longer than the 20 s budget`);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

Deno.test("T2 a 429 is retried exactly once and the second answer is returned", async () => {
  const restore = useTestKey();
  const original = globalThis.fetch;
  const savedDelay = OpenRouterLimits.retryDelayMs;
  const savedTimeout = OpenRouterLimits.timeoutMs;
  const calls = { n: 0 };
  OpenRouterLimits.retryDelayMs = () => 0;
  OpenRouterLimits.timeoutMs = 1_000;
  globalThis.fetch = scriptedFetch(
    [new Response("rate limited", { status: 429 }), body("trade the plan")],
    calls,
  ) as typeof fetch;
  try {
    const text = await completeOpenRouter(prompt);
    assertEquals(text, "trade the plan");
    assertEquals(calls.n, 2);
  } finally {
    globalThis.fetch = original;
    OpenRouterLimits.retryDelayMs = savedDelay;
    OpenRouterLimits.timeoutMs = savedTimeout;
    restore();
  }
});

/** The same body plus what OpenRouter charges for it (C4). */
const bodyUsage = (
  text: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  model: string | undefined,
) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      ...(usage ? { usage } : {}),
      ...(model ? { model } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

async function withStubbedFetch<T>(
  responses: Array<Response | "hang">,
  fn: (calls: { n: number }) => Promise<T>,
): Promise<T> {
  const restore = useTestKey();
  const original = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = scriptedFetch(responses, calls) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
    restore();
  }
}

Deno.test("T4 usage in the answer is parsed exactly, never invented", async () => {
  const result = await withStubbedFetch(
    [bodyUsage("gold plan", { prompt_tokens: 120, completion_tokens: 48 }, "deepseek/deepseek-v3")],
    () => completeOpenRouterWithUsage(prompt),
  );
  assertEquals(result.content, "gold plan");
  assertEquals(result.model, "deepseek/deepseek-v3");
  assertEquals(result.prompt_tokens, 120);
  assertEquals(result.completion_tokens, 48);
  assertEquals(result.usage_unknown, false);
});

Deno.test("T5 a missing usage block yields nulls and usage_unknown, not a guess", async () => {
  const result = await withStubbedFetch(
    [bodyUsage("gold plan", undefined, undefined)],
    () => completeOpenRouterWithUsage(prompt),
  );
  assertEquals(result.content, "gold plan");
  assertEquals(result.prompt_tokens, null);
  assertEquals(result.completion_tokens, null);
  assertEquals(result.usage_unknown, true);
  // model falls back to whatever was requested, it is never left empty
  assertEquals(typeof result.model, "string");
  assertEquals(result.model.length > 0, true);
});

Deno.test("T3 a 400 is not retried: one call and the error surfaces", async () => {
  const restore = useTestKey();
  const original = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = scriptedFetch(
    [new Response("bad model", { status: 400 })],
    calls,
  ) as typeof fetch;
  try {
    const err = await assertRejects(() => completeOpenRouter(prompt), HttpError);
    assertEquals((err as HttpError).status, 400);
    assertEquals(calls.n, 1);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});
