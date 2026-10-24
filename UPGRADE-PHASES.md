# TwinOS Upgrade Plan — Phased

Based on research of 27 trending repos (Oct 2026), deep code review of both repos, and the existing UPGRADE-PLAN.md roadmap.

---

## Executive Summary

**Backend (main repo)**: Already ships all 7 trending patterns (classification pipeline, jittered backoff, token-bucket rate limiter, bound bot client, stale-layout fingerprints, long-polling fallback, idempotent job claim). CI enforces Deno check/lint/test + schema drift guard + secret scan. No backend upgrade owed from trending.

**Dashboard (mirror-hub)**: Modern stack (TanStack Start + React 19 + Tailwind v4 + TanStack Query + Supabase realtime). Tests cover 16 areas. CI: bun lint/test/tsc/build. Phase 0 fixes done (P0-1..P0-11).

**Resolved 24 Oct**: the realtime publication migrations (20261022000000, 20261023000000, 20261023000100) **are applied to the live DB** — 51/51 migrations tracked, 19 tables in `supabase_realtime`, and a live INSERT delivery was observed from a signed-in Jack session. The remaining gap below is closed.

**Jack actions required** (unblocked):
1. ~~Apply realtime migrations to live DB~~ — done 24 Oct (guard fix 20261024000000 also applied; functions redeployed with `scripts/deploy.sh`)
2. Sign in as Jack in dashboard preview
3. Test `/mini` from EzyMap Desk in Telegram (screen is built; register it with @BotFather first)
4. Decide: health stale threshold (6h), inbox badge counts drafts

---

## Phase 1 — Unblock Realtime & Verify Live (1 day)

**Owner**: Jack (with Codex assist)

| Task | Command | Verification |
|------|---------|--------------|
| Apply 3 pending realtime migrations | `supabase migration list --linked` → confirm 50 applied → `supabase db query --linked "select 1"` (runs migrations) | `supabase inspect db publications --linked` shows feeds, jobs, platform_accounts, etc. in supabase_realtime |
| Deploy edge functions | `scripts/deploy.sh` | `supabase functions list --linked` all 18 functions deployed |
| Sign in as Jack in Lovable preview | Open mirror-hub preview URL, auth as Jack | Compose → draft post → approve → schedule works |
| Test `/mini` from Telegram Desk | Send `/mini` in Desk group | Mini-app opens, shows research feeds/channels |
| Decide stale threshold & badge | Set `health_stale_threshold_hours` in Settings; toggle `inbox_badge_counts_drafts` | Health page shows correct stale count; Inbox badge matches decision |

**Exit criteria**: All realtime subscriptions deliver live updates; Jack can compose/approve/schedule from dashboard; `/mini` works; decisions recorded in Settings.

---

## Phase 2 — Phase 2 Dashboard Buttons (2–3 days)

**Owner**: Codex (PRs on mirror-hub), Jack reviews/merges

**Pattern**: Each button = role-gated, internal-hop (`x-twinos-internal` + derived secret + Jack-id recheck), calls existing backend endpoint, shows toast on success/failure.

| Batch | Buttons | Backend endpoint | Notes |
|-------|---------|------------------|-------|
| A | Research: Poll all feeds, Refresh channel stats; Friday: Export CSV | `research/feeds`, `research/channels`, `friday/export` | Already in roadmap; `research/feeds` polls all active feeds, `research/channels` refreshes platform_accounts stats |
| B | Content: Build batch, Annual offer template, Fan-out to platforms | `content/batch`, `content/annual-offer`, `content/{id}/fanout` | `content.batch` + `jobs.enqueue` verbs already have permission rows |
| C | Metrics: Snapshots + Benchmarks refresh; Jobs: Per-item "Re-run"; Desk: Internal output button | `metrics/snapshots`, `metrics/benchmarks`, `jobs/enqueue` (per-item), `desk/output` | Verify Insights refresh buttons already call these first |

**Implementation**: Add buttons in existing UI locations (Research page toolbar, Friday header, Compose footer, Signals page, Jobs page, Desk connector). Each PR < 200 lines.

**Exit criteria**: All 10 buttons wired, role-gated, tested by Jack in preview, CI green.

---

