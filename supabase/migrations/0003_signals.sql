-- 0003_signals.sql — signals, outcomes and the channel messages that carry them.
-- Mirrors EzyAi app/outcomes/store.py (signals.db) and printezy's
-- ezyai_signals migration (external_id unique → idempotent ingest, §9.B.10).

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,        -- EzyAi row id / TradingView alert id; makes every push idempotent
  source text not null default 'ezyai' check (source in ('ezyai', 'tradingview', 'manual')),
  chat_id bigint,                          -- EzyAi: the chat the signal was delivered to
  -- EzyAi signals.db fields
  pair text not null,
  style text not null,                     -- scalp | intraday | swing (EzyAi STYLE_PROFILE keys)
  mode text not null,                      -- risk mode (EzyAi MODE_PROFILE keys)
  direction text not null check (direction in ('long', 'short', 'buy', 'sell')),
  entry numeric not null,
  entry_low numeric,                       -- entry zone, when the card shows a zone
  entry_high numeric,
  stop_loss numeric not null,
  tp1 numeric not null,
  tp2 numeric not null,
  rr_target numeric not null,
  confidence numeric not null,
  component_scores jsonb not null default '{}'::jsonb,
  data_source text not null default 'live',  -- live | demo | shadow | synthetic | yahoo | binance | ccxt
  spread_estimate numeric,
  spread_unit text,
  status text not null default 'open' check (status in ('open', 'tp1', 'tp2', 'be', 'sl', 'expired', 'cancelled', 'shadow')),
  same_candle_ambig boolean not null default false,
  resolved_at timestamptz,
  exit_price numeric,
  r_multiple numeric,
  -- TwinOS additions
  timeframe text,                          -- M15 etc. from the TradingView alert
  counter_trend boolean not null default false,  -- keep the COUNTER-TREND warning (§9.D.22)
  confluences smallint,
  week_signal_no smallint,                 -- "Free signal #3 this week" (§9.D.29)
  expires_at timestamptz,                  -- stop-if window; NULL = settings.signal_expiry_hours after signal_at
  signal_at timestamptz not null default now(),   -- EzyAi created_at (epoch) as timestamptz
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_signals_status on public.signals (status, signal_at desc);
create index if not exists idx_signals_style on public.signals (style);
create index if not exists idx_signals_pair on public.signals (pair, signal_at desc);
comment on table public.signals is 'Every signal EzyAi or TradingView pushed. Demo/shadow/synthetic rows never reach a public post (EzyAi quality.may_emit, §9.D.27).';

-- One row per outcome event (tp1, then tp2 / be / sl). The final state is
-- mirrored onto signals.status by the ingest function.
create table if not exists public.signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals (id) on delete cascade,
  external_id text not null unique,        -- EzyAi outcome id (e.g. '<signal>:tp1'); idempotent
  status text not null check (status in ('tp1', 'tp2', 'be', 'sl', 'expired', 'cancelled')),
  exit_price numeric,
  r_multiple numeric,
  pips numeric,
  same_candle_ambig boolean not null default false,
  resolved_at timestamptz not null default now(),
  note text,                               -- Jack's one-line reason (template 4)
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_signal_outcomes_signal on public.signal_outcomes (signal_id, resolved_at);

