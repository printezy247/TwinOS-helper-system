-- 0026_desk_state_wave0.sql — plan §17 Wave 0 fix 1.
--
-- fanout.ts sets desk_state = 'kit' but 0011's check only allowed
-- (awaiting_edit, awaiting_time, rewritten), so the update failed silently
-- (kits live with no state). Wave 1 Later quick picks need 'awaiting_slot',
-- and edit/later prompts expire after 30 minutes via desk_state_at.

alter table public.content_items
  drop constraint if exists content_items_desk_state_check;

alter table public.content_items add column if not exists desk_state_at timestamptz;

alter table public.content_items
  add constraint content_items_desk_state_check
  check (
    desk_state is null
    or desk_state in ('awaiting_edit', 'awaiting_time', 'awaiting_slot', 'rewritten', 'kit')
  );

create index if not exists idx_content_items_desk_state_at
  on public.content_items (desk_state_at) where desk_state is not null;
