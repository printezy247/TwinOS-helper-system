/**
 * Reads the alerts EzyMap_Pro_V3_3.pine sends with "Alert Payload = JSON".
 * The indicator names things its own way (setup_id, direction BUY/SELL, one
 * `tp`, `action` for the event), so tv-webhook translates them instead of
 * treating every message as a brand-new signal:
 *
 *   live         → one signal + one Desk card per setup_id
 *   tp / sl / be → status update on that same signal (no new card)
 *   ready / expired / anything else → acknowledged, ignored
 */
import type { SignalInput } from "./signals.ts";

export type PineEvent =
  | { kind: "ignore"; reason: string }
  | { kind: "signal"; entry: Partial<SignalInput> & { external_id: string }; counterTrend: boolean }
  | { kind: "result"; entry: Partial<SignalInput> & { external_id: string } };

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const RESULT_STATUS: Record<string, "tp" | "sl" | "be"> = { tp: "tp", sl: "sl", be: "be" };

/** `null` when the payload is not from the EzyMap indicator (no action + setup_id). */
export function adaptEzyMapAlert(alert: Record<string, unknown>): PineEvent | null {
  const action = alert.action;
  const setupId = alert.setup_id;
  if (typeof action !== "string" || typeof setupId !== "string" || !setupId.trim()) return null;

  const external_id = setupId.trim().slice(0, 120);
  const side = String(alert.direction ?? "").toLowerCase();
  const direction = side === "buy" ? "buy" : side === "sell" ? "sell" : undefined;
  const symbol = typeof alert.symbol === "string" ? alert.symbol.toUpperCase().slice(0, 20) : undefined;
  const timeframe = typeof alert.tf === "string" || typeof alert.tf === "number" ? String(alert.tf).slice(0, 20) : undefined;

  if (action === "live") {
    const entry = num(alert.entry);
    const counterTrend = alert.countertrend === true;
    return {
      kind: "signal",
      counterTrend,
      entry: {
        external_id, symbol, direction, timeframe,
        entry_low: entry, entry_high: entry,
        stop_price: num(alert.sl), tp1: num(alert.tp), rr: num(alert.rr),
        setup: typeof alert.setup_type === "string" ? alert.setup_type : undefined,
        setup_score: num(alert.confluences),
        status: "running",
        counter_trend: counterTrend,
        raw: alert,
      },
    };
  }

  const status = RESULT_STATUS[action];
  if (status) {
    return {
      kind: "result",
      entry: { external_id, symbol, direction, timeframe, status, result_pips: num(alert.pips), raw: alert },
    };
  }

  return { kind: "ignore", reason: action === "ready" || action === "expired" ? `${action} is a watch message, not a trade` : `unknown action "${action}"` };
}

/** The indicator's plain-text alertcondition() messages must not become signals. */
export function isEzyMapPlainText(text: string): boolean {
  return /EZYMAP TRADE ALERT/i.test(text);
}