-- signal_posts: which channel message carries the card, and which replies
-- carry the results, so result replies go under the original (§9.D.24).
create table if not exists public.signal_posts (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.signals (id) on delete cascade,
  kind text not null default 'card' check (kind in ('card', 'result')),
  outcome_id uuid references public.signal_outcomes (id) on delete set null,
  chat_id bigint not null,
  message_id bigint not null,
  variant_id uuid references public.content_variants (id) on delete set null,
  posted_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
create index if not exists idx_signal_posts_signal on public.signal_posts (signal_id, kind);

-- content_items.signal_id → signals (declared in 0002 without the FK)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_items_signal_id_fkey') then
    alter table public.content_items
      add constraint content_items_signal_id_fkey
      foreign key (signal_id) references public.signals (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Strict win rate: W / (W + L), break-even excluded (§9.D.26)
-- ---------------------------------------------------------------------------
create or replace function public.outcome_class(p_status text, p_r numeric)
returns text
language sql
immutable
as $$
  select case
    when p_status in ('tp1', 'tp2') then 'win'
    when p_status = 'sl' then 'loss'
    when p_status = 'be' then 'be'
    when p_status = 'expired' and p_r > 0 then 'win'
    when p_status = 'expired' and p_r < 0 then 'loss'
    when p_status = 'expired' then 'be'
    when p_status = 'open' then 'open'
    else 'excluded'
  end;
$$;

create or replace function public.strict_win_rate(p_wins bigint, p_losses bigint)
returns numeric
language sql
immutable
as $$
  select case when coalesce(p_wins, 0) + coalesce(p_losses, 0) = 0 then null
              else round(100.0 * p_wins / (p_wins + p_losses), 1) end;
$$;
comment on function public.strict_win_rate(bigint, bigint) is 'Strict win rate in percent: W / (W + L). Break-even never enters the denominator.';

create or replace function public.results_stats(p_since timestamptz default now() - interval '28 days', p_until timestamptz default now())
returns table (
  signals bigint, wins bigint, losses bigint, break_even bigint, open_signals bigint,
  strict_win_rate numeric, total_r numeric, avg_r numeric
)
language sql
stable
as $$
  with s as (
    select public.outcome_class(status, r_multiple) as cls, r_multiple
    from public.signals
    where signal_at >= p_since and signal_at < p_until
      and data_source = 'live' and status <> 'shadow'
  )
  select
    count(*)::bigint,
    count(*) filter (where cls = 'win')::bigint,
    count(*) filter (where cls = 'loss')::bigint,
    count(*) filter (where cls = 'be')::bigint,
    count(*) filter (where cls = 'open')::bigint,
    public.strict_win_rate(count(*) filter (where cls = 'win'), count(*) filter (where cls = 'loss')),
    round(coalesce(sum(r_multiple) filter (where cls in ('win', 'loss', 'be')), 0), 2),
    round(avg(r_multiple) filter (where cls in ('win', 'loss', 'be')), 2)
  from s;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent ingest for EzyAi (batches ≤ 50, per-row results; §9.B.10).
-- Called with the ezyai scoped key; also usable by the tv-webhook function.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_signals(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  r jsonb;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_n integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ingest_signals expects a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 50 then
    raise exception 'ingest_signals accepts at most 50 rows per call';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    begin
      insert into public.signals (
        external_id, source, chat_id, pair, style, mode, direction, entry, entry_low, entry_high,
        stop_loss, tp1, tp2, rr_target, confidence, component_scores, data_source,
        spread_estimate, spread_unit, status, same_candle_ambig, resolved_at, exit_price,
        r_multiple, timeframe, counter_trend, confluences, expires_at, signal_at, raw
      ) values (
        r ->> 'external_id', coalesce(r ->> 'source', 'ezyai'), (r ->> 'chat_id')::bigint,
        upper(r ->> 'pair'), r ->> 'style', r ->> 'mode', r ->> 'direction',
        (r ->> 'entry')::numeric, (r ->> 'entry_low')::numeric, (r ->> 'entry_high')::numeric,
        (r ->> 'stop_loss')::numeric, (r ->> 'tp1')::numeric, (r ->> 'tp2')::numeric,
        (r ->> 'rr_target')::numeric, (r ->> 'confidence')::numeric,
        coalesce(r -> 'component_scores', '{}'::jsonb), coalesce(r ->> 'data_source', 'live'),
        (r ->> 'spread_estimate')::numeric, r ->> 'spread_unit', coalesce(r ->> 'status', 'open'),
        coalesce((r ->> 'same_candle_ambig')::boolean, false),
        (r ->> 'resolved_at')::timestamptz, (r ->> 'exit_price')::numeric, (r ->> 'r_multiple')::numeric,
        r ->> 'timeframe', coalesce((r ->> 'counter_trend')::boolean, false), (r ->> 'confluences')::smallint,
        (r ->> 'expires_at')::timestamptz, coalesce((r ->> 'signal_at')::timestamptz, now()), r
      )
      on conflict (external_id) do update set
        status = excluded.status,
        same_candle_ambig = excluded.same_candle_ambig,
        resolved_at = coalesce(excluded.resolved_at, public.signals.resolved_at),
        exit_price = coalesce(excluded.exit_price, public.signals.exit_price),
        r_multiple = coalesce(excluded.r_multiple, public.signals.r_multiple),
        raw = excluded.raw,
        updated_at = now()
      returning id into v_id;
      v_out := v_out || jsonb_build_object('row', v_n, 'id', v_id, 'ok', true);
    exception when others then
      v_out := v_out || jsonb_build_object('row', v_n, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end;
$$;

create or replace function public.ingest_outcome(p_row jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_signal uuid;
  v_id uuid;
begin
  select id into v_signal from public.signals where external_id = p_row ->> 'signal_external_id';
  if v_signal is null then
    raise exception 'unknown signal external_id %', p_row ->> 'signal_external_id';
  end if;
  insert into public.signal_outcomes (signal_id, external_id, status, exit_price, r_multiple, pips, same_candle_ambig, resolved_at, note, raw)
  values (
    v_signal, p_row ->> 'external_id', p_row ->> 'status', (p_row ->> 'exit_price')::numeric,
    (p_row ->> 'r_multiple')::numeric, (p_row ->> 'pips')::numeric,
    coalesce((p_row ->> 'same_candle_ambig')::boolean, false),
    coalesce((p_row ->> 'resolved_at')::timestamptz, now()), p_row ->> 'note', p_row
  )
  on conflict (external_id) do update set
    exit_price = excluded.exit_price, r_multiple = excluded.r_multiple, pips = excluded.pips, raw = excluded.raw
  returning id into v_id;

  -- Mirror the final state onto the signal (TP1 keeps the signal open for TP2/BE).
  update public.signals set
    status = case when (p_row ->> 'status') = 'tp1' and status = 'open' then 'open' else p_row ->> 'status' end,
    resolved_at = case when (p_row ->> 'status') = 'tp1' then resolved_at else coalesce((p_row ->> 'resolved_at')::timestamptz, now()) end,
    exit_price = coalesce((p_row ->> 'exit_price')::numeric, exit_price),
    r_multiple = coalesce((p_row ->> 'r_multiple')::numeric, r_multiple),
    updated_at = now()
  where id = v_signal;
  return v_id;
end;
$$;

grant execute on function public.outcome_class(text, numeric) to anon, authenticated, service_role;
grant execute on function public.strict_win_rate(bigint, bigint) to anon, authenticated, service_role;
grant execute on function public.results_stats(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.ingest_signals(jsonb) to authenticated, service_role;
grant execute on function public.ingest_outcome(jsonb) to authenticated, service_role;
