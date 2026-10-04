/**
 * Signal upsert shared by signals-ingest (EzyAi) and tv-webhook (TradingView):
 * a merge keyed on `external_id` (ported from printezy's pushSignal contract).
 * Absent fields keep their current values, so open / tick / close are the
 * same call and a retry is harmless.
 */
import { admin } from "./supabase.ts";

export const STATUSES = ["pending", "running", "tp", "tp1", "tp2", "be", "sl", "cancelled"] as const;
export const DIRECTIONS = ["buy", "sell"] as const;
export type SignalStatus = (typeof STATUSES)[number];

export interface SignalInput {
  external_id: string;
  source: "ezyai" | "tradingview";
  symbol?: string;
  direction?: "buy" | "sell";
  entry_low?: number;
  entry_high?: number;
  stop_price?: number;
  tp1?: number;
  tp2?: number;
  rr?: number;
  setup?: string;
  setup_score?: number;
  timeframe?: string;
  status?: SignalStatus;
  counter_trend?: boolean;
  current_price?: number;
  result_r?: number;
  result_pips?: number;
  quality?: string; // EzyAi quality.may_emit: "live" | "demo" | "shadow"
  opened_at?: string;
  closed_at?: string;
  raw?: Record<string, unknown>;
}

export interface RowResult {
  ok: boolean;
  external_id?: string;
  id?: string;
  error?: string;
  created?: boolean;
  status_changed?: { from: string | null; to: string } | null;
}

const NUM_FIELDS = ["entry_low", "entry_high", "stop_price", "tp1", "tp2", "rr", "setup_score", "current_price", "result_r", "result_pips"] as const;

/** Validate one row (the three hard rejects from printezy + numeric sanity). */
export function validate(entry: Record<string, unknown>): { ok: true; value: Partial<SignalInput> } | { ok: false; error: string } {
  const external_id = entry.external_id;
  if (typeof external_id !== "string" || !external_id.trim() || external_id.length > 120) {
    return { ok: false, error: "external_id is required" };
  }
  const status = entry.status;
  if (status !== undefined && status !== null && !STATUSES.includes(status as SignalStatus)) {
    return { ok: false, error: `status must be one of ${STATUSES.join(", ")}` };
  }
  const direction = entry.direction;
  if (direction !== undefined && direction !== null && !DIRECTIONS.includes(direction as "buy" | "sell")) {
    return { ok: false, error: `direction must be one of ${DIRECTIONS.join(", ")}` };
  }
  const value: Record<string, unknown> = { external_id: external_id.trim() };
  for (const k of NUM_FIELDS) {
    const v = entry[k];
    if (v === undefined || v === null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `${k} must be a number` };
    value[k] = n;
  }
  for (const k of ["symbol", "setup", "timeframe", "quality", "opened_at", "closed_at"] as const) {
    if (typeof entry[k] === "string") value[k] = (entry[k] as string).slice(0, 120);
  }
  if (status) value.status = status;
  if (direction) value.direction = direction;
  if (typeof entry.counter_trend === "boolean") value.counter_trend = entry.counter_trend;
  if (entry.raw && typeof entry.raw === "object") value.raw = entry.raw;
  return { ok: true, value: value as Partial<SignalInput> };
}

/** Merge into `signals`; append a `signal_outcomes` row when status changes. */
export async function upsertSignal(input: Partial<SignalInput> & { external_id: string; source: SignalInput["source"] }): Promise<RowResult> {
  const db = admin();
  const { data: existing, error: e0 } = await db
    .from("signals").select("id, status").eq("external_id", input.external_id).maybeSingle();
  if (e0) return { ok: false, external_id: input.external_id, error: e0.message };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updated_at: now };
  // Write both vocabularies explicitly. The bridge trigger copies quality →
  // data_source, but the column default ('live') fills data_source BEFORE any
  // BEFORE trigger runs, so the copy never fired on insert and every demo
  // signal was stored as data_source='live' — publicly board-visible.
  if (typeof input.quality === "string") patch.data_source = input.quality;
  if (!existing) {
    patch.status = input.status ?? "pending";
    patch.opened_at = input.opened_at ?? now;
  }
  if (input.status && ["tp", "tp1", "tp2", "be", "sl", "cancelled"].includes(input.status) && !input.closed_at && !existing?.status?.match(/tp|be|sl|cancelled/)) {
    patch.closed_at = now;
  }

  const { data, error } = await db
    .from("signals")
    .upsert(patch, { onConflict: "external_id" })
    .select("id, status")
    .single();
  if (error || !data) return { ok: false, external_id: input.external_id, error: error?.message ?? "upsert failed" };

  const from = existing?.status ?? null;
  const statusChanged = input.status && input.status !== from ? { from, to: input.status } : null;
  if (statusChanged) {
    await db.from("signal_outcomes").insert({
      signal_id: data.id, status: input.status, result_r: input.result_r ?? null,
      result_pips: input.result_pips ?? null, raw: input.raw ?? null, at: now,
    });
  }
  return { ok: true, external_id: input.external_id, id: data.id, created: !existing, status_changed: statusChanged };
}
