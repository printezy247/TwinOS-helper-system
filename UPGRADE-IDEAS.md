# TwinOS Upgrade Ideas (research 2026-10-02, synthesized 2026-10-14)

Trending repository patterns mapped to the TwinOS codebase, organized into seven phases. Each idea names the target file, the concrete change, and an effort/risk rating. Method rules hold: allowed methods only, no new paid subscriptions, no scraping.

**Effort scale:** S = small (under 1 day) · M = medium (1–3 days) · L = large (3–10 days) · XL = multi-phase or architectural
**Risk scale:** low = pure functions, covered by tests · medium = touches live publishing or the Desk flow · high = changes error handling, idempotency, or secrets

---

## Phase 1 — Bot API hardening (grammY, telegraf, nestjs-telegraf)

### 1.1 Middleware-style error classification pipeline

**Source:** grammY (Deno-native, typed middleware, `handleError` context)
**Target file(s):** `supabase/functions/_shared/tg.ts`, `_shared/backoff.ts`
**Concrete change:** Replace the monolithic `classify()` in `backoff.ts` with a grammY-style middleware stack: `TgError` → `MetaError` → transport → generic. Each middleware layer decides throttled/permanent/unknown and passes the rest down. Add a `classifyContext` interface so the publisher and tg-webhook both use the same stack. This keeps the existing `TgError.code` checks (429, 5xx, 401/403) but makes the pipeline testable per-layer.
**Effort:** M | **Risk:** medium (changes error routing in publish/index.ts and fanout.ts)

### 1.2 Bot instance factory for multi-token support

**Source:** nestjs-telegraf (multiple bot instances, token-scoped clients)
**Target file(s):** `supabase/functions/_shared/tg.ts`, `_shared/supabase.ts`
**Concrete change:** Introduce a `TelegramClient` wrapper that reads the bot token from `setting("telegram_bot_token")` once per process, caches it, and supports named bot slots. Today `tg.ts` calls `common()` which reads the token from env on every request — a factory pattern lets the webhook, publisher, and Desk each resolve the right token without re-reading secrets. Add a `tgClients` map in `supabase.ts`.
**Effort:** M | **Risk:** low

### 1.3 Stateful callback routing with stale-menu detection

