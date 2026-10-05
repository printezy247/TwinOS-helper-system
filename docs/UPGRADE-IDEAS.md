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
9. **RSS macro digest** — turn a macro feed into the 08:15 card. *Built:*
   the feed reader (`POST /research/feeds`, `feeds` + `feed_items`, RSS 2.0 and
   Atom, 6-hourly cron, `twinos_feeds` / `twinos_research` in ABDUL). Feeds are
   read into the Desk, never auto-posted; the card itself is still Jack's.
   *(rss-feed-telegram-bot, RSSHub.)*
   *Was the only item in this list waiting on a value from Jack — a published
   feed needs no account, so the reader was the part that could be built.*

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

## Second wave — social research, posting, channels (2026-10-05)

Six more, from a pass over what trending calls social listening and channel
research. The same method rules hold, and they are the reason half of this
list is where it is: Bluesky's public AppView and Mastodon's tag timeline are
published APIs, and a reference channel's member count comes from the Bot API,
which only answers for a channel the bot is already in. Nothing here scrapes,
and nothing posts.

22. **Social sources beyond RSS** — Bluesky keyword search and a Mastodon tag
    timeline through the same reader. *Built:* `feeds.kind` gains `bluesky`
    and `mastodon` (migration `20261005070000`), `parseJsonFeed` in
    `_shared/feed.ts`, same 6-hourly cron.
23. **Search the collected items** — one phrase through titles and summaries.
    *Built:* `twinos_search`. Punctuation is stripped before the term reaches
    the filter, so the search box cannot rewrite its own query.
24. **Post ideas from other people's publishing** — every fresh item that
    mentions one of a persona's own seed questions, ranked by how many it
    mentions, with the matched words on the row. *Built:* `research/ideas` +
    `twinos_ideas`, `pickIdeas` and `personaTerms` in `_shared/research.ts`.
25. **Reference-channel research** — the notes Jack recorded (offer structure,
    how they qualify, disclosures) plus a live member count from the Bot API
    where the bot can see the channel, and an honest reason where it cannot.
    *Built:* `research/channels` + `twinos_channels`, `tmeHandle` for whatever
    he pastes.
26. **Native Telegram polls** — the poll template has promised one since
    Phase 5 (§9.E.36) and every poll has gone out as four lines of prose.
    *Built:* `sendPoll` in `_shared/tg.ts` and `parsePoll` in
    `_shared/content.ts`; the prose around the poll still posts, before and
    after, and a body that does not parse falls back to text unchanged.
27. **Feed-reader staleness** — a 6-hourly reader that stops is invisible
    until the Monday brief comes back empty. *Built:* `feedStale` +
    a Desk alert in `health/check`, at two missed cycles rather than one.

28. **Poll results read back** — the tally, joined to the post that asked it.
    *Built:* `poll_results` + `tg_posts.poll_id` (migration `20261006080000`),
    `onPoll` in `tg-webhook`, `pollSnapshot` in `_shared/tg.ts`, `twinos_polls`
    in ABDUL. The branch handles `update.poll` and nothing else, so the
    approval path is untouched, and `allowed_updates` already listed `poll`.

**Not built, deliberately.** TikTok and X research: no official read that fits
the method rules.
