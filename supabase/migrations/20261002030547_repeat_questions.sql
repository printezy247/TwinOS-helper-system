-- 0022_repeat_questions.sql — the FAQ sheet's feed (Phase 4, plan §9.I.75).
--
-- The ops bot records every question asked in the discussion group as a
-- moderation_events row with rule_key = 'repeat_question', detail = the
-- question reduced to its sorted meaningful words, and the original in
-- text_excerpt. v_repeat_questions is the questions asked more than once in the
-- last 14 days (mod_rules.repeat_question.params.window_days), most asked
-- first: the list Sarah's reply sheet is built from.

create or replace view public.v_repeat_questions
with (security_invoker = true) as
select detail,
       count(*)::int as times_asked,
       count(distinct user_id)::int as askers,
       max(text_excerpt) as example,
       max(occurred_at) as last_asked_at
  from public.moderation_events
 where rule_key = 'repeat_question'
   and detail is not null and detail <> ''
   and occurred_at > now() - interval '14 days'
 group by detail
having count(*) > 1
 order by count(*) desc, max(occurred_at) desc;

comment on view public.v_repeat_questions is 'Questions asked more than once in the discussion group in 14 days (normalised), for the FAQ reply sheet.';
