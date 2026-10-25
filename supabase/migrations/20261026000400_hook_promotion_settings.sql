-- E2 (v5 plan): hook promotion as a proposal, never automatic. Friday reads
-- these three rows to decide whether a candidate hook beats the incumbent by
-- `hook_promote_margin` over at least `hook_promote_min_posts` of its own
-- posts (the decision itself is pure logic in _shared/promotion.ts).
-- `hook_active_id` is the promoted hook — the only row POST /friday/promote
-- writes, Jack's approval alone; while null the most-used hook is the
-- incumbent. Same rows in seed.sql; `on conflict do nothing` so a re-run
-- never overwrites a value Jack already changed.
insert into public.settings (key, value, description, needs_confirm) values
  ('hook_promote_margin', '0.25', 'E2: relative lift in average 1 h views a hook must beat the incumbent by before Friday may suggest promoting it (0.25 = 25 %).', false),
  ('hook_promote_min_posts', '5', 'E2: how many of the candidate hook''s own posts are required before a suggestion appears on Friday.', false),
  ('hook_active_id', 'null', 'E2: the hook Jack promoted (only POST /friday/promote writes it). While null, the most-used hook is the incumbent.', false)
on conflict (key) do nothing;
