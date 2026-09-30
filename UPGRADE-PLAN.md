# Jack’s Channel Growth Tool Upgrade Plan

**For:** Jack / EzyMap  
**Prepared:** 1 October 2026  
**Purpose:** Reduce Jack’s manual work across Telegram, TikTok and social-media repurposing.

## 1. Recommendation

Keep the existing EzyMap systems as the centre of the workflow. Jack’s plans already include a sales bot, a Telegram post manager, a content log, a public results board and a weekly TikTok content plan. New tools should fill a specific gap rather than create duplicate shops, schedulers or analytics systems.

### Lean starter stack

| Job | Start with | Why |
|---|---|---|
| Find TikTok topics | [TikTok Creator Search Insights](https://support.tiktok.com/en/using-tiktok/growing-your-audience/creator-search-insights) and [Creative Center](https://ads.tiktok.com/business/creativecenter/) | Free, native topic and trend research |
| Edit shorts | [CapCut](https://www.capcut.com/) | Fits the existing chart-recording, caption and end-card workflow |
| Schedule TikTok | [TikTok Studio](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok) | Native creator tools and analytics |
| Repost to Meta | [Meta Business Suite](https://www.facebook.com/business/tools/meta-business-suite) | Native Facebook and Instagram publishing |
| Publish YouTube Shorts | [YouTube Studio](https://studio.youtube.com/) | Native upload and publishing route |
| Schedule Telegram | Existing `@EzyRegisterBot` post manager and Telegram’s built-in scheduler | Already part of the plan |
| Measure growth | Existing Google Sheet, bot `/stats` tags and distinct invite links | No need to migrate Jack’s content log |

**Paid-tool test:** Try [Metricool](https://metricool.com/) if Jack’s main problem is managing calendars and analytics across platforms. Try [Repurpose.io](https://repurpose.io/) if the main problem is reposting finished videos. They solve different jobs; start with one.

## 2. Telegram tools

### Posting and community

- **Telegram native scheduling** — Simple, free scheduling for individual posts.
- **`@EzyRegisterBot`** — Keep as the main post-management route if its existing scheduling, media and button support is enough.
- **[Controller Bot](https://www.controller.bot/)** — Consider for scheduled and rich posts or basic channel statistics if the current post manager has a specific gap.
- **[TelepostBot](https://t.me/telepostbot)** — Another channel-posting option to evaluate. Check permissions and data handling before connecting it.
- **[Combot](https://combot.org/)** — Optional moderation and analytics if the discussion group becomes busy. Sarah already handles routine FAQs, so Combot would be for community moderation rather than sales.

### Analytics, channel discovery and attribution

- **[Telechurn](https://telechurn.com/)** — Tracks channel joins and leaves by invite link and can show source-level churn.
- **[TGStat](https://tgstat.com/)** — Research public channels, posting frequency, reach, mentions and potential placements.
- **[Telemetrio](https://telemetr.io/)** — Channel discovery and audience/ad analysis; use it as another check when vetting potential partners.
- **[Telegram channel statistics](https://core.telegram.org/api/stats)** — Native statistics for eligible channel admins.
- **Named Telegram invite links** — Use a different link for each channel swap, live, creator or campaign so channel joins have a source.
- **Bot deep links** — Keep `/start` tags such as `?start=tt_live` and `?start=ch_pin` to measure bot starts separately from channel joins.
- **[TG.ME channel/ad catalogue](https://tg.me/ads)** — Additional channel discovery and public ad research.

### Paid Telegram reach

- **[Telegram Ads](https://ads.telegram.org/)** — Official sponsored messages with channel targeting. The platform documentation says ads appear in public channels with at least 1,000 subscribers.
- **[Telega.io](https://telega.io/)** — Managed option to find Telegram channel placements and handle campaign operations.
- **Direct channel swaps** — No software required. Use TGStat or Telemetrio to shortlist relevant non-competing channels and a separate invite link to measure each swap.

**Avoid buying members, views or reactions.** Those numbers do not show whether real people read posts, join the channel or stay, and they conflict with EzyMap’s transparency positioning.

## 3. TikTok, editing and repurposing

### Research and creation

- **[Creator Search Insights](https://support.tiktok.com/en/using-tiktok/growing-your-audience/creator-search-insights)** — Search demand, topic suggestions and content gaps. Use it to find lesson questions, not as a promise of reach.
- **[TikTok Creative Center](https://ads.tiktok.com/business/creativecenter/)** — Research hashtags, sounds, creators and top ads; keep the research within Jack’s trading-education niche.
- **[TikTok Studio](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok)** — Native content management and analytics.
- **[CapCut](https://www.capcut.com/)** — Daily chart shorts, captions, zooms and reusable EzyMap templates.
- **[Canva](https://www.canva.com/)** — Scorecard graphics, lesson covers, channel-audit cards and end cards.

### Cross-posting and scheduling

- **[Meta Business Suite](https://www.facebook.com/business/tools/meta-business-suite)** — Native Instagram and Facebook content management and scheduling.
- **[YouTube Studio](https://studio.youtube.com/)** — Native Shorts publishing and scheduling.
- **[Metricool](https://metricool.com/)** — Multi-platform calendar, publishing and analytics. Check current plan limits and support for each format before subscribing.
- **[Repurpose.io](https://repurpose.io/)** — Automated distribution workflows for finished videos.
- **[Buffer](https://buffer.com/)** — Simpler scheduling queue to compare with Metricool.
- **[Publer](https://publer.io/)** — Another option for bulk scheduling and cross-posting.
- **[Adobe Express Content Scheduler](https://www.adobe.com/express/feature/content-scheduler/tiktok)** — Combines creative tools and scheduling.
- **[Postiz](https://github.com/gitroomhq/postiz-app)** — Popular open-source social publisher; its GitHub page showed roughly 35,000 stars when checked. It advertises self-hosting and a broad set of social integrations. License: AGPL-3.0. Verify the exact integrations and publishing modes before adopting it.
- **[Mixpost](https://github.com/inovector/mixpost)** — Open-source, self-hostable social-media management. Check current integrations and which features are available in its Lite versus commercial versions.
- **[n8n](https://n8n.io/)** — Optional workflow automation if an existing webhook needs to connect to approvals, result updates or the content sheet. Add it only to solve a specific integration gap.

### Lives-to-content tools

- **[OpusClip](https://www.opus.pro/)** — Suggests clips from longer recordings. Review every clip manually for correct chart levels, context and risk wording.
- **[Vizard](https://vizard.ai/)** — Another long-video-to-short-clip option to compare with OpusClip.
- **[Descript](https://www.descript.com/)** — Transcribes lives and helps find sections to turn into clips or written lessons.
- **[OBS Studio](https://obsproject.com/)** — Free desktop recording/streaming option for chart capture and reusable scenes.
- **[TikTok LIVE Studio](https://www.tiktok.com/studio/download)** — Native live-production option, subject to account and regional eligibility.
- **[StreamYard](https://streamyard.com/)** — Consider only if guest interviews or multi-platform broadcasts become part of the format.

### Publishing note

Export a clean master for other platforms, then tailor each platform’s title, caption and call to action. Reddit discussions about schedulers note that scheduled cross-posting may not preserve platform-native audio features. Jack can use native platform tools for those cases.

## 4. Marketing research and measurement

- **TikTok Creator Search Insights** — Find search-led questions for lessons, Start Safe clips and chart explainers.
- **TikTok Creative Center** — Check market-relevant trends and sounds before planning content.
- **TGStat and Telemetrio** — Find relevant Telegram channels and screen potential swap or placement partners.
- **Telechurn plus named invite links** — Compare joins, departures and retention by promotion source.
- **Google Trends** — Check broader interest in gold and trading education as supporting context.
- **Reddit listening** — Useful communities and threads include [r/SocialMediaMarketing](https://www.reddit.com/r/SocialMediaMarketing/), [r/TelegramBots](https://www.reddit.com/r/TelegramBots/) and [r/selfhosted](https://www.reddit.com/r/selfhosted/). Read for recurring problems and project feedback; follow each community’s rules and avoid link-dump promotion.
- **Google Sheets** — Keep the current content log. Add campaign/source fields only when they answer a useful question.
- **Looker Studio** — Optional dashboard over Sheets if the weekly reporting process later becomes cumbersome.

## 5. Rollout order

1. **This week:** Set up Creator Search Insights, Creative Center and a reusable CapCut template. Create unique invite/deep links for each campaign and partner.
2. **After two weeks:** Compare content pillars using watch time, completion, profile views, bot starts, channel joins and retention.
3. **Then:** Trial either Metricool or Repurpose.io, based on the main remaining bottleneck. Keep it only if it measurably saves time.
4. **When lives produce useful recordings:** Trial OpusClip or Vizard for clip suggestions; have Jack or Abdul verify every market detail before publishing.
5. **When Telegram source tests increase:** Add Telechurn and use TGStat/Telemetrio to vet partners.
6. **Only if the current bot workflow has a gap:** Consider n8n, Postiz or Mixpost rather than replacing working systems.

## 6. Approval and compliance notes

- AI and schedulers can draft, format and queue posts. Jack should approve anything containing a trade, price, result or offer.
- Match result posts to the board; keep losses visible and include the required risk language.
- The [Securities Commission Malaysia’s revised advertising guidance](https://www.sc.com.my/resources/media/media-release/sc-issues-revised-guidelines-on-advertising-for-capital-market-products-and-related-services) addresses social media and financial influencers.
- TikTok’s [financial-services ad policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-financial-services?lang=en) has market-specific requirements, including for Malaysia. Confirm eligibility and local requirements before paid ads or creator promotions.
