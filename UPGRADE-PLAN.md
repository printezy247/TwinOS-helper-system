# EzyMap TwinOS — Master Plan v3

**Status:** Phases 0–8 built as far as the repo allows; v4 upgrade (§17) planned · **Owner:** Jack · **Scope:** EzyMap only · **Updated:** 2026-10-02
**Built from:** v1 (commit `fe035b9`), v2 research (platform APIs and limits verified 2026-10-01, audit of Jack's repos), and three documents dated 30 Sep 2026: *EzyMap Growth Plan 2026-27*, *EzyMap Channel Posting Kit*, *Jack's FYP Content Plan*.

**What TwinOS is for:** the Growth Plan says "Make Telegram run itself" and "anything a script can do, a script does". TwinOS is that script. It runs the channel desk, the repost machine, the tracking and the Friday numbers, so Jack's five hours a day go only to the gold map, TikTok and people.

**Budget rule:** no new paid subscriptions. Services Jack already pays for and relies on (Telechurn first) stay. TwinOS connects to them instead of replacing them. Free official APIs fill the gaps.

**Method rule:** tracking and automation use allowed methods only: the Telegram Bot API, official platform APIs, exports from tools Jack already uses, and manual entry. No automation of Jack's personal Telegram account, no scraping of TikTok, no bulk crawling of Telegram.

---

## 0. Decisions log

| # | Question | Decision (Jack, 2026-10-01) | What it means for the build |
|---|---|---|---|
| 1 | Which backend? | A **new** project on **Lovable**, kept apart from printezy so ABDUL's data doesn't mix with older systems | New Lovable project with its own database. printezy's Supabase is never written to by TwinOS. See §8 for the one sub-choice left |
| 2 | Who is "Abdul" in the Posting Kit? | **ABDUL the assistant** | ABDUL takes the "Abdul" desk role: drafts, checks, schedules, logs. It never approves prices, trades, results or offers |
| 3 | Telegram tracking method | **Allowed methods only, keep current services like Telechurn** | Telechurn stays the join/leave tracker. TwinOS adds Bot API events and imports Telechurn exports. Jack's personal account is not automated |
| 4 | ICPs | **From the PDFs** | Six ICPs from the Growth Plan, §4.2 |
| 5 | Reference channels | **44fx, Callisto Fx, Orient Fx, 10X INTERNATIONAL, SandyFx** | A benchmark watchlist. TwinOS tracks their public rhythm and reach by hand-sized, allowed checks. Their text is never fed to the AI as examples, and they are never named in posts (§4.10) |
| 6 | Baseline week | **Yes** | Week 1 time log before automation starts |
| 7 | Professional advice on compliance | **Yes** | Lawyer's opinion before paid ads (Growth Plan: before Q1 2027) |
| 8 | TikTok account type | **Personal** | Creator Search Insights stays available. TikTok posting stays manual through a publish kit. LIVE needs about 1,000 followers |
| 9 | Commit and push this plan | **Yes** | Pushed as `734696d` |
| 10 | Backend | **Lovable + Jack's own Supabase project** (§8 option A) | TwinOS gets its own Supabase project, separate from printezy's. Lovable builds the UI against it; migrations live in this repo |
| 11 | Paid services kept | **CapCut, TradingView** (plus Telechurn) | CapCut stays the editor; the Studio module prepares clips and captions for it rather than replacing it. TradingView plan includes webhook alerts |
| 12 | Reference channels | They are not usual IB channels; they target **big-deposit audiences**. Jack wants trending channels like them found | Phase 0 research task: a benchmark study of these five and similar trending channels (§4.10). Allowed methods only |
| 13 | TradingView webhooks | **Yes, included** | Signal cards come from TradingView alert webhooks (item 22). The signal bot stays the second source |
| 14 | Pricing model | **Monthly subscriptions preferred** | Price list unified around monthly plans (TradingView Pro gets a monthly option via invite-only scripts, as the Growth Plan proposes). Lifetime SKUs kept only where already sold. `products` carries `billing = monthly | lifetime | one_time` |
| 15 | Sales bot today | **The existing sales bot**, ahead of the website's bot | TwinOS reads the sales bot's `/start` tags and subscriptions. The website bot is not a source |
| 16 | Telechurn setup | Telechurn's bot is connected to the channels and reads joins and leaves. No CSV export, no link naming yet | TwinOS owns link naming from Phase 1 (convention in §5). Telechurn keeps reporting on them. Weekly numbers copied from Telechurn's report into `manual_metrics` until an export exists |
| 17 | EzyMap Desk group | **Yes** | Created in Phase 0 with Jack and the ops bot |
| 18 | Sales bot hosting | **Hosted externally**, no VPS | It stays on the outside host; TwinOS only reads it. Health module watches the monthly keep-alive click and write load; revisit at Phase 8 |
| 19 | EzyMap repo privacy | **Jack will make it private** | Outside TwinOS. Checked off in Phase 0 |

---

## 1. Objective and success metrics

**Business target (from the Growth Plan):** from about 640 channel members and under $50 a day today to $1,000 a day by June 2027 with a broker-funded ad pilot, or $400–600 a day organic only.

**TwinOS target:** cut Jack's operational hours by ≥60% by end of Phase 3 and ≥70% by Phase 5, so his day matches the Growth Plan's five-hour schedule: 30 min map, 30 min approvals and DMs, 60 min recording, 30 min TikTok replies, 60–90 min rotating block, 60 min NY session.

**How it is measured:**
1. Baseline week (decision 6): Jack logs hours by task for one normal week.
2. TwinOS counts what it did instead of Jack in `action_log` (posts drafted, posted, logged, reposted, numbers pulled).
3. The Growth Plan's Friday scoreboard (§4.8) is produced by TwinOS, not by hand.

**Quarter targets TwinOS reports against (Growth Plan §11):**

| | Q4 2026 | Q1 2027 | Q2 2027 |
|---|---|---|---|
| Channel members | 2,500 | 5,000 | 10,000 |
| Active funded clients | 80 | 200 | 400 |
| Revenue per day | $150 | $450 | $1,000 |
| Stop-if rule (TwinOS alerts on it) | A signal posts without a result update even once | Cost per first-time depositor above $120 for 2 weeks | Refund or complaint rate above 3% |

---

## 2. Scope and non-goals

**In scope:** everything the Posting Kit's desk does, the FYP plan's repurposing, the Growth Plan's automation table (§09) and scoreboard (§14), community moderation, research for content and ICPs.

**Out of scope:** Sambang Gold, Aish Capital, 20 Pips Lab, Sam, EzyViralAI (the Growth Plan says park them). No multi-tenant design.

**Non-goals:**
- Rewriting the signal bot's engine or the EzyMap indicator.
- Replacing services Jack already uses and trusts (decision 3).
- Automating Jack's personal Telegram account, scraping TikTok, or bulk-crawling Telegram.
- Buying members, views or reactions.
- Selling on TikTok. TikTok sends people to the channel; the bot sells.

**Growth Plan "stop doing" list, which TwinOS enforces where it can:** no hand-posting on IG/FB/YouTube/X; no answering the same question twice (repeat questions go to the FAQ bot's reply sheet); no new bots or brands before $500 a day.

---

## 3. Current state

### 3.1 Systems (verified from the repos)

| System | What it does today | Role in TwinOS |
|---|---|---|
| **The signal bot** | Signals, outcome resolver, results stats, health beats, billing. Hosted externally | Pushes signals and outcomes to TwinOS. Its board feeds result replies and the Friday scorecard |
| **The sales bot** | The one front door for every sale (Growth Plan). EN/BM, Stripe/USDT/Stars, MT5 licences, `/start` tag stats, channel post manager. Hosted externally | Untouched by TwinOS until the revenue migration. TwinOS reads its `/stats` tags and subscriber data |
| **The FAQ bot** | Keyword FAQ in EN/BM. Growth Plan: support persona only, checkout retired | Reply corpus feeds TwinOS; repeat questions get added to its sheet |
| **printezy.money** | Proof layer: public board, checkout, SEO, ad landing. Own Supabase (22 tables) | Read-only source for ad-click attribution and the board, through a narrow read endpoint |
| **MacroTrader bot** | Free 8 AM ET digest, paid macro products | Its daily card becomes the 08:15 macro post |
| **ABDUL** | Local assistant with an MCP server, HTTP hub, approval-hold UX, redaction, research, monitors | The desk operator (decision 2) |
| **NeuraOS** | Local llama-server and image server on Jack's PC | Local drafts, thumbnails |
| **Telechurn** | Join/leave tracking per named invite link (Jack's paid service, kept) | Stays the tracker of record for channel churn. TwinOS imports its CSV export |
| **Google Sheet content log** | Date, time, post type, language, link, views 24h, reactions, bot starts, notes (Posting Kit) | TwinOS fills it automatically, then becomes the master log with a Sheet export |

This repo is public, so the private repos TwinOS reads from and the companies that host them are named by role ("the signal bot", "the sales bot", "the FAQ bot"), not by slug. Hosts and accounts stay in Jack's private runbook. `printezy.money` and this repo are already public and are named in full.

### 3.2 Gaps nothing covers today
Scheduled queue with approval, TradingView alert → channel card, result replies under signals, Friday scorecard image, posting to IG/FB/Threads/YouTube, clipping lives, moderation, keyword research, and the Friday scoreboard in one place.

### 3.3 Fix before TwinOS copies anything (from repos and the Growth Plan)
- **Urgent, outside TwinOS:** the EzyMap indicator repo is public and holds the paid EzyMap Pro Pine source and MT5 tools (Growth Plan §03, GitHub listing confirms it is public). Jack makes it private.
- Vantage IB number differs between repos (`6709552` vs `26468008`). Trial length differs (7 vs 3 days). TradingView Pro shows "$29/mo" in one repo and $249 lifetime elsewhere. The Growth Plan proposes adding a $29/mo option, so this needs one decided price list.
- The FAQ bot shows "RM49" for a $49 product to BM users.
- Malay language code: TwinOS uses `ms`. The sales bot and the ops-dashboard code use `my`.
- Website testimonials without a source: written permission or removal (Growth Plan rules).
- Contact lists in `blasting` came from personal Telegram exports. Never imported.

---

## 4. Business inputs TwinOS encodes

These come from the three PDFs and become data in TwinOS (tables and templates), so Jack edits them in one place.

### 4.1 Positioning and pledge
- **Promise:** "EzyMap maps gold every day, shows every result, and teaches you to trade the plan, not the hype."
- **Transparency pledge** (pinned): every free signal gets a result reply; strict win rate with break-even excluded; IB commission disclosed and never required for free content; education first.
- Stored as `brand_facts` and quoted word for word in the pinned post and disclosure lines.

### 4.2 Six ICPs (Growth Plan §05)

| # | ICP | Entry point | Main pillar | Offer ladder |
|---|---|---|---|---|
| 1 | Gold beginner (main), 22–35, phone, small account, blew one before | TikTok, channel | Map Recap | Free → Beginner/Pro tiers, EzyMap Lite |
| 2 | Signal-channel refugee, burned by VIP groups | TikTok audits, referrals | Channel Audit | Pledge, scorecard, education |
| 3 | Tool-driven trader, TradingView/MT5, prop firms | 3-day trials, website | Tool Demo | MT5 bundle, Drawdown Guardian, Bulk Close, EzyMap Pro |
| 4 | Macro trader | Macro bot, daily card | Macro card | Macro desk $19 |
| 5 | Crypto + forex generalist | Website board, Threads/X | — | EzyAI PRO $14.99 |
| 6 | General financial-solution seeker, not trading yet, worried about scams | TikTok, BM SEO | Start Safe | Free ebook, demo challenge, never pushed to deposit early |

Every content item carries an `icp` tag. Research scores topics by ICP fit. The Friday report shows which ICP each week's content served.

### 4.3 Three ladders (Growth Plan §06)
Free (channel → ebook + Lite via Beginner → Top Trade Calls script), Funded via IB (Pro any deposit → Premium $100+ → Elite $700+), Paid without broker (MT5 tool from $9/mo or Lite $49 → EzyAI PRO or Macro desk → MT5 bundle $99/mo or Pro $249). Stored in `products` with a `ladder` and `step`. Offer posts may only quote prices from this table.

### 4.4 Channel rhythm (Growth Plan §07, Posting Kit §01)

| Time (MYT) | Post | Source | Who |
|---|---|---|---|
| 07:45 | Map screenshot + raw notes into the private **EzyMap Desk** group | Jack | Jack |
| 07:50 | Draft back in the Desk group (Prompt 1) | ABDUL + ops bot | Auto |
| 07:58 | OK or one-line edit | Jack | Jack |
| 08:00 | Gold map | Publisher | Auto after OK |
| 08:15 | Macro card | Macro bot digest → template 2 | Auto |
| 13:00 | Lesson from the weekly batch | Queue | Auto |
| London/NY | Free signal card 1–2 from the EzyMap alert | TradingView webhook → template 3 | Jack taps approve |
| On hit | Result reply under the original signal | Board status change → template 4 | Auto |
| 15–30 min before CPI/NFP/FOMC | News alert | Economic calendar → template 12 | Auto, approve if it names levels |
| 20:00 | Evening wrap from one line | Jack's line → template 11 | Jack + auto |

Weekly: Mon poll, Wed Channel Audit, Fri scorecard image, Sat one offer post, Sun outlook. Holidays and milestones from a Malaysian holiday calendar and member-count thresholds.

### 4.5 Fifteen post types (Posting Kit §04)
Gold map, macro card, signal card, result reply (TP1/TP2/BE/SL), lesson (skill / Start Safe), Channel Audit, weekly scorecard, Sunday outlook, offer (A free via broker, B 3-day trial, C no-broker, D EzyAI waitlist), poll, evening wrap, news alert, member result (written permission only), holiday/milestone, pinned Start here. Each becomes a `template` row holding the kit's prompt, the field list, the character limit, the required lines (risk, disclosure) and the approval rule.

The kit's **master prompt**, **banned words list**, **hashtag index** (#GoldMap #Signal #Result #Lesson #StartSafe #Audit #Macro #Scorecard #Outlook #Tools) and **trade card format** become `style_guide` rows. The **pre-post checklist** (numbers, words, risk line, one CTA, disclosure, losses, format, language) becomes the automatic check in §12.

### 4.6 TikTok plan (FYP Content Plan)
- One short a day, 30–60 s; five pillars in a fixed weekly mix: Map Recap ×2, Channel Audit ×1, Lesson/Start Safe ×2, Tool Demo ×1, Jack's Desk ×1.
- 28-day calendar, 40-line hook bank (EN/BM), script templates per pillar, caption pattern with 3–5 hashtags.
- Three lives a week (NY session Mon/Wed/Thu, Sunday outlook, monthly Channel Audit live) with run sheets. Until ~1,000 followers, lives run as Telegram video chats and the best 60 s goes to TikTok.
- Double-down rule: a video well above average gets a part 2 within 48 hours.
- Signature look: dark chart, EzyMap green/red/gold, one font, one end card.
- All stored as `calendar_slots`, `hooks`, `script_templates`, `live_runsheets`.

### 4.7 Repurposing map (FYP §08)
One TikTok → Instagram Reels, Facebook Reels, YouTube Shorts (clean export, no watermark), Threads (chart screenshot + two lines), X (screenshot or 3-post thread), Telegram (Saturday video of the week), YouTube long form (Sunday live, from Q2 2027).

### 4.8 Friday scoreboard (Growth Plan §14 + FYP §08)

| Number | Source in TwinOS |
|---|---|
| Channel members, net joins | Bot API member count + `chat_member` events; Telechurn export as the reference |
| Average views per post as % of members | Post view snapshots (ops bot, §9.H) |
| TikTok followers, profile views, watch time, % watched in full | Manual weekly entry or TikTok Studio export |
| Bot `/start` by source tag | Sales bot `start_log` (read) |
| IB accounts opened, first-time depositors, active funded clients, rebates | **Vantage portal, entered weekly by Jack** (no API). Two-minute form |
| Product revenue | Stripe + USDT + Stars records |
| Active subscribers, expiring in 7 days | Sales bot `subscriptions` (read) |
| Signals posted vs results posted | Board vs channel posts. Must be 100% or TwinOS alerts at once |
| Strict win rate and total R, 4 weeks | Board |

### 4.9 Roles (Posting Kit §01–02, with decision 2)

| Who | Does | Never does |
|---|---|---|
| **Jack** | Map screenshot and 3–5 raw lines, one evening line, approves signals and anything with a price/result/offer, records TikTok, final say | Formatting, scheduling, logging, routine FAQs |
| **ABDUL** (assistant) | Runs the prompts, checks the checklist, schedules, logs, posts result replies, runs the Wednesday batch, answers "how did it do" | Approving prices, trades, results or offers; DMing members about money; changing prices |
| **@EzyOps bot** (new, ABDUL's hands in Telegram) | Admin in the channel with Post/Edit/Delete only. Member of the Desk group. Shows drafts with Approve/Edit buttons | Adding admins, changing channel info |
| **Claude** | The drafting model behind ABDUL for long or important copy (ABDUL's existing Claude route) | Posting anything |

Keys and money stay with Jack: bot tokens, IB portal, Stripe, USDT wallet, licence server token.

### 4.10 Reference channels (decisions 5 and 12)
44fx, Callisto Fx, Orient Fx, 10X INTERNATIONAL, SandyFx.
- **Why Jack picked them:** they are not the usual IB-rebate channels. They target a big-deposit audience. That is a positioning signal, not a copy target: EzyMap stays the honest channel, but its Funded ladder (Premium $100+, Elite $700+) and the Elite Circle speak to the same higher-capital segment.
- **Phase 0 research task:** a benchmark study of these five plus trending channels like them, found through allowed means (public channel previews, TikTok and YouTube search by hand, TGStat-style public pages viewed one at a time). For each: platform and handle, size, posting rhythm, view rate, offer structure, how they qualify big-deposit members, and what disclosures they show. The output is a short report and a `benchmarks` seed, plus a proposed "high-capital" ICP note for Jack to accept or reject.
- **What TwinOS does:** a benchmark card per channel, refreshed weekly by an allowed, low-volume check of each public channel's web preview (subscribers, posts per day, average views, view rate) and recorded by hand for TikTok. Shows how EzyMap's rhythm and view rate compare.
- **What TwinOS does not do:** feed their posts to the AI as writing examples (Telegram's terms forbid using channel content for AI without consent), copy their wording, or name them in content. The Channel Audit series stays pattern-based, as the Growth Plan requires.
- Jack's style notes on what he likes about each ("short map format", "clean result replies") go into `style_guide` as rules written by Jack.

---

## 5. Services policy: keep, connect, build

| Need | Decision | How |
|---|---|---|
| Channel join/leave and churn by link | **Keep Telechurn** | Name every invite link in a shared convention (`src_campaign_date`). TwinOS creates links through the ops bot so it also sees the joins; Telechurn keeps tracking them as before. Weekly Telechurn CSV import for the reference numbers |
| Telegram moderation | Build in the ops bot (free) | CAS check on join, link block for new members, flood control, warn/mute/ban. Combot only if Jack already uses it |
| Telegram channel stats | Build with allowed methods | Bot API member count, `chat_member` events, post view snapshots through the bot's own login. No personal-account automation, so Telegram's full broadcast stats stay in the Telegram app |
| Scheduling, cross-posting (Buffer/Hootsuite/Repurpose.io/Metricool) | Build (free official APIs) | Instagram, Facebook, Threads publish directly. TikTok and (until the free audit) YouTube get a publish kit |
| Brand voice (Jasper) | Build | Posting Kit master prompt + Jack's best posts + Claude/local models |
| Keyword and topic research (Semrush, vidIQ, Creator Search Insights) | Build with free sources | Search Console, Bing, YouTube API, autocomplete, weekly manual TikTok capture |
| Content log (Google Sheet) | Connect, then lead | TwinOS writes every row automatically and keeps a Sheet export |
| Clipping (OpusClip/Vizard) | Build on Jack's PC, **hand off to CapCut** | faster-whisper + ffmpeg produce transcript, suggested cut points, caption file and clean clips; Jack finishes in CapCut (kept). No CapCut replacement |
| Signal alerts | **Keep TradingView** (webhooks included) | Alert webhook → signal card draft |
| Video editing | **Keep CapCut** | Studio output is CapCut-ready: SRT captions, clip list, cover text |

**Invite-link naming convention (Phase 1, used by TwinOS and visible in Telechurn):** `src-campaign-yymm`, lowercase, e.g. `tt-live-2610`, `swap-macronews-2611`, `ig-bio-2610`. Links are created only through the ops bot so the name, source and campaign are stored at creation.

---

## 6. Hard limits (verified 2026-10-01)

| Limit | Fallback |
|---|---|
| TikTok rejects auto-posting apps for one's own account; unaudited apps post privately only | **Publish kit:** clean file, caption, hashtags and cover text sent to Jack's phone; he posts in the app or schedules in TikTok Studio (up to 10 days ahead); taps "Posted" and pastes the link |
| YouTube uploads from an unaudited API project stay private | Apply for Google's free audit in Phase 3; publish kit until then |
| Facebook posts from a development-mode Meta app are not public | Meta app set to Live with Standard Access (no review needed for Jack's own Pages) |
| Instagram comment webhooks need Advanced Access | Poll comments every 15 min |
| Bot API has no scheduling and no view counts | Own scheduler; view snapshots through the ops bot's own login |
| `chat_member` updates can go missing | Telechurn export and daily member count as reconciliation |
| Telegram forbids using channel/group content for AI without consent | No AI on group text or other channels' posts. AI only on Jack's own inputs and consented replies |
| TikTok Creator Search Insights and Creative Center have no API; scraping is banned | Weekly 10-minute capture form, or "ABDUL, log CSI topic …" |
| Exact keyword search volumes aren't free | Relative scores from free sources |
| X API has no free tier ($0.015 per post) | X stays manual (2 min) unless Jack accepts a few cents a month |
| Vantage IB portal has no API | Weekly two-minute entry form |
| Telechurn has no export on Jack's plan | Weekly numbers copied from Telechurn's report (two-minute entry); TwinOS's own `chat_member` events carry the per-link detail |

---

## 7. Product shape

```
Jack ── Telegram: EzyMap Desk group + approve buttons + publish kits ──┐
Jack ── TwinOS dashboard (new Lovable project) ─────────────────────────┤
Jack ── voice/chat ─▶ ABDUL ── MCP ─────────────────────────────────────┤ one API, one set of rules
                                                                        ▼
                         ┌─────────────────────────────────────────────────┐
                         │ TwinOS backend (new, Lovable)                   │
                         │  Postgres: the mind     Functions: the rules    │
                         │  Scheduler: the clock   Storage: media ≤45 MB   │
                         └──▲──────────▲───────────────▲──────────▲────────┘
          signals, outcomes │          │ webhooks       │ reads    │ jobs (outbound only)
                 ┌──────────┴──┐  ┌────┴─────────┐  ┌───┴──────┐ ┌─┴──────────────────┐
                 │ Signal bot  │  │ @EzyOps bot  │  │ printezy │ │ PC worker          │
                 │ TradingView │  │ Desk group,  │  │ board,   │ │ clips, local AI,   │
                 │ alerts      │  │ channel,     │  │ ad clicks│ │ research, drop     │
                 └─────────────┘  │ moderation   │  │ (read)   │ │ folder, Telechurn  │
                                  └──────────────┘  └──────────┘ │ CSV import         │
                                                                 └────────────────────┘
```

| Job | Runs on | Why |
|---|---|---|
| Queue, scheduling, Telegram/IG/FB/Threads publishing, approvals, Desk group, moderation, attribution events | TwinOS backend | Always on, independent of Jack's laptop |
| Signal computation | The signal bot | Unchanged |
| Clipping, transcription, local AI, thumbnails, research batches | PC worker | Needs the GPU; can run late |
| Sales, payments, licences | The sales bot | Untouched until Phase 8 |

The PC worker never opens a port. It asks the backend for jobs and posts results back.

---

## 8. Backend on Lovable (decision 1)

A new Lovable project ("TwinOS") holds the dashboard and the backend. It is separate from the printezy Lovable project and its database.

**Decided (decision 10): option A.** Kept here for the record.

| Option | What it is | Fits TwinOS because | Watch out |
|---|---|---|---|
| **A. New Lovable project connected to a new Supabase project in Jack's own Supabase account** (recommended, if Lovable still offers the Supabase connection) | Lovable builds the UI and writes migrations and functions into Jack's Supabase | Full access for ABDUL's MCP server, the PC worker's scoped keys, database cron, secret storage for platform tokens, CLI migrations from this repo, `pg_dump` backups | Hosted free tier limits; project pauses after a week idle (the scheduler keeps it active) |
| **B. Lovable Cloud** (Lovable's built-in backend) | Lovable manages the database and functions | Least setup | Less direct control of cron jobs, secrets and keys for outside workers; usage billed beyond Lovable's included allowance. Check both before choosing |

Either way, Lovable's GitHub sync points at this repo, so all generated code lands here.

**Schema first:** the schema (§10) is written and reviewed before Lovable generates screens, as v1 required.

---

## 9. Modules and upgrade list

**[R]** = reuse from Jack's repos. **[PDF]** = specified in the three documents.

### A. Mind
1. New database, row-level security on every table, nothing readable without login except the public results view.
2. `action_log` written by a database trigger: actor (`jack`, `abdul`, `ops_bot`, `dashboard`, `cron`, `ezyai`, `pc_worker`), action, target, payload, time.
3. `settings` for business constants (IB numbers per broker, trial days, channel IDs, posting times). One source instead of hardcoded copies. **[R]**
4. `products` with ladder and step, seeded from printezy `catalog.ts` after the price list is unified. **[R][PDF]**
5. `brand_facts`, `style_guide`, `templates`, `hooks`, `calendar_slots`, `live_runsheets`, `personas` seeded from the PDFs. **[PDF]**
6. Platform tokens stored only in the backend's secret store.
7. Nightly backup pulled to Jack's PC by the PC worker.

### B. Rules
8. Functions per area: `content`, `approve`, `publish`, `tg-webhook`, `tv-webhook`, `signals-ingest`, `metrics`, `research`, `jobs`.
9. Roles from login claims; scoped keys for the signal bot, the PC worker and ABDUL.
10. Idempotent signal ingest ported from printezy's signal endpoint (batches ≤50, per-row results). **[R]**
11. Webhook secrets and signature checks ported from printezy. **[R]**
12. Idempotency key on every retried write. **[R]**

### C. Desk (the Posting Kit, automated)
13. **EzyMap Desk** private group: Jack, the ops bot. Jack drops the map screenshot and raw lines; the bot replies with the draft within a minute. **[PDF]**
14. Approve / Edit / Reject / Reschedule buttons; only Jack's Telegram ID can press them. **[R]** (sales bot `decision.py`, ops dashboard `approvalService`)
15. Edits by reply: "3: soften", "5: BM" apply to numbered drafts, as in the kit's Wednesday flow. **[PDF]**
16. `[NEEDED]` placeholders block publishing until filled. **[PDF]**
17. Prompt library: the kit's master prompt and 15 post prompts as editable templates. **[PDF]**
18. Wednesday 14:30 batch: 7 lessons (5 skill + 2 Start Safe), Channel Audit, Monday poll, Saturday offer, numbered with suggested times, ready in the Desk group by 15:30. **[PDF]**
19. Thursday auto-scheduling of the approved batch and logging to the content log. **[PDF]**
20. Daily 07:40 reminder if no map has arrived; 19:55 reminder for the evening line.
21. Short callback IDs under Telegram's 64-byte limit. **[R]**

### D. Signals and results
22. TradingView alert webhook → signal card draft (template 3) → Jack's tap → channel. Keeps COUNTER-TREND warnings. **[PDF]**
23. The signal bot pushes signals and outcomes after `outcomes.record()`. **[R]**
24. Result reply posted **as a reply under the original signal** when the board status changes (TP1, TP2, BE, SL). Wording from template 4. **[PDF]**
25. Stop-if alarm: a signal with no result reply after its expiry window alerts Jack immediately (Growth Plan Q4 stop-if). **[PDF]**
26. Strict win rate everywhere: W / (W + L), break-evens excluded. **[R][PDF]**
27. Demo or shadow data never reaches a public post (signal bot `quality.may_emit`). **[R]**
28. Friday scorecard **image** generated from the board, posted to the channel and Threads, X kit if X stays manual. **[PDF][R]** (sales bot `receipt.py` Pillow renderer)
29. Weekly signal number counter ("Free signal #3 this week"). **[PDF]**

### E. Channel publisher
30. Queue: `content_items` → `content_variants` (platform, language) → `publish_jobs`. **[R]** (AI-OS app `contentStore.ts`)
31. Status flow `draft → pending_approval → approved → scheduled → publishing → published | failed`.
32. Scheduler runs every minute with pacing and backoff. **[R]** (ops dashboard `outboundQueue.js`)
33. Telegram provider: text, photo, video, album, inline buttons, pin, edit in place, reply-to. **[R]** (sales bot `channel_posts`, `build_keyboard`)
34. Pinned **Start here** post managed as a template; disclosure and pledge lines locked word for word. **[PDF]**
35. Hashtag index and a pinned table of contents updated automatically. **[PDF]**
36. Monday poll posted as a native Telegram poll; results feed next week's lesson topics. **[PDF]**
37. News alerts generated from the economic calendar 30 min before high-impact events. **[R][PDF]** (macro bot `economic_calendar.py`, signal bot `calendar.py`)
38. Macro card at 08:15 from the macro bot digest. **[PDF]**
39. Malaysian holiday calendar (no map, no signals; holiday notice). **[PDF]**
40. Milestone posts drafted when members cross 1,000, 2,500, 5,000, 10,000. **[PDF]**
41. One offer post per week maximum, enforced; value-to-offer ratio about 6:1 reported weekly. **[PDF]**
42. Language test: two weeks BM-first, two weeks EN-first, compared on reactions per view. **[PDF]**
43. Every bot link tagged (`?start=tt_live`, `?start=ch_pin`, per post), so sales trace back to posts. **[PDF][R]**

### F. Repurposing (one TikTok → seven places)
44. Drop folder `~/EzyMap/out/`: the clean, watermark-free export becomes an asset. **[PDF]**
45. Captions per platform from the FYP pattern (IG shorter + 5 hashtags, YouTube searchable title, Threads two-line takeaway + question). **[PDF]**
46. Instagram Reels via the official API (100 posts per 24 h). 
47. Facebook Reels via the Pages API (30 per 24 h).
48. Threads: chart screenshot + two lines (250 per 24 h). **[PDF]**
49. YouTube Shorts: publish kit until the audit passes, then direct.
50. TikTok: publish kit with hook text, caption, 3–5 hashtags and posting slot (12:30–13:30 or 20:00–22:00 to start). **[PDF]**
51. X: screenshot or 3-post thread kit, copied in two taps. **[PDF]**
52. Telegram Saturday "video of the week" picked from the week's best TikTok. **[PDF]**
53. Per-platform validator: caption length, hashtags, duration, size. **[R]** (copy tools `formats.ts`)
54. Friday 10-minute repurpose check replaced by an automatic "all platforms posted" report. **[PDF]**

### G. Studio (lives and shorts)
55. Live recordings (TikTok or Telegram video chat) → transcript (faster-whisper on the GPU) → highlight picks → clips. 
56. Layout templates in the signature look: chart full, chart + face, blurred fill. No face tracking on chart videos. **[PDF]**
57. Burned-in captions EN or BM, hook text in the first frame, the EzyMap end card. **[PDF]**
58. In-video risk line (spoken or on screen), as SC rules expect for video. 
59. Sunday live → trimmed YouTube long-form outlook (from Q2 2027). **[PDF]**
60. Cover text of 3–5 words suggested from the hook. **[PDF]**
61. Thumbnail drafts on the local image server with a pinned brand-safe model.

### H. Telegram tracking (allowed methods + Telechurn)
62. Named invite links created by the ops bot with the shared naming convention, so both TwinOS and Telechurn see them. **[PDF]**
63. `chat_member` events and join requests stored, then folded into stays (joined, left, source link).
64. Weekly Telechurn CSV import: joins, leaves and retention per link as the reference figures.
65. Daily member count snapshot.
66. Post view snapshots at +1 h, 24 h, 7 d through the ops bot's own login (no view inflation). Gives "views after 24h" for the content log and "average views as % of members" for the scoreboard. **[PDF]**
67. Bot `/start` tags read from the sales bot. **[R]**
68. Funnel view: TikTok/ad → bot start → channel join → IB account / purchase. **[R]** (printezy attribution chain)
69. Channel swap tracker: one link per swap partner, joins and 7-day retention per swap. **[PDF]**
70. Referral reward tracking hook (the reward itself lives in the sales bot later). **[PDF]**
71. Reference-channel benchmark cards (§4.10).

### I. Community and moderation
72. Discussion group moderation in the ops bot: CAS check on join, link block for new members, flood control, scam keywords ("account manager", "DM me for signals"), warn → mute → ban. **[R]**
73. Join captcha through Telegram's join-request flow.
74. Scam-impersonation watch: new accounts using "Jack" or "EzyMap" names in the group get flagged. **[PDF]**
75. Repeat-question detector: a question asked twice gets proposed for the FAQ bot's reply sheet. **[PDF]**
76. Missed-message alert once per chat. **[R]**
77. Unified inbox for IG/FB/YouTube comments (polled) and Threads replies; suggested replies, Jack taps to send. TikTok comments stay in the app.
78. Live-moderator checklist for the trusted member during TikTok lives. **[PDF]**

### J. Voice (Jasper replacement)
79. Master prompt, rules, brand facts and banned words from the Posting Kit as the base. **[PDF]**
80. Jack's own best posts (picked from the content log by 24 h views and reactions) as writing examples. 
81. Jack's edits to drafts are saved and become new examples.
82. BM written natively in the kit's casual style ("korang", "jom"), trading terms kept in English. **[PDF]**
83. Model routing: Claude via ABDUL for map, audit, outlook and offers; local Malay-capable model for short lessons and captions; free cloud tiers only with no personal data.
84. Hook bank and script templates served per pillar for TikTok recording. **[PDF]**

### K. Research (Semrush, vidIQ, Creator Search Insights)
85. Personas = the six ICPs with pain points and seed questions in EN, BM and Manglish. **[PDF]**
86. Autocomplete expansion for Malaysia (`hl=ms`, `gl=my`) with question prefixes, slow and small.
87. Search Console for printezy.money queries (Start Safe BM articles in Q2). **[PDF]**
88. Bing keyword impressions as a free volume signal.
89. YouTube competition score (about 100 keyword checks a day on the free quota).
90. YouTube channel RSS for the reference channels that have YouTube (no quota).
91. Weekly TikTok Creator Search Insights capture form (personal account has access). 
92. Live Q&A and Monday poll answers become topic seeds (Jack's own audience, with consent notice). **[PDF]**
93. Topic clusters scored by demand × ICP fit × low compliance risk; Monday brief proposes next week's 7 TikToks against the 28-day calendar. **[PDF]**
94. Double-down alert: a TikTok above average triggers a "make part 2 within 48 h" task with the top comment attached. **[PDF]**

### L. Analytics and Friday report
95. Friday scoreboard (§4.8) generated automatically, with the two manual inputs requested Friday morning: Vantage numbers and TikTok numbers. **[PDF]**
96. Content log rows written automatically: date, time, type, language, link, views 24 h, reactions, bot starts from its tag, notes. Sheet export kept. **[PDF]**
97. Keep top 3 post types, fix or drop the bottom one: shown as a ranked table. **[PDF]**
98. Pillar comparison for TikTok: watch time, % watched, followers, profile views, tagged bot starts. **[PDF]**
99. Quarter target tracker and stop-if alarms (§1). **[PDF]**
100. Revenue model check: rebate per active client entered monthly; the $30k/month mix recalculated with real numbers. **[PDF]**
101. Cost per first-time depositor per campaign once the broker pilot starts (Q1 2027). **[PDF]**

### M. Health
102. Beats from the signal bot, ops bot, scheduler, PC worker, pollers; stale beat → Telegram alert. **[R]**
103. Token expiry and quota watch (Meta, YouTube, backend limits).
104. "Anything broken?" one-query answer for ABDUL and the dashboard.

### N. ABDUL control
105. TwinOS MCP server in `apps/mcp/`, registered next to `abdul mcp`.
106. TwinOS verbs added to ABDUL's action schema via a `twinos_call()` copied from `hub_call()`, token in the keyring. **[R]**
107. ABDUL may draft, run the batch, schedule non-claim posts, post result replies that come straight from the board, log, read everything, and request approval.
108. ABDUL cannot approve maps, signals, offers, member results or anything with a price. That button exists only on Jack's phone.
109. Voice commands: "draft tomorrow's lessons", "post the result for signal 3", "how did today's map do", "anything broken", "log CSI topic", "make a link for the swap with X", "clip yesterday's live", "Friday numbers".

### O. Compliance engine
110. Pre-post checklist from the kit run automatically on every variant (§12). **[PDF]**
111. Claim detector: prices, levels, results, percentages, offers, broker names, testimonials → approval required.
112. Required lines attached per post type and platform; publishing blocked if missing.
113. Evidence trail per published post: checks passed, approver, time.

### P. Revenue core (last, high risk)
114. The sales bot stays live and unchanged until TwinOS has run for weeks. Then migration with parallel running.
115. Before moving: Stars payment idempotency, larger Stripe de-dupe window, service-role key replaced by a narrow read.

---

## 10. Schema

`bigint` Telegram IDs, `timestamptz` everywhere, `ms` for Malay.

- **Core:** `settings`, `brand_facts`, `products`, `personas`, `action_log`, `approvals`, `health_checks`, `alerts`, `jobs`, `baseline_hours`, `time_saved`
- **Content:** `templates`, `style_guide`, `hooks`, `calendar_slots`, `live_runsheets`, `content_items` (pillar, icp, post_type), `content_variants` (platform, lang, body, media, claim_flags, board_refs, needed_fields), `assets`, `publish_jobs`, `platform_accounts`, `compliance_checks`, `content_log` (view)
- **Signals:** `signals`, `signal_outcomes`, `signal_posts` (signal → channel message id, for reply-under)
- **Telegram:** `invite_links` (name, source, campaign, partner, cost), `member_events`, `memberships`, `channel_daily`, `tg_posts`, `post_snapshots`, `telechurn_imports`, `bot_start_tags` (read copy), `mod_rules`, `moderation_events`
- **Cross-platform:** `post_metrics`, `manual_metrics` (TikTok and Vantage weekly entries), `inbox_items`
- **Research:** `queries`, `topic_clusters`, `briefs`, `csi_captures`, `benchmarks` (reference channels), `exemplars`
- **Views:** `v_results_board`, `v_friday_scoreboard`, `v_funnel`, `v_quarter_targets`, `v_stop_if`

---

## 11. API and ABDUL tools

| Endpoint | Purpose | Who |
|---|---|---|
| `POST /desk/input` | Map screenshot + raw lines from the Desk group | ops bot |
| `POST /content/draft` | Draft from a template | jack, abdul, cron |
| `POST /content/{id}/request-approval` | Push to the Desk group | jack, abdul, cron |
| `POST /content/{id}/approve` | Publish gate | **jack only** |
| `POST /content/{id}/schedule` | Create publish jobs | jack; abdul for non-claim posts |
| `POST /signals/ingest`, `POST /tv/alert` | Signal bot and TradingView in | scoped keys |
| `POST /results/{signal}/reply` | Result reply from the board | abdul, cron |
| `POST /assets/ingest` | Drop-folder export | pc worker |
| `POST /links` | Named invite or bot link | jack, abdul |
| `POST /metrics/manual` | Vantage and TikTok weekly numbers | jack, abdul |
| `POST /imports/telechurn` | Telechurn CSV | jack, pc worker |
| `GET /friday`, `GET /analytics/*`, `GET /health` | Reports | all |
| `POST /research/csi`, `GET /research/brief` | Research | jack, abdul |

ABDUL tools mirror these: `twinos_draft`, `twinos_batch`, `twinos_request_approval`, `twinos_schedule`, `twinos_result_reply`, `twinos_link`, `twinos_manual_metrics`, `twinos_friday`, `twinos_health`, `twinos_csi_log`, `twinos_clip`, `twinos_brief`. There is no approve tool.

---

## 12. Compliance

**Jack is getting a lawyer's opinion before paid ads (decision 7).** Points to bring to that meeting, from the SC Malaysia documents found during research:
- SC advertising guidelines (in force 1 Nov 2025) treat self-initiated finfluencers as advertisers, require balance, benefit disclosure and prominent warnings, and bar promoting services from persons the SC hasn't authorised (5.06), which touches broker IB links.
- SC investment-advice guidance (Jul 2024) treats buy/sell calls in a paid signal group as carrying on advice; a disclaimer doesn't remove the licence question.
- BNM: forex trading with parties other than licensed onshore banks or approved persons is illegal (FSA 2013 s.214).
- TikTok: own-business promotion needs the content-disclosure toggle; financial ads in Malaysia only from registered advertisers.

**Checks TwinOS runs on every post (Posting Kit checklist + SC points):**

| Check | Pass if |
|---|---|
| Numbers | Every price, level and result matches Jack's input or the board; no `[NEEDED]` left |
| Words | Nothing from the banned list (kit list + "best", "risk-free", "tanpa risiko") |
| Risk line | Present on every map, signal, outlook and scorecard |
| Video warning | Spoken or on-screen risk line inside every video, not caption only |
| Instagram/Facebook | Warning placed before the "…more" cut |
| One CTA | At most one; only one offer post per week |
| Disclosure | Any broker-link mention carries the commission line |
| Losses | Every signal has its result reply, including SL |
| Results | Result and scorecard posts reference board rows; past-performance line present |
| Member results | Written permission recorded; names and account numbers removed; numbers untouched |
| Format | Under 900 characters unless long form; Telegram bold only on key numbers |
| Language | Matches the planned slot |
| TikTok kit | Disclosure-toggle reminder on product posts; "education only" in bio and lives |

---

## 13. Roadmap (aligned with the Growth Plan calendar)

| Phase | Dates | TwinOS delivers | Growth Plan milestone it serves | Exit criteria |
|---|---|---|---|---|
| **0 — Plan and mind** | 1–7 Oct | Baseline hours week; unified monthly-first price list and settings; schema written; new Supabase project + Lovable project connected; ops bot created; **EzyMap Desk group created**; reference-channel benchmark study; link naming convention agreed; EzyMap indicator repo made private (Jack) | Week 1: pinned Start here, pledge, FAQ bot support-only | Schema reviewed; baseline logged |
| **1 — Desk loop** | 8–21 Oct | Desk drafts with approve buttons; Telegram publisher and scheduler; templates for all 15 post types; signal card from alerts; result replies under signals; stop-if alarm; compliance checks | Week 2: "a signal and its result post without you typing" | Jack approves the map and a signal from his phone; result reply posts by itself |
| **2 — ABDUL + batch + Friday** | 22–31 Oct | MCP server and ABDUL verbs; Wednesday batch; scorecard image; Friday scoreboard with manual inputs; content log automatic; invite links + Telechurn import | Week 4: scorecard auto-posts Friday; first KPI sheet | Friday report arrives without Jack opening a spreadsheet |
| **3 — Repurposing** | Nov | Meta app Live; IG/FB/Threads direct; TikTok/YouTube/X publish kits; drop-folder fan-out; YouTube audit applied; metrics pollers | "Social reposts: set up once"; stop hand-posting | One TikTok reaches 7 places with only the TikTok, YouTube and X taps by hand; ≥60% hours cut |
| **4 — Community + tracking** | Nov–Dec | Moderation, scam watch, repeat-question detector; view snapshots; swap tracker; funnel view; reference benchmarks | Two channel swaps a week; Elite Circle opens | Every swap shows joins and 7-day retention |
| **5 — Studio + research** | Dec–Jan | Live clipping; TikTok research brief; CSI capture; double-down alerts | TikTok at full pace; lives | A live becomes clips without CapCut; Monday brief every week; ≥70% hours cut |
| **6 — Pilot readiness** | Jan 2027 | Ad landing attribution checked end to end; cost per FTD per campaign; quarter tracker | Broker pilot starts; EzyAI board goes public | Cost per FTD visible daily |
| **7 — Q1–Q2 extras** | Feb–Jun 2027 | YouTube long-form from Sunday lives; BM SEO article briefs; WhatsApp retention hooks; annual-plan offer variants | EzyAI launch, YouTube weekly, BM SEO, WhatsApp flows | As per Growth Plan monthly list |
| **8 — Revenue core** | After Phase 7 | Sales bot migration with parallel running | Bot merge (Growth Plan Q4) is Jack's separate track until then | Payments match the old bot for two weeks |

**Note on the Growth Plan's VPS item:** it suggests a $10–20/month VPS for the bots. TwinOS itself needs no server. The sales bots' hosting is a separate decision for Jack (§16).

---

## 14. Reuse list (ranked)

1. printezy migrations and attribution chain (`supabase/migrations/*`, `lib/analytics.ts`, telegram `webhook.ts`, `bot/meta.server.ts`).
2. Ops dashboard `outboundQueue.js`, `classifyMetaError`, `messageLog.claimWebhookEvent`.
3. Approval kit: sales bot `handlers/decision.py`, ops dashboard `approvalService` + `telegramAdminBot`, printezy `ebook:approve`, FAQ bot `submissionStore.js`, AI-OS app `contentStore.ts`.
4. Posting Kit prompts, rules and checklist (the PDF) as the voice and compliance base.
5. Copy tools `prompts/copy.ts` (humaniser, banned words, platform tone), `formats.ts`, `bulk.ts`.
6. Disclaimer strings: printezy `translations.ts`, sales bot `content.py`, signal bot `formatting/message.py`.
7. printezy signal endpoint + `docs/ezyai_signal_client.py`.
8. Signal bot `health.py`, `admin_alert`, `_send_safe`, `OutcomeStore.stats`, `calendar.py`, `quality.may_emit`.
9. Sales bot `channel_posts`, `build_keyboard`, `start_log.py`, `receipt.py`.
10. Macro bot `economic_calendar.py`, `scheduler/tasks.py`.
11. printezy `summarisePerformance` (strict win rate).
12. FAQ bot reply CSV tools and printezy `replies*.ts`.
13. ABDUL `mcp_serve`, `hub_call`, `tell_guest`, `redact`, `research`, `check_monitors`.
14. Viral carousel renderer.
15. Affiliate bot GitHub Actions cron as a free backup scheduler.

Outside patterns (no code copied): Postiz provider design, tg-spam rules, OpenShorts layouts, faster-whisper, auto-editor.

---

## 15. Cost

| Item | Cost |
|---|---|
| TwinOS backend | Hosted free allowance (option A) or Lovable's included usage (option B); check before choosing |
| Lovable | Jack's existing plan |
| Telechurn | Jack's existing subscription, kept |
| Meta, YouTube, Telegram APIs; Search Console, Bing | Free |
| Local AI and clipping | Electricity |
| Claude drafts | Through ABDUL's existing Claude route |
| X | Manual, or about $0.015 per post if Jack chooses |
| Signal bot, external host | Existing, unchanged |

---

## 16. Open questions for Jack

All ten questions from v3 were answered on 2026-10-01 (decisions 10–19). Remaining:

1. **Reference channel handles:** *answered 2026-10-02.* Handles are loaded in the `benchmarks` table only (never in this public repo). Gary Gold Trader was dropped and SandyFx added.
2. **Monthly price list:** *answered 2026-10-02.* The catalog's monthly prices stand as seeded and TradingView Pro is $29/mo next to $249 lifetime. EzyAI PRO's founding price is deferred to closer to the Q1 2027 launch.
3. **Supabase account:** *answered 2026-10-01.* The project is "Jack's Twin" (ap-southeast-1, Singapore) in Jack's own account.
4. **Ops bot name:** *answered.* `@EzyOps_bot` (`@EzyOpsBot` was taken). Jack creates it in @BotFather and stores the token in his keyring; TwinOS never sees it in a file.

---

## 17. Upgrade v4: navigation, UX and functions (added 2026-10-02)

**Why:** Phases 0–8 are built as far as the repo allows and the Desk loop passed live (`scripts/desk-tour.sh`, 2 Oct). What Jack touches every day is still rough: the Desk bot is typed commands with no menu, and the dashboard is flat text links with "Loading…" states. v4 makes both fast to drive with buttons, and adds the function upgrades found in Jack's other repos.

**Sources (read 2026-10-02):** Jack's repos ASAP-TeleBot (bot menus), tg_ezy_ai_os (dashboard flow, channel status), sambangold-products (visual style and motion), wsapi-dashboard (secrets and integrations), webcopy/viralai (prompt generator). Open source: grammY menu (stateless menus with stale-tap detection), aiogram-dialog (screen router, paging), shadcn-admin and cmdk (sidebar, command palette), Postiz (scheduler UX; AGPL, ideas only), OpenShorts (clip pipeline), pgmq / Supabase Queues and Realtime, tma.js (Telegram Mini Apps).

**Defaults until Jack says otherwise:** order is Wave 0 → 1 → 2 → 3 → 4. AI stays off by default and runs only on Jack's local model (NeuraOS / llama-server) through the PC worker; no cloud AI. The Mini App waits for Wave 4. Wave 2 is about 9 Lovable prompts, one per item, checked between prompts.

### Wave 0: fixes (do first)
- `content_items_desk_state_check` lacks `'kit'`: `fanout.ts` sets it and the update fails silently (6 kits live with no state). Migration adds `'kit'` and any states Waves 1–3 need (`awaiting_slot`), plus `desk_state_at` for a 30-minute expiry.
- Reschedule clears the card's keyboard though the item is still waiting; keep the buttons.
- Edit and Later prompts have no cancel and never expire.
- Contract test for the `tg-webhook` → `approve` hop (the 2 Oct 403 passed every unit test because each side was right alone).
- Dead-button test: every callback verb a keyboard builder emits has a handler.

### Wave 1: Desk bot navigation
Rules: callback_data ≤ 64 bytes; only Jack's id may press; the webhook is stateless (state lives in the DB); screens edit the same message in place (`editMessageText` / `editMessageReplyMarkup`); inline keyboards only, no reply keyboards.
1. Callback grammar v2: keep `verb:<id8>`; add `nav:<screen>[:<arg>]`, `pg:<screen>:<n>`, `nop`, and a short layout fingerprint so a tap on an outdated menu answers "outdated" and redraws (grammY menu pattern).
2. `/menu` (and `/start`) home panel: Status · Batch · Friday · Hours · Help. Each screen has ⬅️ Back and 🏠 Home rows; unknown routes fall back home (ASAP route table).
3. `setMyCommands` scoped to the Desk chat, run by `scripts/deploy.sh`.
4. Decision cards collapse to one status button ("✅ Approved · 08:00", "❌ Rejected", "🕒 13:00"); drop the extra "Approved" message.
5. `/batch` as a list with buttons per item (approve, edit, preview), 🔄 Refresh and "Approve ready (k)" behind a Yes / Cancel confirm that re-checks the list.
6. Later becomes quick picks: 13:00 · 18:00 · Tomorrow 08:00 · Custom… (`rs:<id8>:<slot>`).
7. Edit presets: Soften · BM · Shorter · Write my own, with ✖ Cancel and `force_reply`.
8. Fan-out button on approved cards (`fan:<id8>`).
9. Refresh on Status, Friday and Hours with an "updated hh:mm" stamp.
10. Paging (◀ n/N ▶) for long lists and a "pending drafts" screen.
11. Action buttons on moderation alerts (Ban · Mute 24 h · Ignore) and repeat questions (Add to FAQ · Dismiss).

### Wave 2: dashboard (Lovable)
Rules: frontend only; the anon key and the session JWT are the only credentials; writes only through Edge Functions or RPC; approval stays Jack-only with a confirm, never bulk or automatic, never on blocking findings; `[NEEDED:…]` always visible; no framer-motion or other heavy animation; `prefers-reduced-motion` respected; EzyMap green / gold / red, Inter + JetBrains Mono (the design check of 2 Oct agrees: dark slate with a green accent, dense layout, subtle motion).
1. Shared app-shell layout route: one auth guard, `useRole()`, a "no TwinOS role yet" screen.
2. Grouped sidebar from the existing shadcn `sidebar.tsx` with lucide icons and a pending badge (Today: Inbox, Calendar · Channel: Signals, Messages · Insights: Friday, Research · System: Health, Settings), collapses with Ctrl+\; bottom nav on phones.
3. Skeletons, empty states, and errors with Retry (an error never reads as "nothing pending").
4. Approval Inbox: inline approve/reject with optimistic removal, shadcn Dialog on desktop and Drawer on mobile, keys J/K/A/R/S/Esc and a `?` cheat sheet.
5. ⌘K command palette (existing `command.tsx`): pages, pending items, Refresh.
6. Motion and surface tokens from sambangold, recoloured green: card lift and sheen, 3px focus ring, pressed state, a 200–320 ms page fade.
7. Supabase Realtime instead of 60 s / 30 s polling: live pending badge, "new draft" toast, last-refresh dot.
8. Health as integration cards with "Check now"; a Settings / Integrations page that shows only "set / not set" and setup steps; never a secret, never reveal or copy.
9. Stat tiles on Friday and Signals, status tabs with counts on the Inbox, specific toasts ("Approved, posts 14:00 KL"), filter chips on Calendar and Research.

### Wave 3: functions
1. Integration status in `health`: required secret names per provider, `ready` / `needs-credentials`, names never values (tg_ezy `channels.ts`).
2. Live provider checks (Telegram `getMe`, Meta token debug), stored, alerting only on a change or a recovery (wsapi `accountHealth.js`).
3. Error alerts to the Desk with a cooldown per error and a repeat count (wsapi `systemAlert.js`).
4. Unknown-outcome guard in publish / fan-out: after a timeout, hold the retry and check before posting again (wsapi `outboundQueue.js`).
5. Hook and CTA library per pillar, platform and language, rotated least-recently-used, no AI.
6. Optional AI variants as a PC-worker job (`llm_variants`, off by default, local model only): 3 angles per platform as strict JSON (webcopy `copy.ts`), every variant through `compliance`, a blocking number guard (no price or percent that is not in Jack's raw lines), Jack picks on the Desk.
7. On top of 6: an Adjust button, TikTok / YouTube script kits with the risk line spoken, a grounded Monday brief writer.
8. Banned words and humanizer rules (EN + BM) in `compliance` as warnings, apart from the blocking financial-claim checks.

### Wave 4: bigger bets (each needs Jack's go)
1. Telegram Mini App for the Approval Inbox: a route in the same Lovable app, opened from the Desk menu button; an edge function verifies Telegram `initData` (HMAC) and issues the session.
2. Postiz-style calendar scheduler: per-platform preview, saved templates and signatures, delayed first comment.
3. Clip pipeline after OpenShorts: scene detection, AI moment scoring, face-following vertical reframe, hook overlay; candidates in a `clip_candidates` table approved on the Desk.
4. Fan-out on Supabase Queues (pgmq) with retries and a Desk alert on the last failure.

### Never
No secret in the browser, the repo or chat. No auto-approve or bulk approve. No AI market commentary (tg_ezy `/watch`, `/autopilot`). No reference-channel text fed to any model. No copying AGPL code (Postiz). Nothing posted to @ezymap by tests.

Checklist: `docs/PHASES.md` Phase 9 (Waves 0–4). Builder prompt: `docs/AI-CODER-PROMPT.md`.
