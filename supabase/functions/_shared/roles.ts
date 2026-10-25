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
  | "sales_bot" // scoped key for @EzyRegisterBot, wherever it is hosted
  | "tradingview" // tv-webhook secret
  | "cron" // pg_cron / scheduler invocations (service role + x-twinos-actor: cron)
  | "dashboard" // any other logged-in dashboard user (read-mostly)
  | "viewer"
  | "partner"; // partner API key (Phase 7): reads reports, drafts posts — never approve

export type Action =
  | "desk.input"
  | "content.draft"
  | "content.request_approval"
  | "content.approve"
  | "content.cancel" // unschedule; the inverse of scheduling, so same people
  | "content.edit" // change a variant's copy after it exists
  | "content.remind"
  | "content.batch"
  | "metrics.poll"
  | "content.schedule"
  | "content.schedule_claim" // schedule a post that carries a claim flag
  | "content.template_variant" // give one platform its own wording for a post type
  | "content.fanout_drain" // cron works the fan-out retry queue
  | "publish.run"
  | "tv.alert"
  | "results.reply"
  | "assets.ingest"
  | "links.create"
  | "metrics.manual"
  | "imports.telechurn"
  | "reports.read"
  | "webhooks.manage" // register/remove outbound webhook endpoints (Phase 7)
  | "webhooks.dispatch" // run the delivery loop; cron does this every minute
  | "keys.manage" // mint/revoke API keys from the dashboard (Phase 7): credentials, Jack alone
  | "health.beat"
  | "research.csi"
  | "research.brief"
  | "research.read" // read-only research pages (Ideas); not the triggers below
  | "research.run"
  | "jobs.claim"
  | "jobs.result"
  | "jobs.enqueue"
  | "hook.promote"; // E2: swap the promoted (incumbent) hook; Jack approves, never automatic

const ALL: Role[] = [
  "jack",
  "abdul",
  "ops_bot",
  "pc_worker",
  "sales_bot",
  "tradingview",
  "cron",
  "dashboard",
  "viewer",
  "partner",
];

/** Table from plan §11, one row per endpoint. */
export const PERMISSIONS: Record<Action, readonly Role[]> = {
  "desk.input": ["ops_bot", "jack"],
  // Partner keys draft for review (Phase 7 write:posts): a draft still has to
  // pass the approval gate, so the worst a leaked partner key does is litter drafts.
  "content.draft": ["jack", "abdul", "cron", "ops_bot", "partner"],
  "content.request_approval": ["jack", "abdul", "cron", "ops_bot"],
  "content.approve": ["jack"],
  // Jack only, and not because cancel and edit are "just" undo. Both reach a
  // post that is already on its way out: cancelling pulls work out of the
  // publish queue, and editing replaces copy that may have been approved. The
  // approval gate is the whole point of the system, so the two ways around it
  // belong to the same single person as the gate itself.
  "content.cancel": ["jack"],
  "content.edit": ["jack"],
  "content.remind": ["jack", "abdul", "cron", "ops_bot"],
  "content.batch": ["jack", "abdul", "cron"],
  "metrics.poll": ["jack", "abdul", "cron"],
  "content.schedule": ["jack", "abdul", "cron"],
  "content.fanout_drain": ["cron", "jack"],
  "content.schedule_claim": ["jack"],
  // Jack only, and not a subset of content.draft: a template variant is a
  // *default*, so every later draft from that post type on that platform
  // inherits whatever is written here. Drafting is per-draft and reversible;
  // this is not.
  "content.template_variant": ["jack"],
  "publish.run": ["cron", "jack"],
  "tv.alert": ["tradingview"],
  "results.reply": ["abdul", "cron", "jack"],
  "assets.ingest": ["pc_worker", "jack"],
  "links.create": ["jack", "abdul"],
  "metrics.manual": ["jack", "abdul"],
  "imports.telechurn": ["jack", "pc_worker"],
  "reports.read": ALL,
  // The registry stores per-endpoint signing secrets, so it is Jack alone —
  // same shape as content.approve: the thing being guarded is a credential.
  "webhooks.manage": ["jack"],
  "webhooks.dispatch": ["cron", "jack"],
  // Minting an API key hands out a credential, so the dashboard's key routes
  // are Jack alone — the same shape as content.approve and webhooks.manage.
  "keys.manage": ["jack"],
  // sales_bot is here because the health board watches it and it could never
  // report: there was no such role, so no key could ever carry one. It gets
  // nothing else — least privilege until it has a job to do here.
  "health.beat": ["sales_bot", "ops_bot", "pc_worker", "cron", "abdul", "jack"],
  "research.csi": ["jack", "abdul"],
  "research.brief": ["jack", "abdul", "pc_worker"],
  // Read-only research pages. Separate from research.run, which polls feeds and
  // drains the retag backlog — those are triggers that cost work, and the
  // dashboard has no business firing them. Ideas is a select, so it gets the
  // read permission and every role can see it.
  "research.read": ALL,
  "research.run": ["jack", "abdul", "cron"],
  "jobs.claim": ["pc_worker"],
  "jobs.result": ["pc_worker"],
  "jobs.enqueue": ["jack", "abdul", "cron"],
  // E2: the wrong hook costs reach, so promotion is a proposal Jack approves —
  // same single-person shape as content.approve.
  "hook.promote": ["jack"],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export function require(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new HttpError(403, "forbidden", `${role} may not ${action}`, { action, role });
  }
}
