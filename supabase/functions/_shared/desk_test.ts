import { assert, assertEquals } from "std/assert/mod.ts";
import {
  APPROVE_HOP_HEADERS,
  buildApprovePayload,
  cancelKeyboard,
  DESK_STATES,
  HANDLED_CALLBACK_VERBS,
  isDeskPromptExpired,
  keyboardVerbs,
  PROMPT_TTL_MS,
} from "./desk.ts";
import { approvalKeyboard, editKeyboard, laterKeyboard, menuKeyboard, shortCallback } from "./tg.ts";

const ID = "6f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8";

Deno.test("desk states allow fan-out kits and the slot wait (Wave 0 fix 1)", () => {
  assert((DESK_STATES as readonly string[]).includes("kit"), "kit missing");
  assert((DESK_STATES as readonly string[]).includes("awaiting_slot"), "awaiting_slot missing");
  assert((DESK_STATES as readonly string[]).includes("awaiting_edit"));
  assert((DESK_STATES as readonly string[]).includes("awaiting_time"));
});

Deno.test("edit/later prompts expire after 30 minutes (Wave 0 fix 3)", () => {
  assertEquals(PROMPT_TTL_MS, 30 * 60 * 1000);
  const now = Date.now();
  assertEquals(isDeskPromptExpired(new Date(now - 29 * 60_000).toISOString(), now), false);
  assertEquals(isDeskPromptExpired(new Date(now - 31 * 60_000).toISOString(), now), true);
  assertEquals(isDeskPromptExpired(null, now), true);
});

Deno.test("edit/later prompts carry a Cancel button under 64 bytes (Wave 0 fix 3)", () => {
  const kb = cancelKeyboard(ID);
  const verbs = keyboardVerbs(kb);
  assert(verbs.includes("cancel"), `no cancel verb in ${JSON.stringify(kb)}`);
  for (const row of kb) {
    for (const b of row) {
      assert(
        new TextEncoder().encode(b.callback_data ?? "").length <= 64,
        `callback over 64 bytes: ${b.callback_data}`,
      );
    }
  }
});

Deno.test("dead buttons: every emitted callback verb has a handler (Wave 0 fix 5)", () => {
  const emitted = new Set([
    ...keyboardVerbs(approvalKeyboard(ID)),
    ...keyboardVerbs(cancelKeyboard(ID)),
    ...keyboardVerbs(menuKeyboard()),
    ...keyboardVerbs(laterKeyboard(ID)),
    ...keyboardVerbs(editKeyboard(ID)),
    ...keyboardVerbs([[{ text: "x", callback_data: shortCallback("fan", ID) }]]),
    ...keyboardVerbs([[{ text: "x", callback_data: `mo:ban:${ID.replace(/-/g, "").slice(0, 8)}` }]]),
  ]);
  const missing = [...emitted].filter((v) => !(HANDLED_CALLBACK_VERBS as readonly string[]).includes(v));
  assertEquals(missing, [], `unhandled callback verbs: ${missing.join(", ")}`);
});

Deno.test("contract: the tg-webhook approve hop matches what approve re-checks (Wave 0 fix 4)", () => {
  // approve/index.ts resolveCaller needs: service Bearer + x-twinos-internal
  // (deriveWebhookSecret) + body.telegram.user_id compared as text to
  // settings.jack_telegram_user_id (the 2 Oct 403: number vs string).
  assert((APPROVE_HOP_HEADERS as readonly string[]).includes("authorization"));
  assert((APPROVE_HOP_HEADERS as readonly string[]).includes("x-twinos-internal"));
  const payload = buildApprovePayload(ID, "approve", 6282941580, "cb:abc123");
  assertEquals(typeof (payload.telegram as { user_id: string }).user_id, "string");
  assertEquals((payload.telegram as { user_id: string }).user_id, "6282941580");
});
