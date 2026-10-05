-- 20261005060000_post_types.sql — two more post types: the labels only.
--
--   faq          v_repeat_questions has been collecting the questions the
--                channel hears twice, and there was no type to answer one with,
--                so a repeat ask was a signal with nowhere to go.
--   live_recap   calendar_slots has kind='live' and live_runsheets says the best
--                60 seconds goes to TikTok as a short, but the recap after a
--                live had no template either.
--
-- The labels land in their own migration, and the rows that use them land in
-- the next one, because `supabase db push` runs a migration inside a
-- transaction and a value added in a transaction cannot be used until it
-- commits (error 428C9). A fresh database gets both labels from 0002's literal
-- enum block instead, and `if not exists` makes this a no-op there.

alter type public.post_type add value if not exists 'faq';
alter type public.post_type add value if not exists 'live_recap';
