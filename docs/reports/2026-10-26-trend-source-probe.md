# Trend source probe (Phase E4) — 2026-10-26

Research only. No production code was written. This picks a data vendor for one
question: "what happened to each video from this handle, in views, this week?"
Research proposes topics; results need per-video views from platforms we cannot
read with our own tokens (TikTok gives view counts only for *our* videos, not for
the handles we watch).

## 1. The adapter interface

One method, same doc-comment style as `supabase/functions/_shared/platforms.ts`.
Everything else (caching, storage, dedupe) stays on our side.

```ts
/** One row: what happened to one video of a watched handle. */
export interface TrendRow {
  /** The platform's own id for the video (stable across calls). */
  videoId: string;
  /** The public URL, so a human can open it and check. */
  permalink: string;
  /** Views at the time of reading, never a guess. */
  views: number;
  /** When the video was published, ISO 8601 UTC. */
  postedAt: string;
}

/** A trend source: per-video views for one handle inside one window.
 *  since/until are ISO 8601 dates (UTC). An empty array is a valid answer —
 *  the handle posted nothing in the window. A throw means the provider failed;
 *  callers must record it, never treat it as zero. */
export interface TrendSource {
  videoViews(handle: string, since: string, until: string): Promise<TrendRow[]>;
}
```

Cost of one "lookup" below = one call covering one handle for one window
(paginated by the provider; a handle with 30 new videos is still ~1–3 calls).

## 2. Candidates (accessed 2026-10-26)

### TikTok Research API — official, but closed to us
- Price: free, but by application only.
- TikTok coverage: yes — official per-video view data, incl. accounts you do not own.
- Terms: eligibility is limited to academic institutions and not-for-profit
  organisations (regional pilots included). A commercial content operation is not
  the intended user; review takes weeks to months.
- Verdict: not available for TwinOS. Kept here so nobody re-explores it.
- URL: https://developers.tiktok.com/products/research-api/

### Apify — TikTok Scraper (clockworks/tiktok-scraper)
- Price: "from $1.70 / 1,000 results" on the actor page; Apify platform itself
  starts with a $5 free credit, paid plans $19–$999/mo (usage-based under it).
  A weekly sweep of ~20 handles ≈ a few thousand results ≈ single-digit dollars.
- TikTok coverage: yes — per-video records with playCount (views), id, timestamp,
  URL; profile and search modes paginate.
- Terms: a scraping marketplace; the actor pages state results are your own data.
  Collection risk sits with Apify/the actor developer, not with our IP.
- Failure mode: actors break silently when TikTok changes — 4.7★/370-review
  actor usually patches within days, but a week of missing rows is possible.

### ScrapeCreators — pay-as-you-go API
- Price: credit model; ~1 credit per TikTok request, sign-up free credits ≈ 1,000,
  paid tiers from ≈ $10/mo for thousands of credits (their pricing page; JS app —
  numbers from search summary, confirm on signup).
- TikTok coverage: yes — user-posts and video-meta endpoints return play counts.
- Terms: same scraping-API category as Apify; data is ours after the call.
- Failure mode: smaller company, thinner SLA; per-endpoint credit costs vary
  (2–5 for heavier endpoints), so budgets need a cap.

### EnsembleData — platform-subscription API
- Price: tiers $100 / $200 / $400 / $800 / $1,400 per month (Bronze→Diamond);
  each tier includes a monthly request quota (exact numbers inside the dashboard).
- TikTok coverage: yes — TikTok is a listed platform (user videos with views).
- Terms: paid API reseller; contract is a straight monthly subscription.
- Failure mode: minimum $100/mo even for a handful of handles — wrong shape for
  our volume (one weekly sweep of ~20 handles ≈ a few hundred calls).

## 3. Recommendation

**Apify (clockworks/tiktok-scraper)**, pay-per-result. Rationale: no monthly
minimum, per-video views are its native output, the actor is the most-used and
most-audited one we found, and $1.70 per 1,000 results puts a full weekly watch
list at coffee money. ScrapeCreators is the backup if Apify's proxy region ever
drops coverage.

Next step (when Jack wants it built): implement `TrendSource` for Apify behind a
run-now cap (max results per sweep) and store rows with the fetched-at date, so
the scoring loop can see *when* a view count was true.

## Sources (accessed 2026-10-26)
- https://developers.tiktok.com/products/research-api/
- https://apify.com/clockworks/tiktok-scraper
- https://apify.com/pricing
- https://scrapecreators.com/pricing
- https://www.ensembledata.com/pricing
