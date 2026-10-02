import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { answerCallbackQuery, call, TgError } from "./tg.ts";

// A token-shaped value would trip the CI secret grep; the client never
// validates its shape, so anything non-empty works.
Deno.env.set("TWINOS_OPS_BOT_TOKEN", "test-token-not-a-secret");

/** Count fetches and answer with the given script of responses, in order. */
function stubFetch(script: Array<{ status: number; body: unknown }>): { calls: number } {
  const state = { calls: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request) => {
    const step = script[Math.min(state.calls, script.length - 1)];
    state.calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify(step.body), {
        status: step.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  // The test restores fetch itself; keep a handle for the finally block.
  (state as unknown as { restore: () => void }).restore = () => {
    globalThis.fetch = original;
  };
  return state;
}

function restore(state: { calls: number }) {
  (state as unknown as { restore?: () => void }).restore?.();
}

const ok = (result: unknown) => ({ status: 200, body: { ok: true, result } });
const throttled = (retry_after = 0) => ({
  status: 429,
  body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after } },
});

Deno.test("a forced 429 is retried once, then the same send succeeds", async () => {
  const state = stubFetch([throttled(), ok({ message_id: 7 })]);
  try {
    const msg = await call<{ message_id: number }>("sendMessage", { chat_id: 1, text: "x" });
    assertEquals(msg.message_id, 7);
    assertEquals(state.calls, 2, "one retry, not a second logical send");
  } finally {
    restore(state);
  }
});

Deno.test("429 every time throws after RETRY_LIMIT, so the publisher backs off", async () => {
  const state = stubFetch([throttled()]);
  try {
    const err = await assertRejects(() => call("sendMessage", { chat_id: 1, text: "x" })) as TgError;
    assertEquals(err instanceof TgError, true);
    assertEquals(err.code, 429);
    // 1 initial attempt + 3 retries
    assertEquals(state.calls, 4);
  } finally {
    restore(state);
  }
});

Deno.test("a permanent error (403) is not retried at all", async () => {
  const state = stubFetch([
    { status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked" } },
  ]);
  try {
    await assertRejects(() => call("sendMessage", { chat_id: 1, text: "x" }), TgError);
    assertEquals(state.calls, 1, "a 403 must fail the job, not be retried");
  } finally {
    restore(state);
  }
});

Deno.test("answerCallbackQuery: an expired or unknown query id is not fatal (the tap's decision must still run)", async () => {
  const state = stubFetch([{ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: query is too old and response timeout expired or query ID is invalid" } }]);
  try {
    assertEquals(await answerCallbackQuery("expired-id", "Rejected."), false);
  } finally {
    restore(state);
  }
});

Deno.test("answerCallbackQuery: a good answer is true", async () => {
  const state = stubFetch([ok(true)]);
  try {
    assertEquals(await answerCallbackQuery("live-id"), true);
  } finally {
    restore(state);
  }
});
