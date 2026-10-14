# TwinOS Code Upgrade Implementation Plan

This document is the implementation plan for the upgrade ideas in the root `UPGRADE-IDEAS.md`. The root `UPGRADE-PLAN.md` is the business Master Plan v3 and is not touched.

## Implementation Order

The phases build outward from the Bot API transport layer (Phase 1) through the content and publishing pipeline (Phases 2–4) to scheduling and analytics (Phases 5–6), and finally the studio pipeline (Phase 7). Each phase can ship independently; the only hard dependency is Phase 1 → Phase 2 (backoff changes feed the publisher).

```
Phase 1 → Phase 2 → Phase 3
    ↓
Phase 4 (variant management)
    ↓
Phase 5 (scheduling + approval hooks)
    ↓
Phase 6 (analytics + checkpoints)
    ↓
Phase 7 (studio pipeline)
```

## Phase 1 — Bot API hardening

**Goal:** Make the Telegram transport layer as robust as telegraf/grammY before the publishing pipeline depends on it more heavily.

### Steps

1. **Middleware classification pipeline** (`backoff.ts`)
   - Add `classifyMiddleware.ts` with `TgErrorMiddleware`, `MetaErrorMiddleware`, `TransportMiddleware`, `GenericMiddleware`
   - Each implements `classify(err: unknown): { kind: Kind; reason: string } | null`
   - `classify()` in `backoff.ts` chains them: `for (const m of middlewares) { const r = m.classify(err); if (r) return r; }`
   - Tests in `_shared/backoff_test.ts` (new): 5 cases per middleware

2. **Bot instance factory** (`tg.ts`, `supabase.ts`)
   - Add `tgClients: Map<string, TelegramClient>` in `supabase.ts`
   - `TelegramClient` wraps `call()` with a bound token
   - `getTgClient(name = "default")` returns the cached client
   - Migrate all `tg.ts` callers from `call(token, method, ...)` to `client.call(method, ...)`

3. **Stale-menu fingerprint** (`tg.ts`, `NAV_LAYOUT`)
   - Add `MENU_LAYOUT_VERSION = "v2"` constant
   - Encode the version into `callback_data` as a suffix: `nav:screen:id:ver`
   - `isStaleFp(stored, current)` compares versions

4. **Long-polling fallback** (`tg.ts`)
   - Add `pollUpdates(opts?: { offset?: number; limit?: number; timeout?: number })`
   - Uses `getUpdates` with `timeout: 30`, tracks offset, yields updates
   - Only used when `setting("use_polling") === true` (development)

### Files changed
- `supabase/functions/_shared/backoff.ts` — middleware pipeline
- `supabase/functions/_shared/tg.ts` — client factory, polling, fingerprint
- `supabase/functions/_shared/supabase.ts` — `tgClients` map
- `supabase/functions/_shared/backoff_test.ts` — new middleware tests
- `supabase/functions/_shared/tg_test.ts` — polling + fingerprint tests

### Tests
- `deno test backoff_test.ts` — all pass
- `deno test tg_test.ts` — all pass
- New: `classifyMiddleware_test.ts` — 5 cases per middleware tier

---

## Phase 2 — Retry, backoff, rate limiting

**Goal:** Replace the deterministic backoff with jittered backoff and add a bottleneck-style rate limiter so the publisher never 429s itself.

### Steps

1. **Jittered backoff** (`backoff.ts`)
   - Add `BACKOFF_JITTER = 0.5` constant
   - Add `jitteredBackoff(attempts: number): number` — returns `backoffMs(attempts) * Math.random()` (full jitter)
   - `retryPlan()` already returns `{ delayMs, burnsAttempt }` — change `delayMs` to use `jitteredBackoff()` when `jitter: true` is in the opts
   - `publish/index.ts` passes `{ jitter: true }` on all retry calls

