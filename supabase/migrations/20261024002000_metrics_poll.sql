-- 20261024002000_metrics_poll.sql — Phase 8: the Meta + YouTube metrics pollers.
--
-- "Wire the Meta and YouTube metrics pollers behind test credentials so Phase
-- 8 can be verified." Two pieces land here:
--
--   1. The credential rows the pollers read (settings first, function secret
--      as the fallback — the openrouter_api_key pattern). All eight are
--      needs_confirm so they surface on the dashboard's Settings page under
--      "Needs your confirmation", where Jack pastes TEST credentials: a Graph
--      API Explorer token works for Instagram/Facebook/Threads, and a YouTube
--      Data API v3 key from his own Google Cloud project works for YouTube.
--      No credential = that surface is skipped and named in the response —
--      nothing is ever faked into post_metrics.
--
--   2. pg_cron every 4 hours, staggered, through the same twinos_cron_call
--      helper every other schedule uses. pg_cron is absent on a vanilla
--      Postgres (CI): the schedules degrade to a notice, like 0023.
--
-- Rows land in post_metrics and are joined to their variant through
-- content_items.published_ref (publish stores the provider's post id there).

insert into public.settings (key, value, description, needs_confirm) values
  ('meta_ig_user_id', 'null', 'Phase 8 metrics poller: Instagram professional-account user id (digits). Leave null and the poller resolves it from the token''s /me. Test account ok. CONFIRM.', true),
  ('meta_ig_token', 'null', 'Phase 8 metrics poller: Instagram Graph access token (long-lived). A test token from the Graph API Explorer is fine to start. CONFIRM — expires in 60 days.', true),
  ('meta_page_id', 'null', 'Phase 8 metrics poller: Facebook Page id. Leave null and the poller resolves it from the Page token''s /me. CONFIRM.', true),
  ('meta_page_token', 'null', 'Phase 8 metrics poller: Facebook Page access token (long-lived). Test token ok. CONFIRM — expires in 60 days.', true),
  ('threads_user_id', 'null', 'Phase 8 metrics poller: Threads user id. Leave null and the poller resolves it from the token''s /me. CONFIRM.', true),
  ('threads_token', 'null', 'Phase 8 metrics poller: Threads access token (long-lived). Test token ok. CONFIRM — expires in 60 days.', true),
  ('yt_api_key', 'null', 'Phase 8 metrics poller: YouTube Data API v3 key from a Google Cloud project (enable the API, create an API key — no review needed). CONFIRM.', true),
  ('yt_channel_id', 'null', 'Phase 8 metrics poller: YouTube channel id, starting UC (About → advanced). CONFIRM.', true)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'twinos-metrics-meta') then
      perform cron.unschedule('twinos-metrics-meta');
    end if;
    if exists (select 1 from cron.job where jobname = 'twinos-metrics-youtube') then
      perform cron.unschedule('twinos-metrics-youtube');
    end if;
    perform cron.schedule('twinos-metrics-meta', '10 */4 * * *', $cron$select public.twinos_cron_call('metrics/poll/meta')$cron$);
    perform cron.schedule('twinos-metrics-youtube', '40 */4 * * *', $cron$select public.twinos_cron_call('metrics/poll/youtube')$cron$);
    raise notice 'scheduled twinos-metrics-meta (every 4h) and twinos-metrics-youtube (every 4h, staggered to :40)';
  else
    raise notice 'pg_cron not available here: schedule metrics/poll/meta and metrics/poll/youtube on Supabase';
  end if;
end $$;
