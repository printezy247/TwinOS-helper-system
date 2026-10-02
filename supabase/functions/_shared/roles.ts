/**
 * Who may call what (plan §11, §4.9, §9.N).
 *
 * The one rule that matters most: `content.approve` is Jack only. ABDUL has no
 * approve verb; the dashboard inherits the login's role, so a dashboard session
 * can approve only when it is Jack's login.
 */
import { HttpError } from "./http.ts";

export type Role =
  | "jack" // Jack's login (JWT claim) or Jack's Telegram id via the ops bot
  | "abdul" // ABDUL's scoped key
  | "ops_bot" // the tg-webhook function acting for the bot
  | "pc_worker" // scoped key on Jack's PC
  | "ezyai" // scoped key held by the EzyAi bot on its host
  | "tradingview" // tv-webhook secret
  | "cron" // pg_cron / scheduler invocations (service role + x-twinos-actor: cron)
  | "dashboard" // any other logged-in dashboard user (read-mostly)
  | "viewer";

export type Action =
  | "desk.input"
  | "content.draft"
  | "content.request_approval"
  | "content.approve"
  | "content.remind"
  | "content.batch"
  | "metrics.poll"
  | "content.schedule"
  | "content.schedule_claim" // schedule a post that carries a claim flag
  | "publish.run"
  | "signals.ingest"
  | "tv.alert"
  | "results.reply"
  | "assets.ingest"
  | "links.create"
  | "metrics.manual"
  | "imports.telechurn"
  | "reports.read"
  | "health.beat"
  | "research.csi"
  | "research.brief"
  | "research.run"
  | "jobs.claim"
  | "jobs.result"
  | "jobs.enqueue";

const ALL: Role[] = [
  "jack",
  "abdul",
  "ops_bot",
  "pc_worker",
  "ezyai",
  "tradingview",
  "cron",
  "dashboard",
  "viewer",
];

/** Table from plan §11, one row per endpoint. */
export const PERMISSIONS: Record<Action, readonly Role[]> = {
  "desk.input": ["ops_bot", "jack"],
  "content.draft": ["jack", "abdul", "cron", "ops_bot"],
  "content.request_approval": ["jack", "abdul", "cron", "ops_bot"],
  "content.approve": ["jack"],
  "content.remind": ["jack", "abdul", "cron", "ops_bot"],
  "content.batch": ["jack", "abdul", "cron"],
  "metrics.poll": ["jack", "abdul", "cron"],
  "content.schedule": ["jack", "abdul", "cron"],
  "content.schedule_claim": ["jack"],
  "publish.run": ["cron", "jack"],
  "signals.ingest": ["ezyai"],
  "tv.alert": ["tradingview"],
  "results.reply": ["abdul", "cron", "ezyai", "jack"],
  "assets.ingest": ["pc_worker", "jack"],
  "links.create": ["jack", "abdul"],
  "metrics.manual": ["jack", "abdul"],
  "imports.telechurn": ["jack", "pc_worker"],
  "reports.read": ALL,
  "health.beat": ["ezyai", "ops_bot", "pc_worker", "cron", "abdul", "jack"],
  "research.csi": ["jack", "abdul"],
  "research.brief": ["jack", "abdul", "pc_worker"],
  "research.run": ["jack", "abdul", "cron"],
  "jobs.claim": ["pc_worker"],
  "jobs.result": ["pc_worker"],
  "jobs.enqueue": ["jack", "abdul", "cron"],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export function require(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new HttpError(403, "forbidden", `${role} may not ${action}`, { action, role });
  }
}

/** Roles that get an API key (never a password). Jack and the dashboard log in. */
export const KEY_ROLES: readonly Role[] = ["abdul", "pc_worker", "ezyai"];
