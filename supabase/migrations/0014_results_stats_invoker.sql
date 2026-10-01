-- 0014_results_stats_invoker.sql — results_stats() no longer needs to run as its owner.
--
-- It only reads live, non-shadow signals through columns anon already has
-- (0013), so it can run with the caller's rights. That drops the advisor's
-- "SECURITY DEFINER function callable by anon" warning for it. Callers whose
-- role has no read policy on signals now get zeros instead of the board's
-- numbers, which is what row-level security is meant to do.
alter function public.results_stats(timestamptz, timestamptz) security invoker;