2. **Timeout + AbortController** (`tg.ts`)
   - `call()` accepts `opts.timeoutMs = 30_000` (30s default)
   - Creates `const controller = new AbortController()`
   - `const timer = setTimeout(() => controller.abort(), opts.timeoutMs)`
   - Passes `signal: controller.signal` to `fetch()`
   - On abort, throws a `TgError` with `code = 408` (timeout) so `classify()` sees `throttled`
   - Clears timer in `finally`

3. **Bottleneck rate limiter** (`backoff.ts`, `publish/index.ts`)
   - Add `RateLimiter` class: token bucket with `capacity`, `refillPerTick`, `tokens`
   - `consume(n = 1): boolean` — returns false if no tokens
   - `refill()` called at each publisher tick (every minute)
   - `claimOne()` in `publish/index.ts` checks `underCap()` (exists in `meta.ts`) AND `rateLimiter.consume()` before sending
   - Capacity = min(platform daily cap, 10 posts per minute)

### Files changed
- `supabase/functions/_shared/backoff.ts` — jitter, RateLimiter
- `supabase/functions/_shared/tg.ts` — timeout/abort
- `supabase/functions/publish/index.ts` — consume limiter before send
- `supabase/functions/_shared/backoff_test.ts` — jitter + RateLimiter tests

### Tests
- `jitteredBackoff(3)` returns `in [0, 240000)` (between 0 and 240s)
- `RateLimiter.consume()` returns true then false after capacity exhausted
- `RateLimiter.refill()` restores tokens
- Full backoff round-trip: throttled → jittered delay → retried

---

## Phase 3 — Job queue reliability

**Goal:** Make the job queues (publish + fan-out + research) survive crashes and stuck cycles without manual intervention.

### Steps

1. **Idempotent job claim** (`idempotency.ts`, schema)
   - New migration: `20261014000001_job_claims.sql`
   - `job_claims(job_id uuid pk, worker_id text, claimed_at timestamptz, expires_at timestamptz)`
   - `replay()` in `idempotency.ts` gains `claimJob(jobId, workerId)` — INSERT, on conflict (23505) means someone else won
   - `publish/index.ts:claimOne()` calls `claimJob()` before processing
   - `fanout.ts` calls `claimJob()` per platform retry

2. **Bounded job runs** (`publish/index.ts`, `fanout.ts`)
   - Add `MAX_JOBS_PER_TICK = 10` constant in `publish/index.ts`
   - `claimOne()` changes to `claimBatch(limit = MAX_JOBS_PER_TICK)`
   - Loop processes up to `limit` jobs, then exits (pg_cron fires next minute)
   - Same in `fanout.ts:drainBatch(limit)`

3. **Dead-letter queue** (`publish/index.ts`, schema, `alerts.ts`)
   - New migration: `20261014000002_dead_letter.sql`
   - `dead_letter_jobs(id uuid pk, job_type text, payload jsonb, error text, created_at timestamptz, desk_alert_key text)`
   - When `classify()` returns `permanent` and `attempts >= MAX_ATTEMPTS`, INSERT into `dead_letter_jobs`
   - `deskAlert()` in `alerts.ts` surfaces `fanout-stuck` and `publish-dlq` to the Desk
   - Add `GET /health/dead-letter` endpoint returning unacknowledged DLQ rows

### Files changed
- `supabase/migrations/20261014000001_job_claims.sql`
- `supabase/migrations/20261014000002_dead_letter.sql`
- `supabase/functions/_shared/idempotency.ts` — `claimJob()`
- `supabase/functions/_shared/backoff.ts` — DLQ insert on permanent failure
- `supabase/functions/publish/index.ts` — batch claim, DLQ
- `supabase/functions/_shared/fanout.ts` — bounded drain
- `supabase/functions/_shared/alerts.ts` — DLQ alert keys

### Tests
- `idempotency_test.ts` — `claimJob()` race: two callers, one wins
- `publish/index_test.ts` (new) — `claimBatch(10)` claims exactly 10
- `backoff_test.ts` — permanent failure after MAX_ATTEMPTS → DLQ insert
- `alerts_test.ts` — `deskAlert("publish-dlq")` creates one open row

