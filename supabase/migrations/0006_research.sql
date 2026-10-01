-- 0006_research.sql — keyword/topic research with free sources (§9.K), reference
-- channel benchmarks (§4.10), Jack's own posts as writing examples (§9.J.80).
-- pgvector 384-dim embeddings (all-MiniLM-L6-v2 class model on the PC worker).

-- pgvector: present on Supabase. On a vanilla Postgres without the extension
-- the embedding columns fall back to real[] so the migration still loads.
do $$
begin
  begin
    create extension if not exists vector with schema extensions;
  exception when others then
    begin
      create extension if not exists vector;
    exception when others then
      raise notice 'pgvector not available (%); embedding columns will be real[]', sqlerrm;
    end;
  end;
end $$;

-- queries: raw demand signals (§9.K.86–92)
create table if not exists public.queries (
  id bigint generated always as identity primary key,
  term text not null,
  lang text not null default 'en' check (lang in ('en', 'ms', 'manglish')),
  source text not null check (source in ('autocomplete', 'search_console', 'bing', 'youtube', 'youtube_rss', 'csi', 'poll', 'live_qa', 'comment', 'manual')),
  region text not null default 'MY',
  prefix text,                             -- question prefix used for autocomplete expansion
  score numeric,                           -- relative score from free sources (§6)
  impressions integer,
  clicks integer,
  competition numeric,                     -- YouTube competition score (§9.K.89)
  icp smallint references public.personas (id),
  cluster_id uuid,                         -- set below (FK after topic_clusters)
  captured_at timestamptz not null default now(),
  raw jsonb,
  created_by text not null default public.twinos_actor(),
  unique (term, lang, source, region, captured_at)
);
create index if not exists idx_queries_term on public.queries (term);
create index if not exists idx_queries_captured on public.queries (captured_at desc);

-- topic_clusters: demand × ICP fit × low compliance risk (§9.K.93)
create table if not exists public.topic_clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pillar text,                             -- map_recap | channel_audit | lesson | start_safe | tool_demo | jacks_desk
  icp smallint references public.personas (id),
  demand_score numeric,
  icp_fit numeric,
  compliance_risk numeric,                 -- 0 = safe .. 1 = avoid
  total_score numeric generated always as (coalesce(demand_score, 0) * coalesce(icp_fit, 0) * (1 - coalesce(compliance_risk, 0))) stored,
  query_count integer not null default 0,
  status text not null default 'new' check (status in ('new', 'proposed', 'used', 'rejected')),
  used_in_item_id uuid references public.content_items (id) on delete set null,
  notes text,
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_topic_clusters_score on public.topic_clusters (total_score desc) where status in ('new', 'proposed');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'queries_cluster_id_fkey') then
    alter table public.queries
      add constraint queries_cluster_id_fkey foreign key (cluster_id) references public.topic_clusters (id) on delete set null;
  end if;
end $$;

-- briefs: the Monday brief proposing next week's 7 TikToks (§9.K.93)
create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  body text not null,                      -- markdown
  proposed_slots jsonb not null default '[]'::jsonb, -- [{dow, pillar, topic, cluster_id, hook_id}]
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'edited')),
  created_by text not null default public.twinos_actor(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- csi_captures: weekly 10-minute TikTok Creator Search Insights form (§6, §9.K.91)
create table if not exists public.csi_captures (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  topic text not null,
  category text,                           -- CSI category / tab
  metric text,                             -- popularity | content_gap | search_volume_rel
  value numeric,
  trend text check (trend in ('up', 'flat', 'down')),
  note text,
  screenshot_asset_id uuid references public.assets (id) on delete set null,
  captured_by text not null default public.twinos_actor()
);
create index if not exists idx_csi_topic on public.csi_captures (topic, captured_at desc);

-- benchmarks: reference channels (§4.10). Handles are an open question (§16.1).
-- Their text is never fed to the AI and they are never named in posts.
create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform public.platform not null default 'telegram',
  handle text,                             -- NULL until Jack supplies it (§16.1)
  audience_tier text check (audience_tier in ('high_capital', 'retail', 'mixed')),
  is_usual_ib boolean,                     -- false for Jack's five (decision 12)
  size_members integer,
  posts_per_day numeric(5, 2),
  avg_views integer,
  view_rate_pct numeric(5, 2),
  offer_structure text,
  qualification_notes text,                -- how they qualify big-deposit members
  disclosures text,
  note text,
  captured_at timestamptz,
  source text not null default 'manual',   -- manual | web_preview | tgstat_page | youtube_rss
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, platform)
);

-- exemplars: only Jack's own best posts and his edits (§9.J.80–81). Never other channels' text.
create table if not exists public.exemplars (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('jack_post', 'jack_edit', 'jack_note')),
  variant_id uuid references public.content_variants (id) on delete set null,
  post_type public.post_type,
  lang text not null default 'en' check (lang in ('en', 'ms')),
  body text not null,
  before_body text,                        -- for jack_edit: the draft before the edit
  views_24h integer,
  reactions integer,
  score numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_exemplars_type on public.exemplars (post_type, lang) where active;

-- Embedding columns: vector(384) when pgvector exists (schema-qualified, since
-- Supabase installs it under `extensions`), real[] otherwise.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';
  if v_schema is not null then
    execute format('alter table public.topic_clusters add column if not exists embedding %I.vector(384)', v_schema);
    execute format('alter table public.exemplars add column if not exists embedding %I.vector(384)', v_schema);
    execute format('create index if not exists idx_topic_clusters_embedding on public.topic_clusters using hnsw (embedding %I.vector_cosine_ops)', v_schema);
    execute format('create index if not exists idx_exemplars_embedding on public.exemplars using hnsw (embedding %I.vector_cosine_ops)', v_schema);
  else
    execute 'alter table public.topic_clusters add column if not exists embedding real[]';
    execute 'alter table public.exemplars add column if not exists embedding real[]';
  end if;
end $$;
