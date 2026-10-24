/**
 * The beat sources the health board watches, and how many minutes of silence
 * make each one stale. Only sources that really report belong here: ezyai and
 * sales_bot were removed because the only "ok" they ever sent was a made-up
 * cron heartbeat. Add one back when the real thing can beat for itself.
 */
export const HEALTH_SOURCES = ["ops_bot", "scheduler", "pc_worker", "poller", "abdul"] as const;

export const STALE_DEFAULT_MIN: Record<string, number> = {
  ops_bot: 24 * 60,
  scheduler: 5,
  pc_worker: 20,
  poller: 30,
  abdul: 24 * 60,
};