---

## Phase 4 — Content variant management

**Goal:** Clean up the AI variant workflow so Jack picks exactly one angle per platform, and fan-out retries are isolated.

### Steps

1. **Concurrency limiter for AI variants** (`content.ts`, `workers/pc/job_llm_variants.py`)
   - Add `ConcurrencyLimiter` class in `content.ts` (mirrors p-limit)
   - `limit(fn: () => Promise<T>): Promise<T>` — queues if running === max
   - Worker calls `const limit = new ConcurrencyLimiter(3)` then `limit(() => generateAngle(platform))`
   - Exported from `content.ts` for the worker to import

2. **Variant selection RPC** (`content.ts`, `tg-webhook/index.ts`, `platforms.ts`)
   - Add `pickVariant(body: { variant_id, picked: boolean })` in `content.ts`
   - Updates `content_variants.source.picked` and `source.rejected_at`
   - `isPublishableVariant()` in `platforms.ts` already checks `source.picked === true` — extend to also check `source.rejected_at IS NULL`
   - `tg-webhook` callback `pk:<variant_short>` calls `pickVariant({ variant_id, picked: true })` and rejects siblings

3. **Fan-out drain cron** (`fanout.ts`, `content/fanout-drain`)
   - Add `drainBatch(limit = 5)` in `fanout.ts`
   - Claims `fanout_platform` jobs WHERE `status = 'queued' AND run_at <= now()`
   - For each: calls `fanOutOne()` with `enqueueRetry: true`
   - On `throttled`: requeue with `CAP_HOLD_MS` (30 min), `burnsAttempt: false`
   - On `permanent`: set `status = 'failed'`, alert Desk if queue >= `FANOUT_STUCK_THRESHOLD`
   - New cron `twinos-fanout-drain` every minute

### Files changed
- `supabase/functions/_shared/content.ts` — ConcurrencyLimiter, pickVariant
- `supabase/functions/_shared/platforms.ts` — isPublishableVariant rejects rejected
- `supabase/functions/_shared/fanout.ts` — drainBatch
- `supabase/functions/content/fanout-drain/index.ts` (new) — cron handler
- `workers/pc/job_llm_variants.py` — ConcurrencyLimiter usage
- `supabase/functions/tg-webhook/index.ts` — pk: callback handler
- `supabase/migrations/20261014000003_fanout_drain.sql` — cron schedule

### Tests
- `content_test.ts` — ConcurrencyLimiter: 5 concurrent, max 3
- `fanout_test.ts` — drainBatch claims 5, requeues on throttled
- `platforms_test.ts` — isPublishableVariant returns false for rejected
- `nav_test.ts` — pk: callback resolves to variant, calls pickVariant

---

## Phase 5 — Scheduling and approval hooks

**Goal:** Natural-language scheduling from the Desk, and extracted approve/reject hooks so both the Desk and dashboard share the same content lifecycle.

### Steps

1. **Natural-language scheduling** (`hours.ts`, `content/` endpoints)
   - Add `parseScheduleSlot(text: string, tz: string): string | null` in `hours.ts`
   - Supports: "08:15", "tomorrow 8am", "next Monday 13:00", "later today"
   - Returns ISO timestamp in the given timezone (uses `Temporal.ZonedDateTime` from `@js-temporal/polyfill` or manual offset)
   - `POST /content/{id}/reschedule` accepts `{ when: "tomorrow 8am" }` and calls `parseScheduleSlot()`
   - Desk callback `rs:<id8>:<slot>` already exists — extend it to accept slot names like "tomorrow-08:00"

2. **afterApprove / afterReject hooks** (`content.ts`, `approve/index.ts`)
   - Extract from `approve/index.ts` into `content.ts`:
     - `afterApprove(content_id)`: runs compliance on all variants, calls `enqueuePublish()`
     - `afterReject(content_id)`: calls `cancelScheduledJobs(content_id)`, notifies Desk
     - `cancelScheduledJobs(content_id)`: UPDATE publish_jobs SET status='cancelled' WHERE content_id = $1 AND status IN ('queued', 'failed')
   - `approve/index.ts` calls these hooks after flipping status