**Source:** grammY menu pattern (stateless menus with stale-tap detection), aiogram-dialog (screen router)
**Target file(s):** `supabase/functions/_shared/tg.ts`, `supabase/functions/tg-webhook/index.ts`
**Concrete change:** The callback grammar v2 (`nav:`, `pg:`, `nop`) is already built. Extend `isStaleFp()` in `tg.ts` to carry a schema version hash (like grammY's layout fingerprint): when a user taps an old menu, the webhook compares the fingerprint in `callback_data` against the current `NAV_LAYOUT` constant and answers "outdated, redrawing" instead of executing a stale action. Add a `MENU_LAYOUT_VERSION` constant.
**Effort:** S — already partially built; add fingerprint propagation | **Risk:** low

### 1.4 Long-polling fallback for non-webhook environments

**Source:** telegraf (long polling + webhook both supported)
**Target file(s):** `supabase/functions/_shared/tg.ts`, `supabase/functions/tg-webhook/index.ts`
**Concrete change:** Add a `pollUpdates()` function that long-polls `getUpdates` with optional offset, for development or when the webhook URL is unreachable. This mirrors how telegraf's `launch()` picks webhook vs polling. The existing `call()` already handles retries; polling just needs a loop with `timeout: 30` and offset tracking.
**Effort:** S | **Risk:** low

---

## Phase 2 — Retry and backoff with jitter (lifeomic/attempt, bottleneck)

### 2.1 Jittered exponential backoff

**Source:** lifeomic/attempt (exponential backoff with jitter, `factor`, `min`, `max`, `randomize`)
**Target file(s):** `supabase/functions/_shared/backoff.ts`
**Concrete change:** The current `backoffMs(attempts)` computes `30_000 * 2 ** max(attempts-1, 0)` with no jitter. Add full jitter: `Math.random() * backoffMs(attempts)` to prevent thundering herds across retries of the same failed post. Add a `BACKOFF_JITTER = 0.5` constant and a `jitteredBackoff()` function that callers in `publish/index.ts` and `fanout.ts` opt into. Keep `backoffMs` pure and unchanged for testability.
**Effort:** S | **Risk:** low

### 2.2 Timeout + cancel token for transport failures

**Source:** lifeomic/attempt (timeout handling, `handleTimeout` fallback)
**Target file(s):** `supabase/functions/_shared/tg.ts`, `_shared/backoff.ts`
**Concrete change:** `tg.call()` currently sets `Deno.connect` timeout via the fetch but has no `AbortController` per attempt. Add a `timeoutMs` option to `call()` that creates an `AbortController`, races fetch against `setTimeout`, and classifies the abort as `unknown` (transport failure) rather than `throttled`. This feeds the existing `isUnknownOutcome()` regex in `backoff.ts`. Wire it so `UNKNOWN_HOLD_MS` (10 min) applies.
**Effort:** M | **Risk:** medium (changes the Bot API transport path)

### 2.3 Bottleneck-style rate limiter for publish jobs

**Source:** bottleneck (WeightedRateLimiter, token bucket, reservoir, overflow strategies)
**Target file(s):** `supabase/functions/publish/index.ts`, `_shared/backoff.ts`
**Concrete change:** The publisher runs every minute from pg_cron and sends one job per tick (pace `PACE_MS = 1100` between sends). Add a `RateLimiter` class in `backoff.ts` that implements a token-bucket with capacity equal to a platform's daily cap divided by the number of publisher ticks in a day. `claimOne()` in `publish/index.ts` consults the limiter before sending: if tokens are exhausted, the job is requeued with `CAP_HOLD_MS` (already exists) instead of burning an attempt. This prevents 429s from Meta's 100/30/250 daily caps at `meta.ts` `DAILY_CAPS`.
**Effort:** M | **Risk:** medium (changes publish job claiming)

---

## Phase 3 — Job queue reliability (susu-indexer, postmill-ai)

### 3.1 Idempotent job claim with unique constraint

**Source:** susu-indexer (idempotent runs, unique constraints on cursor/ledger range)
**Target file(s):** `supabase/functions/_shared/idempotency.ts`, `supabase/migrations/`
**Concrete change:** The `idempotency_keys` table uses `(scope, key)` as PK — a solid pattern. Extend `replay()` in `idempotency.ts` to also claim publish jobs and fan-out jobs atomically: an insert into a new `job_claims` table with `(job_id, worker_id)` as PK. If two publisher ticks race, only one wins; the other gets a 409 and skips. This mirrors susu-indexer's "two concurrent callers with the same key cannot both win the primary key" pattern.
**Effort:** M | **Risk:** medium (schema change + publish/index.ts)

### 3.2 Bounded job runs (max range per cycle)

**Source:** susu-indexer (`INDEXER_MAX_LEDGER_RANGE` — bounded runs so one stuck cycle doesn't starve others)
**Target file(s):** `supabase/functions/publish/index.ts`, `supabase/functions/_shared/fanout.ts`
**Concrete change:** `publish/index.ts` claims all due `publish_jobs` in one `UPDATE ... WHERE status='queued'` and processes them in a loop. Add a `MAX_JOBS_PER_TICK = 10` constant so a stuck publisher cycle doesn't hold the claim lock forever. Unclaimed jobs stay queued and roll to the next tick (which fires every minute via pg_cron). Same pattern for `fanout.ts` — bound the per-call platform loop.
**Effort:** S | **Risk:** low

### 3.3 Dead-letter queue for permanently failed jobs

**Source:** postmill-ai (Inngest background jobs with retries, dead-letter patterns; r/Supabase dead-letter threads)
**Target file(s):** `supabase/functions/publish/index.ts`, `_shared/backoff.ts`
**Concrete change:** When `classify()` returns `permanent` and `attempts >= MAX_ATTEMPTS`, instead of leaving the job in `failed` status, insert a row into a new `dead_letter_jobs` table with the job_id, error, and a `desk_alert_key` so `alerts.ts` can surface it to the Desk. Add a `DLQ_THRESHOLD_MS` constant. The Desk alert uses `deskAlert()` with cooldown so Jack isn't spammed.
**Effort:** L | **Risk:** high (new table + migration + publish path change)

---

## Phase 4 — Content variant management (p-limit, postmill-ai)

### 4.1 Concurrency limiter for AI variant generation

**Source:** p-limit (concurrency limiting via promises, `pLimit(n)`)
**Target file(s):** `supabase/functions/_shared/content.ts`, `workers/pc/job_llm_variants`
**Concrete change:** The `llm_variants` PC worker job generates 3 angles per platform sequentially. Add a `ConcurrencyLimiter` class (mirroring p-limit's API: `limit(fn)`) in `content.ts` that caps concurrent AI calls to `Math.min(platform_count, 3)`. The worker calls `await limit(() => generateAngle(platform))` for each platform. This prevents the local llama-server from being overwhelmed by 21 parallel requests (3 angles × 7 platforms).
**Effort:** S | **Risk:** low

### 4.2 Variant selection UI pattern (pick-one, reject-rest)

**Source:** postmill-ai (cross-channel comment inbox with selection pattern)
**Target file(s):** `supabase/functions/tg-webhook/index.ts`, `_shared/content.ts`, `_shared/platforms.ts`
**Concrete change:** When `llm_variants` produces 3 angles for a platform variant, the Desk card currently shows all three. Add a `pickVariant()` RPC in `content.ts` that marks the picked variant (`source.picked = true`) and rejects the others (`source.picked = false`, `source.rejected_at = now()`). The `isPublishableVariant()` function in `platforms.ts` already checks `source.picked === true` — extend it to also exclude `source.rejected_at IS NOT NULL`. Wire the `pk:<variant_short>` callback in `tg-webhook` to call this RPC.
**Effort:** M | **Risk:** medium (Desk callback + RPC + variant query filter)

### 4.3 Fan-out drain with per-platform retry isolation

**Source:** postmill-ai (Inngest background jobs)
**Target file(s):** `supabase/functions/_shared/fanout.ts`, `supabase/functions/content/`
**Concrete change:** `fanout.ts` already queues `fanout_platform` jobs on failure. Add a `fanout_drain()` function that claims one queued retry per call (like `publish/index.ts:claimOne`), processes it, and requeues with `backoffMs()`. The cron `content/fanout-drain` fires every minute. Add `FANOUT_STUCK_THRESHOLD = 5` (already exists in `fanout.ts:25`) — when the retry queue hits 5, page the Desk via `deskAlert("fanout-stuck")`.
**Effort:** M | **Risk:** medium (new cron + drain function)

---

## Phase 5 — Scheduling and approval workflows (strapi-plugin-scheduler, strapi-plugin-publisher)

### 5.1 Date/time UI for scheduling with timezone awareness

**Source:** strapi-plugin-scheduler (date/time selection UI, cron expression generation)
**Target file(s):** `supabase/functions/_shared/hours.ts`, `apps/dashboard/src/components/...` (Lovable)
**Concrete change:** TwinOS uses `/hours <HH:MM>` in the Desk group for scheduling. Add a `parseScheduleSlot()` function in `hours.ts` that accepts natural language ("tomorrow 8am", "next Monday 13:00") and returns an ISO timestamp in the configured timezone (`setting("timezone")`). The Lovable dashboard's Calendar screen calls this via `POST /content/{id}/reschedule`. Store the result in `content_items.scheduled_at`.
**Effort:** S | **Risk:** low

### 5.2 beforeSchedule / afterSchedule hooks for content lifecycle

**Source:** strapi-plugin-publisher (`beforePublish` / `afterPublish` hooks, `syncFrequency`)
**Target file(s):** `supabase/functions/_shared/content.ts`, `_shared/desk.ts`
**Concrete change:** `createDraft()` and `setStatus()` in `content.ts` are the publish/approve boundaries. Add hook points: `afterApprove(content_id)` runs compliance checks on all variants and enqueues publish jobs; `afterReject(content_id)` cancels queued publish jobs and notifies the Desk. Currently the approve endpoint in `approve/index.ts` does this inline — extract into `content.ts` functions so both the Desk and dashboard use the same path. Add a `cancelScheduledJobs(content_id)` RPC.
**Effort:** M | **Risk:** medium

### 5.3 Calendar view with per-slot status

**Source:** Postiz (scheduler UX: per-platform preview, saved templates, delayed first comment)
**Target file(s):** `apps/dashboard/src/components/Calendar.tsx`, `supabase/functions/content/`
**Concrete change:** The dashboard Calendar screen shows scheduled posts. Add a `GET /content/calendar?date=YYYY-MM-DD` endpoint that returns all items scheduled that day with their variant statuses (draft, approved, scheduled, published). Each Calendar cell shows a color-coded badge per platform (green=ready, yellow=pending, red=blocked). The existing `v_content_log` view can feed this with a date filter.
**Effort:** L | **Risk:** medium (dashboard component + new endpoint)

---

## Phase 6 — Insights and analytics (postmill-ai cross-channel, susu checkpointing)

### 6.1 Cross-channel performance comparison

**Source:** postmill-ai (45+ channels, cross-channel comment inbox)
**Target file(s):** `supabase/functions/_shared/insights.ts`, `supabase/migrations/`
**Concrete change:** `insights.ts` has `bestHours()` and `engagementRate()` per post. Add `channelCompare(channels: string[], metric: "views" | "engagement"): { channel: string; score: number }[]` that joins `v_post_engagement` across multiple channels and returns which performs best per time slot. Store results in a new `channel_benchmarks` table. The Desk `/benchmark` command shows the comparison.
**Effort:** M | **Risk:** low

### 6.2 Checkpoint advancement for research runs

**Source:** susu-indexer (checkpoint advancement, cursor-based progress)
**Target file(s):** `supabase/functions/_shared/research.ts`, `supabase/functions/research/`
**Concrete change:** `research.ts` has `pickIdeas()` and `buildBrief()` which run on Monday. Add a `research_checkpoints` table with `(run_id, step, cursor, completed_at)`. Each research function (autocomplete expansion, topic scoring, brief generation) inserts a checkpoint row before and updates it after. If a run crashes, `research/brief` resumes from the last completed step instead of starting over.
**Effort:** M | **Risk:** medium (schema + research.ts refactor)

### 6.3 Signal ledger with full traceability

**Source:** postmill-ai (evidence trail per unit)
**Target file(s):** `supabase/functions/_shared/insights.ts`, `supabase/migrations/`
**Concrete change:** The existing `v_signal_ledger` view (migration 0032) tracks signals and outcomes. Extend `insights.ts` with `signalPath(signal_id)` that returns the full chain: TradingView alert → signal_card draft → approved → posted → result_reply → board status change. Each step reads from `signals`, `content_items`, `publish_jobs`, `tg_posts`, `signal_posts`, `signal_outcomes`. Render as an inline Desk command `/signal <id>`.
**Effort:** M | **Risk:** low

---

## Phase 7 — Content studio pipeline (OpenShorts patterns)

### 7.1 Scene detection and moment scoring

**Source:** OpenShorts (scene detection, AI moment scoring, face-following vertical reframe)
**Target file(s):** `workers/pc/studio/moments.py`, `workers/pc/studio/clipper.py`
**Concrete change:** `clipper.py` currently does transcript → highlight picks → SRT → clean clips. Add `detectScenes()` that uses ffmpeg's `select` filter to find shot boundaries, and `scoreMoments()` that scores each scene by keyword density + chart movement (price delta in the frame via OCR). The existing `studio/moments.py` already has `cover_command` — extend it with scene-aware reframe: `ffmpeg -i in.mp4 -vf "cropdetect,scale=1080:1920:force_original"`.
**Effort:** L | **Risk:** medium (PC worker, ffmpeg pipeline)

### 7.2 Hook-text overlay on first frame

**Source:** OpenShorts (hook overlay), the kit's cover text (§4.7, FYP)
**Target file(s):** `workers/pc/studio/moments.py`, `_shared/insights.ts`
**Concrete change:** `cover_command` in `moments.py` already draws text on the cover. Extend it to overlay on first frame. Uses `hookWinner()` from `insights.ts` to pick the winning hook for the pillar. Overlay text: the hook text, in EzyMap green (#00C851), semi-transparent background. ffmpeg: `drawtext=fontfile=EzyMap.ttf:text=':text':x=(w-text_w)/2:y=h-100:`. Add `KIT_COVER_TEXT` field in `kits.ts` per platform/lang.
**Effort:** S | **Risk:** low

### 7.3 Word-level burned-in captions

**Source:** OpenShorts alternatives (standard shorts treatment with ASS Dialogue per word)
**Target file(s):** `workers/pc/studio/clipper.py`
**Concrete change:** The `ass_words` function (already built, per `UPGRADE-IDEAS.md` item 5) generates ASS Dialogue entries from faster-whisper timings. Extend the SRT output to also write an `.ass` file with karaoke-style word highlighting: each word gets a `\k` timestamp entry. The `clipper.py` pipeline then burns this onto the video via `AssFilter` in ffmpeg.
**Effort:** S | **Risk:** low
