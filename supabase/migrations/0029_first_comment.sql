-- 0029: delayed first comment for the calendar scheduler (plan §17 Wave 4 item 2).
-- A scheduled item may carry a first comment, posted as a reply under its own
-- channel message first_comment_delay_min minutes after the post. Comment jobs
-- ride the same publish_jobs queue; kind keeps them apart from the post job
-- for the same variant.
alter table public.content_items
  add column if not exists first_comment text;
alter table public.content_items
  add column if not exists first_comment_delay_min integer not null default 30;

alter table public.publish_jobs
  add column if not exists kind text not null default 'post';
-- 0011 keyed one job per variant; a comment job shares the variant, so the
-- key becomes (variant_id, kind).
drop index if exists public.idx_publish_jobs_variant_uniq;
create unique index if not exists idx_publish_jobs_variant_kind_uniq
  on public.publish_jobs (variant_id, kind);
