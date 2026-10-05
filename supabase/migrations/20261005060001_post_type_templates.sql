-- 20261005060001_post_type_templates.sql — the templates for the two labels
-- 20261005060000 just added.
--
-- The same two rows are in seed.sql, which is how a fresh database gets them;
-- the seed is never applied to a project that already exists, so they are
-- repeated here rather than left for a manual step. Keep both copies in step.

insert into public.templates (key, kit_number, name, schedule, prompt_text, fields, examples, required_lines, char_limit, hashtag, approval_rule, requires_approval, notes) values
  ('faq', 16, 'FAQ / repeat question', 'Whenever the same question is asked twice (v_repeat_questions).',
   $t$Write a post answering the question members keep asking: {QUESTION}. Answer it the way the channel's lessons do — short, practical, and with no number the channel has not already used.$t$,
   '["QUESTION", "ANSWER"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*Why move the stop to entry?*\n\nBecause once the market has paid you once, the trade should not be able to lose. The zone that proved the idea is still there; if price comes back through it, the idea was wrong.\n\nWe do it at TP1, never before."}]',
   '{}', 700, null, 'Answered from the channel''s own lessons. A claim (price, level, result) sends it to Jack as usual.', false, 'Feeds from v_repeat_questions: the third time a question is asked is the signal to write it up.'),
  ('live_recap', 17, 'Live recap', 'After each live; the best 60 seconds becomes a TikTok short.',
   $t$Write a recap of Jack's live on {DATE}. Covered: {TOPICS}. The one takeaway he wants kept: {TAKEAWAY}. Say where the replay and the cut are. Under 550 characters.$t$,
   '["DATE", "TOPICS", "TAKEAWAY"]',
   '[{"label": "EXAMPLE", "lang": "en", "body": "*Live recap | Sat 4 Oct*\n\nTwo hours on the chart: the 4,012 zone held, and the second attempt at 4,046 failed.\n\nKeep this one: wait for the close, not the wick.\n\nReplay in the channel, the cut is on TikTok."}]',
   '{}', 600, null, 'Recap of what was already said live; a level or a result that was not said live makes it a normal post and it goes to Jack.', false, 'Pairs with live_runsheets; the clip itself comes out of /clips.')
on conflict (key) do nothing;

update public.templates set fields_list = '{question,answer}', body = $b$*{{question}}*

{{answer}}

Asked more than once, so it gets its own post.$b$ where key = 'faq';

update public.templates set fields_list = '{date,topics,takeaway}', body = $b$*Live recap | {{date}}*

{{topics}}

Keep this one: {{takeaway}}

Replay in the channel, the cut is on TikTok.$b$ where key = 'live_recap';