## Phase 3 — Mirror-Hub Hardening (1 week, parallelizable)

**Owner**: Codex (parallel PRs)

| Area | Work | Tests to add |
|------|------|--------------|
| **Type safety** | Enable `strict: true` in tsconfig; fix `any` in 12 files (esp. `queries.ts` table generics, `AiAssistantDialog` mode types) | `tsc --noEmit` clean |
| **Error boundaries** | Wrap each shell route in `<ErrorBoundary>`; add fallback UI with "Copy error" button | Integration test: throw in route → boundary catches |
| **Loading/skeleton states** | Add `react-query` `placeholderData` + skeleton components for all 14 main queries | Visual regression: slow network → skeletons show |
| **Accessibility** | Fix `a11y-gates.test.ts` failures: missing labels on 3 dialogs, color contrast on gold badges, focus trap in CommandPalette | `axe-core` in CI |
| **Realtime resilience** | Add `useRealtimeInvalidation` reconnection toast; exponential backoff on subscribe failure | Kill DB connection → toast appears → reconnect → cache invalidates |
| **Mobile UX** | Fix 36px touch targets on Compose (platform pills, lang switch), Calendar (day cells), Settings (toggle rows) | `a11y-gates.test.ts` includes touch-target check |
| **Command palette** | Add `/research feeds`, `/research channels`, `/friday export`, `/content fanout` commands | `command-palette.test.tsx` |
| **Bundle analysis** | Add `vite-plugin-bundle-analyzer`; split heavy routes (calendar, compose, research) with `lazy()` | Bundle < 200KB initial; each route chunk < 100KB |

---

## Phase 4 — Backend Observability & Reliability (1 week)

**Owner**: Codex (main repo)

| Work | Why | Verification |
|------|-----|--------------|
| **Structured logging** | Replace `console.log` in `_shared/log.ts` with pino-style JSON; add `trace_id` propagation across edge functions | Logs in Supabase Dashboard are queryable by `trace_id` |
| **Metrics endpoint** | Add `/metrics` to each function (Prometheus format): request duration, error rate, queue depth, rate-limiter saturation | Grafana dashboard shows p95 latency < 500ms for all endpoints |
| **Distributed tracing** | Propagate `traceparent` header through fanout, publish, jobs, research pipelines | Jaeger/Zipkin trace shows full request flow |
| **Health check depth** | Extend `health/check` to verify: DB connectivity, realtime pub/sub, OpenRouter key validity, Telegram webhook reachable, storage bucket writable | `health/check` returns `{ok, checks: {db, realtime, openrouter, telegram, storage}}` |
| **Alerting rules** | Add 3 Supabase Database Webhooks: failed jobs > 5/min, open alerts > 10, stale beats > 3 | Alert fires in Slack/Telegram within 60s of condition |
| **Rate-limiter visibility** | Export `RateLimiter.available()` via `/health/ratelimit`; dashboard shows per-client remaining | Dashboard Health page shows rate-limiter status per integration |

---

## Phase 5 — AI Content Pipeline (2 weeks)

**Owner**: Codex (main repo + mirror-hub)

**Context**: OpenRouter integration exists (`/ai/generate` endpoint, `AiAssistantDialog` on dashboard). Trending shows: `paperclipai/paperclip` (106k⭐ agent management), `langfuse/langfuse` (36k⭐ LLM evals), `mem0ai/mem0` (67k⭐ agent memory).

| Component | Work | Integration |
|-----------|------|-------------|
| **Prompt library** | Versioned prompts in `supabase/prompts/` (SQL migration + seed); each prompt has `version`, `mode`, `platform`, `pillar`, `lang` | `/ai/generate` reads `prompt_version` setting; dashboard shows prompt picker |
| **Eval harness** | Add `supabase/functions/ai-eval/index.ts`: runs prompt regression suite against golden outputs; stores results in `ai_eval_runs` | CI runs eval on prompt changes; dashboard shows pass/fail per prompt |
| **Memory layer** | Integrate `mem0ai/mem0` pattern: store user preferences, successful hooks, compliance corrections in `ai_memory` table; inject as few-shot examples | `/ai/generate` prepends 3 relevant memories to system prompt |
| **Compliance co-pilot** | Real-time compliance suggestions in Compose (debounced 500ms): show findings inline, auto-fix risk lines, suggest CTA placement | Mirror-hub Compose shows compliance sidebar; "Apply fix" button |
| **Hook A/B** | Extend `content_variants.hook_id` + `v_hook_performance` view; dashboard shows hook win rate per pillar/platform | Friday scoreboard includes hook performance |

