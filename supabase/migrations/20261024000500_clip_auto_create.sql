-- 20261024000500_clip_auto_create.sql — Decision 4 (UPGRADE-PHASES Phase 6):
-- queue a clip scan when a map_recap or lesson publishes.
--
-- The heavy half already exists and lives elsewhere: the PC worker's
-- `clip_candidates` job finds the day's recording, cuts candidate windows and
-- returns them; the jobs result handler lands each moment in
-- `clip_candidates`; the Desk gets Use/Drop buttons per moment and nothing is
-- cut before a tap (Wave 4 item 3). What was missing is the trigger — nobody
-- ever queued the scan from a publish.
--
-- This row is only that switch. The enqueue in publish/index.ts reads it on
-- every successful publish of a master-platform map_recap or lesson, deduped
-- on content_id so a loop re-run cannot queue two scans of one recording.
-- Default on, per the Decision Log: "Clip candidate auto-create trigger: On
-- `map_recap` + `lesson` publish". Turn it off from Settings; candidates still
-- arrive from a manual jobs enqueue.
--
-- Producing candidates also needs the studio extras on the PC
-- (faster-whisper + CUDA); until they are installed the queued job fails
-- loudly at claim time, which is the honest signal — it never blocks a
-- publish and never cuts anything by itself.
insert into public.settings (key, value, description, needs_confirm) values
  ('clip_auto_create', 'true', 'Decision 4 (Phase 6): when a map_recap or lesson publishes on the master platform, queue one clip_candidates scan for that day''s recording. Needs the studio extras on the PC to produce candidates.', false)
on conflict (key) do nothing;
