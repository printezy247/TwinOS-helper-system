-- 0027: CTA library for the Wave 3 hook/CTA library (plan §17 item 5).
-- Mirrors the hooks bank (0002): one line per platform + language, rotated
-- least-recently-used through times_used / last_used_at. Every line carries
-- at most one CTA (plan §12); texts are Jack-approved seed data, no AI.

create table if not exists public.ctas (
  id bigint generated always as identity primary key,
  platform text not null,
  lang text not null check (lang in ('en', 'ms')),
  text text not null,
  times_used integer not null default 0,
  last_used_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform, lang, text)
);
create index if not exists idx_ctas_rotation on public.ctas (platform, lang) where active;

-- Service role (the functions) bypasses RLS; anon and authenticated get
-- nothing until a policy says otherwise, like the other library tables.
alter table public.ctas enable row level security;

insert into public.ctas (platform, lang, text) values
  ('telegram', 'en', 'See you at tomorrow''s map.'),
  ('telegram', 'en', 'Start here: https://t.me/EzyRegisterBot'),
  ('telegram', 'ms', 'Jumpa di map esok pagi.'),
  ('telegram', 'ms', 'Mula di sini: https://t.me/EzyRegisterBot'),
  ('instagram', 'en', 'Full map is in the Telegram channel — link in bio.'),
  ('instagram', 'en', 'Questions? Open the bot: https://t.me/EzyRegisterBot'),
  ('instagram', 'ms', 'Map penuh ada di channel Telegram — link di bio.'),
  ('instagram', 'ms', 'Ada soalan? Buka bot: https://t.me/EzyRegisterBot'),
  ('facebook', 'en', 'Today''s full map lives in the Telegram channel — link in bio.'),
  ('facebook', 'en', 'Trade with the plan: https://t.me/EzyRegisterBot'),
  ('facebook', 'ms', 'Map penuh hari ni di channel Telegram — link di bio.'),
  ('facebook', 'ms', 'Trade ikut plan: https://t.me/EzyRegisterBot'),
  ('threads', 'en', 'Map''s in the channel — link in bio.'),
  ('threads', 'en', 'Start: https://t.me/EzyRegisterBot'),
  ('threads', 'ms', 'Map ada di channel — link di bio.'),
  ('threads', 'ms', 'Mula: https://t.me/EzyRegisterBot'),
  ('youtube', 'en', 'Subscribe for tomorrow''s map.'),
  ('youtube', 'en', 'Free daily map in the Telegram channel — link in bio.'),
  ('youtube', 'ms', 'Subscribe untuk map esok.'),
  ('youtube', 'ms', 'Map percuma setiap hari di channel Telegram — link di bio.'),
  ('tiktok', 'en', 'Follow for tomorrow''s map.'),
  ('tiktok', 'en', 'Free gold map daily — link in bio.'),
  ('tiktok', 'ms', 'Follow untuk map esok.'),
  ('tiktok', 'ms', 'Map gold percuma setiap hari — link di bio.'),
  ('x', 'en', 'Full map''s in the channel.'),
  ('x', 'en', 'Free daily map — link in bio.'),
  ('x', 'ms', 'Map penuh ada di channel.'),
  ('x', 'ms', 'Map percuma setiap hari — link di bio.')
on conflict (platform, lang, text) do nothing;
