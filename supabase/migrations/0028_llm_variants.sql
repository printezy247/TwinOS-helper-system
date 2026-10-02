-- 0028: variant provenance for llm_variants (plan §17 Wave 3 item 6).
-- The llm_variants_enabled / llm_angles / llm_local_url settings live in
-- seed.sql (the settings convention). Migration 0011 gave variants a
-- compliance column but no source: the Desk Pick button reads this back.
alter table public.content_variants add column if not exists source jsonb not null default '{}'::jsonb;
