-- 20261024000100_decision_defaults.sql — the two Phase 1 decisions from the
-- Decision Log (UPGRADE-PHASES.md), recorded as real rows so the Settings page
-- can change them (set_setting only allowlists keys that have a row).
--
--   1. Health stale threshold: 6 hours is the global fallback for any source
--      without its own health_stale_<source> row, and the value the dashboard's
--      "Check is stale" label shows by default. The per-source minute rows
--      (seed_health_stale) still win where they exist — they are deliberately
--      tighter for the scheduler and PC worker.
--   2. Inbox badge counts drafts: the Approval Inbox nav badge shows
--      pending + drafts when true (default per the Decision Log). The
--      dashboard reads this row and adjusts the badge.
--
-- Same pattern as 20261023000200: seed.sql holds the rows too, and
-- `on conflict do nothing` never overwrites a value Jack already changed.
insert into public.settings (key, value, description, needs_confirm) values
  ('health_stale_threshold_hours', '6', 'Decision 1 (Phase 1): global fallback hours before a health source counts as stale. Per-source health_stale_<source> rows (minutes) override this where they exist.', false),
  ('inbox_badge_counts_drafts', 'true', 'Decision 2 (Phase 1): when true the Approval Inbox nav badge counts drafts alongside pending approvals.', false)
on conflict (key) do nothing;