**Exit criteria**: Prompt library versioned; eval suite runs in CI; memory improves draft quality (measured by approval rate); compliance co-pilot reduces blocking findings by >50%.

---

## Phase 6 — Video/Clipping Pipeline (2 weeks)

**Owner**: Codex (workers/pc + mirror-hub)

**Context**: `workers/pc/studio/clipper.py` is a Phase 5 stub. Trending: `heygen-com/hyperframes` (71k⭐ HTML→video), `remotion-dev/remotion` (66k⭐ React→video).

| Work | Tech | Integration |
|------|------|-------------|
| **GPU transcription** | Complete `studio/clipper.py`: faster-whisper + CTranslate2 on CUDA; word timestamps → highlight detection (keywords: gold, level, zone, entry, stop, TP, lesson, risk, map, EMAs) | Worker claims `clip_candidate` jobs; writes clips to `storage/clips/{content_id}/` |
| **CapCut-ready output** | Each clip: `clip_N.mp4` + `clip_N.srt` + `clips.json` (metadata: hook, score, keywords, suggested cover text) | Dashboard Clips page lists candidates; Jack approves → fanout to TikTok/Reels/Shorts |
| **Scheduler integration** | `content/batch` endpoint creates `clip_candidate` rows for published `map_recap`/`lesson` posts | Weekly batch includes clip candidates automatically |
| **Dashboard Clips page** | Mirror-hub route `/clips`: grid of candidates with preview, waveform, transcript, approve/reject | Reuses `ResponsiveDialog` + `video` element; realtime updates via `clip_candidates` subscription |

**Exit criteria**: Worker produces CapCut-ready clips from live recordings; dashboard shows candidates; Jack can approve → auto-fanout to vertical platforms.

---

## Phase 7 — Community & Growth (2 weeks)

**Owner**: Codex (main repo + mirror-hub)

**Context**: Trending shows `n8n-io/n8n` (208k⭐ workflow automation), `activepieces/activepieces` (25k⭐ AI agents + 400 MCPs), `twentyhq/twenty` (59k⭐ open Salesforce alt).

| Work | Why |
|------|-----|
| **MCP server** | Expose TwinOS as MCP server: `tools: get_health, get_friday, get_signals, draft_post, approve_post, fanout_post, get_calendar, search_feed` | Agents (Claude, Cursor, Codex) can drive TwinOS natively |
| **Webhook registry** | `webhooks` table + `webhooks/dispatch` function: register URLs per event (post.published, signal.result, alert.fired, friday.done); retry with backoff | External systems (Make, n8n, custom) subscribe to TwinOS events |
| **Public API keys** | Scoped keys (read:health, write:posts, read:signals) + rate limits per key; dashboard manages keys | Partners integrate without Jack's credentials |
| **Referral tracking** | Extend `invite_links` + `member_events` → `v_campaign_cost` already exists; add `v_referral_funnel` (clicks → joins → deposits → IB) | Friday scoreboard shows cost per FTD per campaign |
| **Affiliate dashboard** | Mirror-hub route `/affiliates`: IB accounts, deposits, commissions, payouts | Jack shares with IB partners |

---

## Phase 8 — Platform Expansion (ongoing)

**Owner**: Codex (per platform)

