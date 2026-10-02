/**
 * Desk prompt state shared by tg-webhook and approve (plan §17 Wave 0).
 *
 * The webhook is stateless: what Jack is in the middle of lives in
 * content_items.desk_state + desk_state_at. Edit/Later prompts expire after
 * 30 minutes; fan-out kits rest in 'kit' until Jack opens them.
 */
import { shortCallback, type InlineButton } from "./tg.ts";

export const DESK_STATES = [
  "awaiting_edit",
  "awaiting_time",
  "awaiting_slot",
  "rewritten",
  "kit",
] as const;
export type DeskState = (typeof DESK_STATES)[number];

/** Edit/Later prompts expire after 30 minutes (Wave 0 fix 3). */
export const PROMPT_TTL_MS = 30 * 60 * 1000;

export function isDeskPromptExpired(at: string | null | undefined, now = Date.now()): boolean {
  if (!at) return true;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return true;
  return now - t > PROMPT_TTL_MS;
}

/**
 * Cancel button for the Edit/Later prompts. The verb is routed in
 * tg-webhook onCallback like ok/no/edit/later (Wave 0 fix 5 covers it).
 */
export function cancelKeyboard(contentId: string): InlineButton[][] {
  return [[{ text: "✖ Cancel", callback_data: shortCallback("cancel", contentId) }]];
}

/** Verbs a keyboard can emit (the part before the colon). */
export function keyboardVerbs(kb: InlineButton[][]): string[] {
  const out: string[] = [];
  for (const row of kb) {
    for (const b of row) {
      const m = /^([a-z_]{1,16}):[0-9a-f]{8}$/.exec(b.callback_data ?? "");
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

/**
 * Every callback verb a Desk keyboard can emit must have a handler in
 * tg-webhook onCallback. The test in desk_test.ts fails if a builder adds a
 * verb without one (Wave 0 fix 5). `cap` is the join-request captcha prefix,
 * handled before the verb parser.
 */
export const HANDLED_CALLBACK_VERBS = ["ok", "no", "edit", "later", "cancel", "cap"] as const;

/**
 * Contract for the tg-webhook → approve internal hop (Wave 0 fix 4).
 * approve/index.ts resolveCaller re-checks: service-role Bearer token,
 * x-twinos-internal (deriveWebhookSecret), and body.telegram.user_id as TEXT
 * against settings.jack_telegram_user_id. The 2 Oct 403 came from each side
 * looking right alone (a jsonb number vs a string); this builder keeps them
 * in step and the test pins user_id to a string.
 */
export const APPROVE_HOP_HEADERS = ["authorization", "x-twinos-internal"] as const;

export function buildApprovePayload(
  content_id: string,
  decision: "approve" | "reject" | "reschedule",
  telegramUserId: number | string,
  idempotencyKey?: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const { callback_id, ...rest } = extra;
  return {
    content_id,
    decision,
    via: "telegram",
    telegram: {
      user_id: String(telegramUserId),
      ...(callback_id !== undefined ? { callback_id } : {}),
    },
    ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
    ...rest,
  };
}
