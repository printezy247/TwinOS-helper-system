import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { answerCallbackQuery, call, editMessageReplyMarkup, editMessageText, pollSnapshot, sendPoll, TgError } from "./tg.ts";

// A token-shaped value would trip the CI secret grep; the client never
// validates its shape, so anything non-empty works.
Deno.env.set("TWINOS_OPS_BOT_TOKEN", "test-token-not-a-secret");

/** Count fetches and answer with the given script of responses, in order. */
function stubFetch(script: Array<{ status: number; body: unknown }>): { calls: number; bodies: string[] } {
  const state = { calls: 0, bodies: [] as string[] };
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const step = script[Math.min(state.calls, script.length - 1)];
    state.calls += 1;
    if (typeof init?.body === "string") state.bodies.push(init.body);
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

Deno.test("editMessageText: 'message is not modified' is success, not an error (a second Refresh must not post a new panel)", async () => {
  const state = stubFetch([{ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same" } }]);
  try {
    assertEquals(await editMessageText(1, 2, "same"), true);
    assertEquals(await editMessageReplyMarkup(1, 2, null), true);
  } finally {
    restore(state);
  }
});

Deno.test("sendPoll: the question, the options and an anonymous electorate, as Telegram wants them", async () => {
  const state = stubFetch([ok({ message_id: 42, poll: { id: "poll-1" } })]);
  try {
    const msg = await sendPoll(-100123, "What hurts most?", ["Entering early", "Moving stops"], {});
    assertEquals(msg.message_id, 42);
    const sent = JSON.parse(state.bodies[0]);
    assertEquals(sent.chat_id, -100123);
    assertEquals(sent.question, "What hurts most?");
    assertEquals(sent.options, [{ text: "Entering early" }, { text: "Moving stops" }],
      "Telegram wants InputPollOption objects, not bare strings");
    assertEquals(sent.is_anonymous, undefined,
      "left alone: voters stay private while the tally stays public in the channel");
    assertEquals(sent.question.length <= 300 && sent.options.length >= 2 && sent.options.length <= 10, true,
      "the shape Telegram accepts");
  } finally {
    restore(state);
  }
});

Deno.test("pollSnapshot: the tally Telegram pushes becomes a row, and anything malformed is refused", () => {
  assertEquals(pollSnapshot({
    id: "poll-123",
    question: "What hurts most?",
    total_voter_count: 87,
    is_closed: false,
    options: [
      { text: "Entering early", voter_count: 41 },
      { text: "Moving stops", voter_count: 30 },
      { text: "Overtrading", voter_count: 16 },
    ],
  }), {
    pollId: "poll-123",
    question: "What hurts most?",
    options: [
      { text: "Entering early", votes: 41 },
      { text: "Moving stops", votes: 30 },
      { text: "Overtrading", votes: 16 },
    ],
    totalVoters: 87,
    closed: false,
  });

  assertEquals(pollSnapshot(null), null, "not a poll at all");
  assertEquals(pollSnapshot({ question: "no id" }), null,
    "the id is the only thing tying a tally to the post that asked it");
  assertEquals(pollSnapshot({ id: "x", question: "q", options: "nope" })?.options, [],
    "an options field that is not a list is an empty list, not a throw");
  assertEquals(
    pollSnapshot({ id: "x", question: { text: "Nested?" }, total_voter_count: -5, options: [{ text: "a", voter_count: "7" }] }),
    { pollId: "x", question: "Nested?", options: [{ text: "a", votes: 7 }], totalVoters: 0, closed: false },
    "question arrives as an object now, and counts are whole numbers or nothing",
  );
});
