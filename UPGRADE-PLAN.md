# EzyMap TwinOS — Master Plan

**Status:** Draft · **Owner:** Jack · **Scope:** EzyMap only · **Supersedes:** previous UPGRADE-PLAN.md (generic tool list)

---

## 1. Objective

Consolidate EzyMap's scattered tooling into **one system with one database** that acts as the operational mind, cutting Jack's non-creative workload by up to 70%.

Jack retains the irreducible 30%: **his face on camera, market judgment, and partner relationships.** Everything else is fair game.

**Success metric:** Jack's weekly operational hours on EzyMap (scheduling, cross-posting, reporting, monitoring, admin), excluding content recording and trade decisions. Target ≥60% reduction by end of Phase 3, ≥70% by Phase 4.

---

## 2. Scope & non-goals

**In scope:** All EzyMap operations — content publishing, Telegram/TikTok distribution, sales/entitlements, signals distribution, analytics, health monitoring, community triage.

**Explicitly out of scope:** Sambang Gold, Aish Capital, 20 Pips Lab. No multi-tenant design and no per-owner permissions. This removes significant complexity — do not reintroduce it.

**Non-goal:** Rewriting the signal engine. EzyAi's analysis is an asset, not debt.

---

## 3. Current state (verified)

| System | Role | Stack | Hosting |
|---|---|---|---|
| **EzyAi** (`tradernonymous/EzyAi`, private) | Signals, outcomes, health alerts | Py 3.13, ptb 21.6+, 328 tests | Fly.io `ezyai` (ams) |
| **ASAP-TeleBot** (private) = `@EzyRegisterBot` | Sales, payments, MT5 licensing, post store, attribution | Py 3.11, ptb 22.8, EN/BM | **PythonAnywhere free** |
| **tg-ezy-chatbot** / **tg_ezy_ai_os** | Funnel automation, "marketing OS" | Node/Python | unverified |
| **wsapi** / **wsapi-dashboard** | WhatsApp campaigns | — | unverified |
| **printezy** | EzyMap brand site | Lovable | Lovable |
| **stripe_payment_gateway**, **TG-database** | Payments, client data | — | — |
| **TwinOS-helper-system** | This repo — the target | — | GitHub |

**Key findings driving this plan:**

- `@EzyRegisterBot` already contains `channel_posts_store.py`, `dashboard.py`, `ad_attribution.py` — **the seeds of the content + dashboard + attribution layer already exist.** Extend, don't rebuild.
- EzyAi has **health beats and admin alerting already built** — reuse that pattern for monitoring.
- EzyAi stores state in JSON on a Fly volume; it has **no database**. Fine for signals, wrong for a content queue.
- The revenue bot sits on **PythonAnywhere free tier** — fragile under increased write load.

**The core problem is not missing features. It's fragmentation.** Eight systems doing pieces means the cost is context-switching, not capability.

---

## 4. Target architecture

```
        Jack ── voice/chat ──▶ ABDUL ─────────┐
        Jack ── browser   ──▶ Lovable UI ─────┤
                                              │  same authenticated API
                                       ┌──────▼───────┐
                                       │  TwinOS API  │  ← business rules
                                       └──────┬───────┘
                                              │
                                       ┌──────▼───────┐
                                       │   SUPABASE   │  ← THE MIND
                                       │   Postgres   │
                                       └──────▲───────┘
                                              │ writes
                                       ┌──────┴───────┐
                                       │    EzyAi     │  ← muscle
                                       │   Fly.io     │
                                       └──────────────┘
```

| Layer | Role | Tool |
|---|---|---|
| **Mind** | Single source of truth | Supabase Postgres |
| **Rules** | Business logic, approval gate, audit | TwinOS API (Supabase Edge Functions or FastAPI) |
| **Face** | Jack's dashboard & approval inbox | Lovable → React |
| **Voice** | Conversational control | ABDUL via MCP |
| **Muscle** | Heavy signal computation | EzyAi, Python on Fly.io |

**Critical:** Supabase Edge Functions are Deno/TypeScript, built for short request/response. They cannot host EzyAi's technical analysis. **The signal engine stays Python on Fly.io and pushes into Supabase.** Do not attempt to port it.