3. **Calendar view endpoint** (`content/` endpoint, dashboard)
   - `GET /content/calendar?date=YYYY-MM-DD` returns:
     ```json
     [
       { id, post_type, lang, scheduled_at, variants: [
         { platform, status, compliance_ok, needs_approval }
       ]}
     ]
     ```
   - Uses `v_content_log` view with a date filter
   - Dashboard Calendar screen fetches this per day

### Files changed
- `supabase/functions/_shared/hours.ts` — parseScheduleSlot
- `supabase/functions/_shared/content.ts` — afterApprove, afterReject, cancelScheduledJobs
- `supabase/functions/approve/index.ts` — call hooks
- `supabase/functions/content/reschedule/index.ts` (new) — POST handler
- `supabase/functions/content/calendar/index.ts` (new) — GET handler
- `supabase/functions/tg-webhook/index.ts` — rs: callback uses parseScheduleSlot

### Tests
- `hours_test.ts` — parseScheduleSlot: "tomorrow 8am" -> correct ISO
- `content_test.ts` — afterApprove triggers compliance + enqueuePublish
- `content_test.ts` — afterReject cancels jobs
- Calendar endpoint returns correct shape (integration test in `tests/smoke.sql`)

---

## Phase 6 — Insights and analytics

**Goal:** Multi-channel comparisons and crash-safe research runs with checkpoint resumption.

### Steps

1. **Cross-channel performance** (`insights.ts`, schema)
   - Add `channelCompare(rows: ChannelViews[], metric: "views" | "engagement"): { channel: string; score: number }[]`
   - `ChannelViews` interface: `{ channel: string; hour: number; views: number; members: number }`
   - Returns channels ranked by the metric at each hour slot
   - Desk command `/benchmark` shows top 3 channels by view rate
   - Migration: `v_channel_benchmarks` view joining `v_post_engagement` across channels

2. **Research checkpoint advancement** (`research.ts`, schema)
   - New table: `research_checkpoints(run_id uuid, step text, cursor jsonb, completed_at timestamptz, primary key(run_id, step))`
   - Each research function in `research.ts`:
     - `expandPersonas()`: INSERT checkpoint('expand_personas', 'started') at entry, UPDATE on completion
     - `scoreTopics()`: INSERT checkpoint('score_topics', { persona_count }) — cursor holds the last processed persona
     - `buildBrief()`: INSERT checkpoint('build_brief', 'started') -> UPDATE with brief_id
   - On crash: `GET /research/resume` reads the last checkpoint and dispatches to the right function with the stored cursor
   - `research/brief` endpoint accepts `?resume=true`

3. **Signal ledger traceability** (`insights.ts`)
   - Add `signalPath(signalId: string): SignalStep[]`
   - `SignalStep` interface: `{ step: "alert" | "draft" | "approved" | "posted" | "result" | "board"; at: string | null; actor: string | null; ref: string | null }`
   - Joins `signals`, `content_items` (signal_id FK), `publish_jobs`, `tg_posts`, `signal_posts`, `signal_outcomes`
   - Desk command `/signal <short_id>` shows the full chain
   - Uses `shortIdRange()` pattern from `content.ts` for ID resolution

### Files changed
- `supabase/functions/_shared/insights.ts` — channelCompare, signalPath
- `supabase/functions/_shared/research.ts` — checkpoint calls in expandPersonas, scoreTopics, buildBrief
- `supabase/functions/research/brief/index.ts` — `?resume=true` flag
- `supabase/functions/tg-webhook/index.ts` — `/signal <id>` command
- `supabase/migrations/20261014000004_research_checkpoints.sql`
- `supabase/migrations/20261014000005_channel_benchmarks.sql`

