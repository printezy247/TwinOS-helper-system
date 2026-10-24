-- 20261025000300_stop_monitoring_sales_bot.sql — the health board no longer
-- watches the sales bot. Its only "ok" beat was a made-up cron heartbeat, so
-- the board showed a bot nobody was checking as healthy. Drop its old beats
-- and stale-minutes setting so an ancient last beat can never count as a
-- stale source (the >3-stale-sources alert reads health_checks directly).
-- The sales_bot API key and role stay; add the source back to the health
-- function when the real bot can beat for itself.
delete from public.health_checks where source = 'sales_bot';
delete from public.settings where key = 'health_stale_sales_bot';