---

## 5. Six principles

1. **Strangle, don't rewrite.** Move seams first, revenue last. A big-bang rewrite of a live Stripe/MT5 pipeline is the highest-risk move available.
2. **One writer per concern.** Every action goes through the API. No direct client→table writes from Lovable, no raw DB access for ABDUL. Otherwise rules diverge.
3. **Approval gate is non-negotiable.** Nothing containing a price, trade, or offer publishes without Jack's explicit tap — regardless of whether Jack, ABDUL, or a cron initiated it.
4. **Execution is wake-independent.** ABDUL runs on Jack's laptop, which sleeps. Scheduling and publishing must execute server-side. ABDUL *commands*; TwinOS *executes*.
5. **Secrets in keyring, never in files.** Service-role keys never reach the frontend or the repo.
6. **Numbers counted from code.** No unverified claims; "verified" only when the check ran.

---

## 6. The mind — Supabase schema

**Identity & revenue**

- `users` — telegram_id, username, language (EN/BM), tier, source_link_id, created_at
- `payments` — user_id, provider (stripe/usdt/stars), amount, currency, status, provider_ref, created_at
- `entitlements` — user_id, product_code, tier, granted_at, expires_at
- `products` — code, name, tier, price, currency

**Content operations (the main time sink)**

- `content_queue` — id, platform, content_type, body, media_url, status (`draft`/`pending_approval`/`approved`/`published`/`failed`), scheduled_for, published_at, requires_approval(bool), created_by
- `action_log` — id, **actor** (`jack`/`abdul`/`dashboard`/`cron`), action, target_type, target_id, payload, created_at ← *mandatory audit trail*

**Signals** (fed by EzyAi)

- `signals` — id, pair, direction, entry, stop, targets, confidence, timeframe, created_at, status
- `signal_outcomes` — signal_id, result, hit_at, r_multiple

**Growth & attribution**

- `source_links` — code, platform, campaign, invite_url, created_at
- `member_sources` — user_id, source_link_id, joined_at, left_at, invite_source

**Operations**

- `health_checks` — service, status, last_beat_at, detail, checked_at

Enable **RLS** from day one. Define this schema **before** pointing Lovable at Supabase — otherwise Lovable generates direct table calls that you will immediately rewrite.

---

## 7. The rules — API surface

Both Lovable and ABDUL call this. Same endpoints, same permissions.

| Endpoint | Purpose | Who may call |
|---|---|---|
| `POST /content/draft` | Create draft | jack, abdul |
| `POST /content/{id}/approve` | **Publish gate** | **jack only** |
| `POST /content/{id}/schedule` | Server-side job | jack, abdul |
| `GET /content/inbox` | Pending approvals | all |
| `GET /analytics/posts` | Performance | all |
| `GET /analytics/sources` | Attribution | all |
| `POST /source_links` | Tracked invite link | jack, abdul |
| `GET /health` | Service status | all |
| `POST /signals/ingest` | EzyAi → Supabase | cron (scoped key) |

---

## 8. The voice — ABDUL control layer

ABDUL becomes a **client of the API**, not a database client. Implement a thin **MCP server** (`apps/mcp/`) exposing typed tools, so ABDUL and any future agent control TwinOS without guessing endpoints. Supabase ships an official MCP server — do **not** point ABDUL at raw tables; that bypasses the rules.

**Capabilities:**

| ABDUL command | Result |
|---|---|
| "Draft tomorrow's XAUUSD post" | Draft → approval inbox, waits |
| "Approve the last draft" | Publishes — **explicit instruction only** |
| "Schedule two TikTok reposts" | Server-side jobs |
| "How did yesterday's post do?" | Reads analytics |
| "Anything broken?" | Reads health — kills Z3-feed babysitting |
| "Which source brought members?" | Reads attribution |

**Guardrail:** ABDUL may **create drafts and read everything**. It publishes **only on explicit Jack instruction**. Regulators hold Jack accountable regardless of who drafted it — so the tap stays human.

