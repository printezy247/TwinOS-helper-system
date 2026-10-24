-- 20261025000100_resolve_stale_beat_pileup.sql — one-off cleanup.
--
-- The stale-beat check in the health function inserted a new `stale_beat`
-- alert every hour and never closed any, so a source that stayed down (or
-- had long recovered) left a pile of identical open alerts. The function now
-- keeps one open alert per stale source (dedupe_key `stale_beat:<source>`)
-- and closes it on recovery. This closes the old pile; the next check raises
-- a single proper alert for any source that is still stale.
update public.alerts
set resolved_at = now()
where
  kind = 'stale_beat'
  and resolved_at is null
  and dedupe_key is null;