| Platform | Status | Work needed |
|----------|--------|-------------|
| Telegram | ✅ Full | — |
| Instagram | 🟡 Publish only | Add insights (reach, engagement), DM webhook, Story publishing |
| Facebook | 🟡 Publish only | Page insights, Group publishing, Messenger webhook |
| Threads | 🟡 Publish only | Insights, reply webhook |
| YouTube | 🟡 Publish only | Shorts upload, Analytics API, Comment webhook |
| TikTok | 🟡 Publish only | **No official API** — use Postiz pattern: user brings own OAuth app; add `tiktok_webhook` for video metrics |
| X (Twitter) | 🟡 Publish only | OAuth 2.0 + PKCE, Media upload, Analytics, Webhook (Account Activity API) |
| LinkedIn | 🔴 Not started | UGC API + Organization insights |
| Pinterest | 🔴 Not started | Pins API + Analytics |
| Bluesky | 🔴 Not started | AT Protocol + Firehose |
| Discord | 🔴 Not started | Webhook + Bot + Slash commands |
| Slack | 🔴 Not started | Bot + Workflow steps |

**Strategy**: Add 1 platform per sprint. Use Postiz's provider abstraction pattern (`supabase/functions/_shared/platforms.ts` + per-platform adapter).

---

## Phase 9 — Architecture Modernization (ongoing)

| Initiative | Effort | Payoff |
|------------|--------|--------|
| **Replace pg_cron with Trigger.dev / Inngest** | 3 days | Durable execution, retries, observability, local dev; trending: `triggerdotdev/trigger.dev` (16k⭐), `inngest/inngest` (6k⭐) |
| **Supabase Edge Runtime → Deno Deploy / Cloudflare Workers** | 1 week | Lower cold starts, global distribution, cheaper at scale |
| **pgvector for semantic search** | 2 days | Feed item similarity, signal clustering, content dedup; trending: `pgvector/pgvector` (23k⭐) |
| **PostgREST for read-heavy endpoints** | 3 days | Dashboard queries (`health`, `today`, `calendar`, `signals`) become direct PostgREST calls; remove 6 edge functions | `PostgREST/postgrest` (27k⭐) |
| **Drizzle ORM for type-safe SQL** | 1 week | Replace raw SQL in migrations/functions; end-to-end types from DB → TS; trending: `drizzle-team/drizzle-orm` (36k⭐) |

---

## Dependency Graph

```
Phase 1 (Jack) ──► Phase 2 (Codex) ──► Phase 3 (Codex, parallel)
     │                                    │
     ▼                                    ▼
Phase 4 (Codex)                    Phase 5 (Codex)
     │                                    │
     ▼                                    ▼
Phase 6 (Codex) ──► Phase 7 (Codex) ──► Phase 8 (per platform)
     │
     ▼
Phase 9 (ongoing)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Realtime migration fails on live DB | Medium | High | Test on staging first; `supabase db diff --linked` before apply |
| Jack unavailable for decisions | High | Medium | Document defaults (stale=6h, badge=counts drafts); proceed, revisit later |
| MCP server scope creep | Medium | Low | Define 8 tools max for v1; defer others to Phase 7.2 |
| TikTok API instability | High | Medium | Postiz pattern: user brings own app; TwinOS never stores TikTok tokens |
| Worker GPU costs | Low | Medium | `studio/clipper.py` optional extra; run on-demand, not always-on |

---

## Quick Wins (do this week, no phases)

1. **Add `knip` to mirror-hub** — find dead exports (`npx knip` in CI)
2. **Enable `sqlfluff` as error** — currently advisory in CI; make it blocking
3. **Add `supabase inspect db bloat --linked` to weekly cron** — catch table bloat early
4. **Document `scripts/deploy.sh` flags** — `--dry-run`, `--functions-only`, `--migrations-only`
5. **Add `dependabot.yml`** — auto-PR for npm/pip/cargo updates (both repos)

---

## Decision Log (for Jack)

| # | Decision | Default | Deadline |
|---|----------|---------|----------|
| 1 | Health stale threshold | 6 hours | Phase 1 |
| 2 | Inbox badge counts drafts | Yes | Phase 1 |
| 3 | OpenRouter model for production | `openrouter/free` → upgrade to `anthropic/claude-3.5-sonnet` when budget allows | Phase 5 |
| 4 | Clip candidate auto-create trigger | On `map_recap` + `lesson` publish | Phase 6 |
| 5 | MCP server auth | Bearer token (same as edge functions) | Phase 7 |
| 6 | Webhook retry policy | 3× exponential backoff (1m, 5m, 15m) | Phase 7 |
| 7 | Next platform after TikTok | YouTube Shorts (highest ROI for trading content) | Phase 8 |