---

## 9. Roadmap

| Phase | Weeks | Deliverable | Exit criteria |
|---|---|---|---|
| **0 — Mind** | 1 | Supabase project, full schema, RLS, `action_log` | Tables queryable, empty |
| **1 — Face** | 2–3 | Lovable dashboard: approval inbox, calendar, health | Jack approves a real post from the dashboard |
| **2 — Voice** | 4 | TwinOS API + MCP; ABDUL commands live | ABDUL drafts + reads successfully |
| **3 — Pipeline** | 5–6 | EzyAi→Supabase ingest, auto-drafts, cross-post, weekly digest | ≥60% hours cut |
| **4 — Pocket** | 7+ | PWA push approvals | ≥70% hours cut |

**Do not skip Phase 0.** Lovable built against an undefined schema generates throwaway code.

---

## 10. Lovable build order (use the Pro month)

Build in this sequence — each is independently useful:

1. **Approval Inbox** — highest value: drafts queue + tap-to-approve
2. **Content Calendar** — drag-drop scheduling
3. **Health / status page** — replaces manual feed checks
4. **Analytics + attribution** — which sources produce retained members
5. **Signal board** — read-only view of EzyAi output

Connect Lovable's **GitHub sync** to this repo so generated code lands in one place.

---

## 11. Migration — strictly risk-ascending

| Order | Move | Risk |
|---|---|---|
| 1 | Content & publishing → Supabase | Low |
| 2 | Health monitoring & alerting | Low |
| 3 | Analytics & attribution | Low |
| 4 | (Optional) Funnel bots consolidate | Medium |
| 5 | **`@EzyRegisterBot` revenue core** | **High — LAST, payments parallel-running** |

Never move payments first. Retire old repos only after the destination carries live traffic.

---

## 12. Compliance & guardrails

- **SC Malaysia** revised advertising guidance covers social media and finfluencers — including creators not formally engaged. Even unpaid promotion of capital-market products can fall in scope.
- **TikTok financial-services policy** has Malaysia-specific requirements (CBM / SC registration) and restricts high-risk/forex trading promotions in many markets.
- Enforce: every post carries required risk language; losses stay visible; results matched to the board before posting. Automate the disclaimer block so it cannot be omitted.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Stripe/MT5 regression during migration | Move last, parallel-run, keep old bot live until proven |
| PythonAnywhere free tier buckles | Migrate revenue bot early in the sequence, ahead of volume growth |
| EzyAi Z3 feed instability persists | Ship Phase 2 health monitoring early — visibility before repair |
| Lovable output diverges from schema | Schema-first; regenerate screens rather than hand-patching |
| Scope creep back to 4 brands | Explicit non-goal; revisit only after Phase 4 |

---

## 14. Open decisions

1. **Supabase:** new project or reuse existing EzyMap one?
2. **Repo structure:** monorepo holding everything, or orchestration + dashboard only while the sales core stays in ASAP-TeleBot until migrated? *(Recommendation: monorepo, importing sales code last.)*
3. **API runtime:** Supabase Edge Functions (Deno/TS) vs FastAPI on Fly.io *(Recommendation: Edge Functions if logic stays light; FastAPI if you port significant existing Python.)*
4. **PWA vs native Android:** recommend PWA first.

---

## 15. Appendix — tool shortlist

Retained from the earlier survey; only the parts still relevant to a single-brand EzyMap:

- **Topic research:** TikTok Creator Search Insights, TikTok Creative Center — free, native
- **Editing:** CapCut (templates), Canva (graphics)
- **Native publishing:** TikTok Studio, Meta Business Suite, YouTube Studio
- **Scheduling (pick one):** Metricool (analytics-led) or Repurpose.io (video distribution-led)
- **Telegram analytics/attribution:** Telechurn (invite-link retention), TGStat (discovery), named invite links
- **Community:** retain Sarah bot for FAQs; Combot only if moderation load grows
- **Clip extraction:** OpusClip or Vizard, always human-reviewed for financial accuracy
- **Avoid:** purchased members/views/reactions — they corrupt exactly the metrics this plan depends on