### Tests
- `insights_test.ts` — channelCompare: 3 channels, 24h each, correct ranking
- `insights_test.ts` — signalPath: full chain, nulls when step missing
- `research_test.ts` — checkpoint inserted at each step, resume reads last
- `_shared/nav_test.ts` — /signal command resolves and renders path

---

## Phase 7 — Studio pipeline

**Goal:** Scene-aware clip generation with hook overlays and word-level captions.

### Steps

1. **Scene detection** (`workers/pc/studio/moments.py`)
   - Add `detect_scenes(video_path, threshold=0.3)` — uses ffmpeg's `select` filter with `scene` detection
   - Returns list of `{ start_s, end_s, confidence }`
   - Add `score_moments(scenes, transcript_words, price_data)` — scores each scene by keyword density and price delta (from OCR of the chart)
   - Returns scenes sorted by score; top 3 become `clip_candidates` rows

2. **Hook-text overlay** (`workers/pc/studio/moments.py`, `kits.ts`, `insights.ts`)
   - `cover_command` already draws text — extend to overlay on first frame
   - Uses `hookWinner()` from `insights.ts` to pick the winning hook for the pillar
   - Overlay text: the hook text, in EzyMap green (#00C851), semi-transparent background
   - ffmpeg: `drawtext=fontfile=EzyMap.ttf:text=':text':x=(w-text_w)/2:y=h-100:`
   - Add `KIT_COVER_TEXT` field in `kits.ts` per platform/lang

3. **Word-level ASS captions** (`workers/pc/studio/clipper.py`)
   - `ass_words` already generates Dialogue entries from faster-whisper timings
   - Extend to write karaoke-style: each word gets `\k` timestamp for highlight
   - ffmpeg `ass` filter burns the `.ass` file onto the clip
   - Output: `.mp4` + `.ass` + `.srt` (for platforms that need SRT)

### Files changed
- `workers/pc/studio/moments.py` — detect_scenes, score_moments, overlay
- `workers/pc/studio/clipper.py` — ass_words karaoke extension
- `supabase/functions/_shared/kits.ts` — KIT_COVER_TEXT field
- `workers/pc/test_studio.py` (new) — scene detection test vectors

### Tests
- `test_studio.py` — detect_scenes: 60s video -> 5 scenes
- `test_studio.py` — score_moments: chart scene with price words scores highest
- `test_studio.py` — ass_words: 3 words -> 3 Dialogue entries with \k timestamps
- `kits_test.ts` — KIT_COVER_TEXT present per platform/lang

---

## Testing strategy

Every phase must pass before the next starts:

1. **Pure function unit tests** (`deno test *_test.ts`) — covers all `_shared/` logic
2. **Integration smoke** (`tests/smoke.sql`) — schema + seed + contract views
3. **Consistency checks** (`tests/check_consistency.py`) — 25+ cross-file assertions
4. **Desk tour** (`scripts/desk-tour.sh`) — end-to-end: /status, /batch, draft, fan-out, reject
5. **CI gate** — `deno check`, `deno lint`, `deno test`, `python3 test_studio.py`, all green

## Rollback plan

Each phase ships as a single git commit. If a phase fails:

1. `git revert <commit>` — the migration is the only irreversible part; for migrations, write a `DOWN` block in the same file and apply via Supabase MCP
2. `scripts/deploy.sh` + `scripts/desk-tour.sh` re-run to confirm the revert is clean
3. Phase does not re-start until the root cause is fixed

## Risk mitigation

- **backoff.ts changes**: covered by `_shared/backoff_test.ts` (existing, 28 tests) — no behavior change unless `jitter: true` is passed
- **tg.ts timeout**: default 30s, never shorter than current behavior; old behavior when `timeoutMs` omitted
- **Schema changes**: all new tables use additive migrations (no column drops, no constraint tightening on existing data)
- **publish/index.ts changes**: claim batch is bounded; unclaimed jobs roll to next tick (pg_cron every minute)
- **content.ts hooks**: afterApprove/afterReject are extracts of existing inline code in approve/index.ts — no behavior change, just refactor
