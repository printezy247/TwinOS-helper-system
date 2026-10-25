-- 20261025000500_fk_indexes.sql — twenty foreign keys had no index whose
-- leading column is the FK's own column (A4).
--
-- What that costs, in the order it bites:
--
--   1. a cascade delete scans the whole child table for every parent row;
--   2. every join the screens do (`signal_posts` by `variant_id`, `inbox_items`
--      by `variant_id`, `clip_candidates` by `content_id`) is a sequential
--      scan the planner cannot avoid;
--   3. `… where <fk> is null` sweeps — the "unlinked" counts — are the same.
--
-- None of these tables is large yet; they are the tables that grow. That is
-- exactly when an index is cheap to add and expensive to have missed.
--
-- No skips: every one of the twenty is a join or cascade path, so all twenty
-- get the index and tests/check_fk_indexes.py's ALLOW list stays empty. A
-- future FK cannot arrive unindexed without failing CI.
--
-- `if not exists` and plain `create index` (not concurrently): this runs inside
-- the migration transaction against empty or small tables, so the lock is a
-- blink, and `concurrently` cannot run in a transaction block.

create index if not exists idx_clip_candidates_content_id on public.clip_candidates (content_id);
create index if not exists idx_clip_candidates_job_id on public.clip_candidates (job_id);

create index if not exists idx_content_items_calendar_slot_id on public.content_items (calendar_slot_id);
create index if not exists idx_content_items_icp on public.content_items (icp);
create index if not exists idx_content_items_signal_id on public.content_items (signal_id);
create index if not exists idx_content_items_template_id on public.content_items (template_id);

create index if not exists idx_csi_captures_screenshot_asset_id on public.csi_captures (screenshot_asset_id);

create index if not exists idx_exemplars_variant_id on public.exemplars (variant_id);

create index if not exists idx_inbox_items_variant_id on public.inbox_items (variant_id);

create index if not exists idx_moderation_events_rule_key on public.moderation_events (rule_key);

create index if not exists idx_poll_results_variant_id on public.poll_results (variant_id);

create index if not exists idx_queries_cluster_id on public.queries (cluster_id);
create index if not exists idx_queries_icp on public.queries (icp);

create index if not exists idx_signal_posts_content_id on public.signal_posts (content_id);
create index if not exists idx_signal_posts_outcome_id on public.signal_posts (outcome_id);
create index if not exists idx_signal_posts_variant_id on public.signal_posts (variant_id);

create index if not exists idx_tg_posts_variant_id on public.tg_posts (variant_id);

-- action_log is the one large table today (50k+ rows): this index is the
-- difference between a cascade from a deleted action and a full scan of it.
create index if not exists idx_time_saved_action_log_id on public.time_saved (action_log_id);

create index if not exists idx_topic_clusters_icp on public.topic_clusters (icp);
create index if not exists idx_topic_clusters_used_in_item_id on public.topic_clusters (used_in_item_id);
