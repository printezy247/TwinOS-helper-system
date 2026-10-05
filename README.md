# TwinOS — EzyMap's operating system

**Status: Phase 0 (plan and mind), October 2026.**

TwinOS runs the EzyMap gold-trading Telegram channel so Jack's day goes to the
map, TikTok and people: it drafts posts from the Posting Kit templates, checks
them against the compliance checklist, waits for Jack's one tap, publishes on a
schedule, posts result replies under signals, tracks members with allowed
methods only, and produces the Friday scoreboard. The full plan is
[`UPGRADE-PLAN.md`](UPGRADE-PLAN.md) (v3.1, decisions in §0).

```
Jack (Telegram Desk group, dashboard, ABDUL) ─▶ one API, one set of rules
                                                ▼
                 Supabase (Jack's own project): Postgres + Edge Functions + pg_cron
        ▲ EzyAi / TradingView      ▲ @EzyOps_bot      ▲ printezy (read)     ▲ PC worker (outbound only)
```

## Repo layout

| Path | What | Owner |
|---|---|---|
| `supabase/migrations/` | the schema (plan §10), RLS, triggers, `mint_api_key()` | migrations agent |
| `supabase/seed.sql` | settings, products, brand facts, 17 templates, hooks, calendar | seed agent |
| `supabase/functions/_shared/` | auth (JWT or hashed key → role), roles, idempotency, action_log, Telegram client, compliance checklist, draft pipeline | this scaffold |
| `supabase/functions/<fn>/` | `content` `approve` `publish` `tg-webhook` `tv-webhook` `signals-ingest` `results` `health` `friday` `jobs` `links` | this scaffold |
| `workers/pc/` | Python worker on Jack's PC: drop folder, Telechurn CSV, backup, clips. Never opens a port | this scaffold |
| `bots/ops/` | @EzyOps_bot setup, permissions, webhook, Desk group flow | this scaffold |
| `apps/dashboard/` | Lovable-generated dashboard (GitHub sync) | Lovable |
| `apps/mcp/` | TwinOS MCP server for ABDUL (Phase 2) | mcp agent |
| `docs/` | runbooks and contracts (below) | — |
| `.github/workflows/ci.yml` | deno check + lint + tests, python unittest, sql lint (if a tool exists), secret-shape grep | — |

## Docs

- [`docs/SETUP.md`](docs/SETUP.md) — what only Jack can do, in order, per phase, with exact commands
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the shape (plan §7) and the eleven functions
- [`docs/API.md`](docs/API.md) — endpoints with request/response examples and the schema contract the functions assume
- [`docs/PHASES.md`](docs/PHASES.md) — checklist per phase (plan §13)
- [`docs/UPGRADE-IDEAS.md`](docs/UPGRADE-IDEAS.md) — research-driven upgrade ideas (Wave 5) with status per item
- [`docs/LOVABLE-KNOWLEDGE.md`](docs/LOVABLE-KNOWLEDGE.md) — paste into the Lovable project's knowledge
- [`bots/ops/README.md`](bots/ops/README.md), [`workers/pc/README.md`](workers/pc/README.md)

## Rules that do not bend

- **Approve is Jack only.** Dashboard with his login or his Telegram id in the Desk group. ABDUL has no approve verb.
- **Schema first.** Lovable never creates tables; the UI never writes tables, it calls functions.
- **No secret in any file.** Bot token, TradingView secret, platform tokens → Supabase function secrets; machine keys hashed in `api_keys`; Jack's copies in his keyring (`secret-tool`).
- **Allowed methods only.** Bot API, official APIs, Telechurn's own reports, manual entry. No personal-account automation, no scraping, no AI on group text.
- **Demo or shadow signals never reach a public post.**

## Local checks

```bash
cd supabase/functions && deno check --config deno.json _shared/*.ts */index.ts && deno test --allow-env _shared/
cd workers/pc && python3 -m unittest -v
```

## Licence

MIT, see [`LICENSE`](LICENSE).
