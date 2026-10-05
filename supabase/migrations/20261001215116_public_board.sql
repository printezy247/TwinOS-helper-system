-- 0013_public_board.sql — make the public results board safe.
--
-- v_results_board is the one thing anon may read (a public board page is built
-- on it). It was a plain view, which Postgres runs with its owner's rights, so
-- Supabase's advisor flags it as a critical "security definer view": it bypasses
-- row-level security on everything it touches.
--
-- Run it as the caller instead (security_invoker) and give anon exactly what the
-- board shows, no more: live, non-shadow signals only, and only the columns the
-- view selects. The raw payload, scores, chat ids and every other table stay
-- closed to anon. Idempotent.

alter view public.v_results_board set (security_invoker = true);

drop policy if exists anon_public_board on public.signals;
create policy anon_public_board on public.signals for select to anon
  using (data_source = 'live' and status <> 'shadow');

grant select (
  id, external_id, source, pair, direction, timeframe, style,
  entry, entry_low, entry_high, stop_loss, tp1, tp2, rr_target,
  counter_trend, status, r_multiple, exit_price, signal_at, resolved_at, data_source
) on public.signals to anon;

-- The board only asks "was a card / result posted for this signal".
drop policy if exists anon_public_board on public.signal_posts;
create policy anon_public_board on public.signal_posts for select to anon using (true);
grant select (signal_id, kind) on public.signal_posts to anon;
