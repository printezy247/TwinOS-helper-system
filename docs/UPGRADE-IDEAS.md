# Research-driven upgrade ideas (2026-10-02)

Twenty-one ideas from a research pass over GitHub trending (telegram-automation,
content-automation, open-source clip tools), Reddit (r/Supabase, r/selfhosted,
r/Forexstrategy, r/AI_Agents) and 2026 best-times-to-post / Telegram-analytics
studies. Sources are named by where the idea came from, not by deep link, so
nothing here goes stale. Method rules hold for all of them: allowed methods
only, no new paid subscriptions, no scraping.

Status: **built** = in this repo (this wave); **deferred** = deliberately
waiting; **needs Jack** = a decision or a value only he has.

## Reliability

1. **Poison-update guard** — a Telegram update that fails every retry must be
   dropped with a log line, not retried forever. *Built:* `tg_updates.failures`
   (migration 0032), `isPoisonedUpdate` in `_shared/backoff.ts`, drop at 3
   failures in `tg-webhook`. *(r/Supabase background-jobs threads: dead-letter
   instead of hot-looping.)*
2. **Fan-out retries** — per-platform queue with backoff. *Built in PR #53*
   (`fanout_platform` jobs + `content/fanout-drain` cron).
3. **pgmq / Supabase Queues** — GA now, but CI Postgres has no `pgmq`
   extension and the jobs table already does claim/backoff. *Deferred:* revisit
   if queue depth or contention ever hurts. *(r/Supabase.)*
4. **Background tasks** — `EdgeRuntime.waitUntil` for post-send bookkeeping so
   the webhook answers fast. *Deferred:* current send path is inside the 60 s
   window with pacing; add when a real slow call appears.

## Publishing

5. **Burned-in word-level captions** — the standard shorts treatment; one ASS
   Dialogue per word from faster-whisper timings. *Built:* `ass_words` in
   `workers/pc/studio/clipper.py`. *(Open-source Opus-Clip alternatives.)*
6. **Cover thumbnail with the hook text** — first-frame grab + `drawtext`.
   *Built:* `cover_command` in `workers/pc/studio/moments.py`.
7. **Hook A/B by evidence** — track `hook_id` on variants and let numbers pick
   the winner. *Built:* `content_variants.hook_id` (0032), `v_hook_performance`,
   `hookWinner` in `_shared/insights.ts`; `onAdjust` records the hook used.
8. **Signature rotation** — platform signatures from one setting, appended
   once. *Built:* `withSignature` in `_shared/platforms.ts`, read from the
   `platform_signatures` setting in `fanout.ts`.
9. **RSS macro digest** — turn a macro feed into the 08:15 card. *Needs Jack:*
   the feed URL. Only non-self-contained item in this list.

## Growth

10. **Best-times engine** — post-hour performance, not folklore. *Built:*
    `v_best_times` + `bestHours` in `_shared/insights.ts`. *(Best-times studies;
    Telegram is chronological, so timing is one of only two reach levers.)*
11. **Engagement rate** — views-24h ÷ members per day. *Built:*
    `v_post_engagement` + `engagementRate`.
12. **Channel staleness alert** — channels fade after a ~36 h quiet gap. *
    Built:* `channelStale`/`CHANNEL_STALE_MS`, Desk alert `channel-quiet` in
    `health/check`. *(Posting-consistency studies.)*
13. **Hashtag minimum per platform** — warn under the floor (IG/TikTok 3,
    YouTube/X 2, FB/Threads 1, Telegram none). *Built:* `hashtagsMin` +
    warn finding in `_shared/platforms.ts`.

## Trust (the #1 complaint about signal channels)

14. **Signal ledger** — every signal and its result, one queryable truth. *
    Built:* `v_signal_ledger` (0032). *(r/defi: deleted losing trades destroy
    trust faster than losses.)*
15. **No-delete watchdog** — the schema refuses `signal_posts` deletions.
    *Built:* trigger `trg_signal_posts_no_delete` (0032); smoke §25 asserts it.
16. **Humanizer word lists (2026 tells)** — "leverage", "holistic", "in today's
    fast-paced world"… warn-level findings. *Built:* extended
    `HUMANIZER_WORDS_EN/MS` in `_shared/compliance.ts`.

## Monetization

17. **Telegram Stars** — 2026 default for paid channel content. *Needs Jack:*
    Stars is a paid-channel decision; the sales bot already takes Stars, so
    TwinOS only reports it (Phase 8 revenue migration).
18. **Mini App stats surface** — the `/mini` approval view exists (Wave 4.1);
    an engagement-stats tab can ride the Insights view. *Built (read-only):*
    Lovable prompt 5 in `docs/LOVABLE-WAVE4-PROMPTS.md`.
19. **Ad revenue share readiness** — per-campaign cost per depositor already
    exists (`v_campaign_cost`); a share-of-revenue row waits for the paid-ads
    pilot and the lawyer's opinion (decision 7). *Needs Jack.*

## ABDUL (MCP)

20. **Research verbs** — `twinos_analytics` can now read `v_best_times`,
    `v_post_engagement`, `v_hook_performance`, `v_signal_ledger` alongside the
    older views. *Built:* `ANALYTICS_VIEWS` in `apps/mcp/twinos_mcp.py`.
21. **Scheduler beats as MCP reads** — the `health_checks` beats already carry
    provider and queue state (`twinos_health`). *Built:* nothing new needed.
