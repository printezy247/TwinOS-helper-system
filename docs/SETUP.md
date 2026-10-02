# SETUP — things only Jack can do, in order

Each step says which phase needs it (plan §13). Tokens go into the keyring or
Supabase function secrets, never into a file in this repo. Commands assume
Linux Mint with `secret-tool`, `curl`, `node`, `python3`.

Keyring entries used everywhere below (`service twinos key <name>`):

| key | value | used by |
|---|---|---|
| `url` | `https://<project-ref>.supabase.co` | PC worker, ABDUL |
| `apikey` | anon key (public; the gateway needs it in front of every `twk_` key) | PC worker, ABDUL's MCP, scripts |
| `db_url` | `postgresql://postgres.<ref>:…@…pooler.supabase.com:5432/postgres` | seeding, the smoke test, nightly backup |
| `db_password` | the project's DB password | direct `psql` if the pooler refuses |
| `worker_key` | `twk_pc_worker_…` | PC worker |
| `abdul_key` | `twk_abdul_…` | ABDUL's MCP and `twinos_call()` |
| `ezyai_key` | `twk_ezyai_…` | copied once to the signal bot's host as `TWINOS_SIGNAL_KEY` |
| `ops_bot_token` | from BotFather | webhook setup, `supabase secrets set` |
| `tv_secret` | random 32+ chars | TradingView alert URL |

Nothing here is ever written into a repo file. The Edge Functions get their own
copies through `supabase secrets set` (step 0.7), and the database through Vault
(step 0.9).

---

## Phase 0 — Plan and mind (1–7 Oct)

### 0.1 Make the EzyMap indicator repo private (plan §3.3, decision 19)
GitHub → repo → Settings → General → Danger Zone → **Change visibility → Private**.
Then rotate anything that was in the public history (licence server token if it ever was).

### 0.2 Supabase project (own account, decision 10 — never Lovable Cloud)

**Order matters: create the project → enable extensions → push migrations → seed.**
Extensions first, because `0006` degrades its embedding columns to `real[]` when
pgvector is missing, and getting them back means re-pushing.

**1. Create it.** https://supabase.com/dashboard → **New project**, in Jack's own
org. Name `twinos`, region **Southeast Asia (Singapore)** (decision 4 — the data
stays in MY). Strong DB password, straight into the keyring:

```bash
secret-tool store --label "TwinOS db password" service twinos key db_password
```

**2. Enable the extensions.** Dashboard → Database → Extensions → Enable:

| extension | why it matters | if it is missing |
|---|---|---|
| `pg_cron` | the clock that publishes posts and runs health checks | nothing automated runs at all |
| `pg_net` | lets `pg_cron` reach the Edge Functions over HTTPS | same |
| `vector` (pgvector) | embeddings for research (§9.K) | columns fall back to `real[]`; research still works, without similarity search |

All three are free tier. `0001` and `0006` guard them, so a failure downgrades
rather than aborts — but a NOTICE during `db push` is worth reading, not
scrolling past.

**3. Create the `assets` bucket.** Storage → New bucket → `assets`, **private**,
file size limit 45 MB. Public would put Jack's clips behind a guessable URL.

**4. Copy the three values into the keyring.** Dashboard → Settings → API, and
→ Database → Connection string (Session pooler, port 5432):

```bash
secret-tool store --label "TwinOS url"    service twinos key url      # https://<ref>.supabase.co
secret-tool store --label "TwinOS anon"   service twinos key apikey   # anon key: public, kept in one place anyway
secret-tool store --label "TwinOS db url" service twinos key db_url   # session pooler DSN
```

**5. Link and push.**

```bash
cd ~/TwinOS-helper-system
npm i -g supabase                          # or the .deb from supabase.com/docs/guides/cli
supabase login                             # browser auth; paste the URL it prints
supabase link --project-ref <ref>          # remembers the project ref (supabase/.temp)
supabase db push                           # applies supabase/migrations/0001…0017
```

`db push` echoes each migration as it applies. **If any line fails, stop and send
me the output** — a half-applied schema is worse than none, and every migration
here is written so a retry is safe.

**6. Seed.** `db push` does *not* do this; it has to be a separate step:

```bash
psql "$(secret-tool lookup service twinos key db_url)" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

No `psql` on this PC? Open the dashboard's **SQL Editor** and paste the file
(18 KB, runs in about a second). Then check it landed:

```sql
select (select count(*) from templates)      as templates,   -- expect 15  (the Posting Kit's 15 post types)
       (select count(*) from brand_facts)    as brand_facts, -- expect 25
       (select count(*) from personas)       as personas,    -- expect 6   (the six ICPs)
       (select count(*) from hooks)          as hooks,       -- expect 40  (20 pairs, EN + MS)
       (select count(*) from calendar_slots) as calendar,    -- expect 47  (28 days + the weekly rhythm)
       (select count(*) from live_runsheets) as run_sheets,  -- expect 3
       (select count(*) from mod_rules)      as mod_rules,   -- expect 8
       (select count(*) from benchmarks)     as benchmarks,  -- expect 5   (handles NULL until §16 Q1)
       (select count(*) from style_guide)    as style_guide, -- expect 102
       (select count(*) from settings)       as settings;    -- expect 38
```

Those are the seed's real numbers, counted against a live database.
`benchmarks` deliberately ships with `handle IS NULL`: the five reference channels
are named in the plan, but their handles are Jack's to supply (§16 Q1), and a
guessed handle is worse than a blank one.

**7. Run the smoke test** — the same asserts CI runs on every push. A clean run
prints a NOTICE per section and ends in `ROLLBACK`, so it leaves nothing behind:

```bash
psql "$(secret-tool lookup service twinos key db_url)" -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
```

A failed assert prints e.g. `ASSERT_FAILURE: only jack may approve`. That line is
the whole diagnosis — send it to me as it is.

### 0.3 Jack's login and role claim
1. Authentication → Users → **Add user** with Jack's email, confirm it.
2. Give that user the `jack` claim (plan §9.B.9; `_shared/auth.ts` reads `app_metadata.twinos_role`):
   ```sql
   update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"twinos_role":"jack"}'
    where email = '<jack email>';
   ```
   Run in SQL Editor. Any other login is `dashboard` (read-mostly). Nobody else gets `jack`.

### 0.4 Scoped API keys (table `api_keys`, hashed)
One command, from your own terminal (it needs the desktop keyring):
```bash
cd ~/TwinOS-helper-system && ./scripts/mint-keys.sh
```
It stores `url` and the public anon key (`apikey`) if they are missing, then
mints `abdul`, `pc-worker` and `ezyai` keys with `rotate_api_key()` and pipes
each one straight into the keyring (`abdul_key`, `worker_key`, `ezyai_key`).
Only the 12-character prefix is ever printed. Re-running it changes nothing.

```bash
./scripts/mint-keys.sh --list            # names, prefixes, last used, revoked (no secrets)
./scripts/mint-keys.sh --rotate worker   # new key for the PC worker; the old one stops working at once
./scripts/mint-keys.sh --revoke ezyai    # switch a key off and remove it from the keyring
```

Callers send the anon key as `Authorization: Bearer …` and their own key as
`X-TwinOS-Key: …` (the platform gateway only admits JWTs; see `docs/API.md`).
The signal bot's key goes to its host as `TWINOS_SIGNAL_KEY`, with the anon key
next to it.

### 0.5 Ops bot (@EzyOps_bot) — see `bots/ops/README.md`
1. BotFather `/newbot` → token → `secret-tool store --label "EzyOps bot token" service twinos key ops_bot_token`.
2. `/setprivacy` Disable, `/setjoingroups` Enable, `/setcommands`.
3. Get Jack's Telegram id: message `@userinfobot` or `@getidsbot`; it goes into `settings.jack_telegram_user_id` (seed).

### 0.6 EzyMap Desk group (decision 17)
1. Telegram → New Group → name **EzyMap Desk** → add `@EzyOps_bot` → done. Keep it private, two members.
2. Get the chat id: forward any message from it to `@getidsbot` (or read `my_chat_member` in the function logs after step 0.8). It is negative (`-100…`).
3. Also note the channel id of `@ezymap` and, in Phase 4, the discussion group id.
4. Put them in `settings` (SQL Editor). `settings.value` is **`jsonb`**, so every
   value is a JSON literal: `'"…"'` for a string, `'123…'` for a number, `'null'`
   for "not set yet". A bare `'Asia/Kuala_Lumpur'` is a syntax error, not a
   string.
   The keys below are the ones the seed creates *and* the ones the functions read
   (`_shared/supabase.ts`, `SETTING_KEYS`). A different name fills a row nobody
   reads: the Desk bot gets `null` and refuses to answer, and the Friday views
   see no members.
   ```sql
   insert into settings(key, value) values
     ('jack_telegram_user_id', '6282941580'),
     ('desk_group_chat_id', '-1001234567890'),
     ('channel_chat_id', '-1009999999999'),
     ('timezone', '"Asia/Kuala_Lumpur"'),
     ('signal_expiry_hours', '48'),
     ('edge_base_url', '"https://<ref>.supabase.co/functions/v1"')
   on conflict (key) do update set value = excluded.value;
   ```
   Check nothing is left unset (the seed flags 10 rows `needs_confirm`):
   ```sql
   select key, value from settings where value = 'null'::jsonb order by key;
   ```
   Anything still `null` here will make a function return `503 not_configured`
   naming the key — that is the intended failure, not a bug.

### 0.7 Function secrets
```bash
cd ~/TwinOS-helper-system
supabase secrets set \
  TWINOS_OPS_BOT_TOKEN="$(secret-tool lookup service twinos key ops_bot_token)" \
  TWINOS_TV_SECRET="$(openssl rand -hex 24 | tee >(secret-tool store --label 'TwinOS TV secret' service twinos key tv_secret))"
supabase secrets list      # names only, never values
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

### 0.8 Deploy the functions
Ten functions, in two batches. The first eight need JWT verification on; the two
webhooks cannot carry a header, so they carry their own secret instead
(`--no-verify-jwt`):

```bash
cd ~/TwinOS-helper-system
supabase functions deploy content approve publish signals-ingest results health friday jobs
supabase functions deploy tg-webhook tv-webhook --no-verify-jwt
```

**Prove it before moving on.** This is the Phase 1 gate, so check it rather than
assuming:

```bash
supabase functions list                       # all ten should be "deployed"
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://$(secret-tool lookup service twinos key url | sed 's|https://||')/functions/v1/health"
# 401 or 403 is correct — the route exists and is refusing an anonymous caller.
# 404 means it did not deploy.
```

Then set the Telegram webhook with the block in `bots/ops/README.md` and confirm
with `getWebhookInfo` that `url` is set and `last_error_message` is empty.

### 0.9 Cron (SQL Editor)

**Do not create `twinos_cron_call` — migration `0010_cron.sql` already made it.**
It reads `settings.edge_base_url` and a Vault secret named by
`settings.cron_secret_name`, both of which the seed creates, so there is nothing
to hardcode. Two things must be true first, or every job silently does nothing
(the function raises a NOTICE and returns null — no error, no HTTP call):

```sql
-- 1. the secret the function will send as its bearer token.
--    Paste the service_role key from Settings → API. It never leaves the database.
select vault.create_secret('<service-role-key>', 'twinos_cron_secret');

-- 2. prove the plumbing works before scheduling anything
select public.twinos_cron_call('health');
--    → a number (the pg_net request id) means it fired
--    → a NOTICE about edge_base_url / the secret means one of the two is unset
```

Then schedule. These are the routes that exist today — `publish`, `health`,
`results`, `friday`, `content`, `jobs`, `approve`, `signals-ingest`:

```sql
-- pg_cron runs in UTC; MYT = UTC+8
select cron.schedule('twinos-publisher-tick', '* * * * *',    $$select public.twinos_cron_call('publish')$$);
select cron.schedule('twinos-health',          '*/5 * * * *',  $$select public.twinos_cron_call('health/check')$$);
select cron.schedule('twinos-stop-if',         '*/10 * * * *', $$select public.twinos_cron_call('results/stop-if')$$);
select cron.schedule('twinos-friday-inputs',   '0 1 * * 5',    $$select public.twinos_cron_call('friday/request-inputs')$$); -- 09:00 MYT
select cron.schedule('twinos-nightly-backup',  '0 19 * * *',   $$insert into jobs(kind,status,created_by) values ('backup','queued','cron')$$); -- 03:00 MYT
select cron.schedule('twinos-keepalive',       '0 */6 * * *',  $$select 1$$);  -- keeps a free-tier project from pausing (§8)
select cron.jobid, jobname, schedule from cron.job order by jobname;   -- check
select cron.unschedule('twinos-health');                               -- remove one
```

`0010_cron.sql` also carries commented examples for later phases
(`content/batch`, `desk/remind-map`, `metrics/snapshots`). Those functions do not
exist yet — scheduling them now just produces 404s.

### 0.10 Lovable project (the dashboard) — decision 11, NOT Lovable Cloud

Lovable is only the **face**. The rules engine, the approval gate and all the
automation live in Jack's own Supabase. Lovable must never become a second
database.

**Done (2 Oct 2026).** Project **TwinOS** in the PrintEzy workspace,
id `8aa151d6-f29b-4fba-8daf-345c4df50963`
(editor: https://lovable.dev/projects/8aa151d6-f29b-4fba-8daf-345c4df50963).
It was created over the Lovable MCP as a **frontend-only** app: no Lovable
Cloud (database status: not enabled), no Supabase integration, no migrations.
It talks to this project with `@supabase/supabase-js`, the public URL and the
public publishable key (`src/lib/supabase.ts`), and changes data only through
`supabase.functions.invoke('approve', …)`. Its project knowledge is
`docs/LOVABLE-KNOWLEDGE.md`; keep the two in sync.

The dashboard's code lives in the Lovable project, not in this repo: Lovable's
GitHub sync creates its own repository and cannot write into a subfolder here.
If you want a copy on GitHub, Lovable → **GitHub → Connect** creates
`printezy247/twinos-dashboard` (optional).

Built so far: **Login** (email + password, no sign-up) and the **Approval
Inbox** (pending/draft items, Telegram-style preview, findings by severity,
`[NEEDED` in red, Approve/Reject/Reschedule only for `twinos_role = jack`,
Approve hidden on blocked drafts, confirm dialog, 60 s refresh, 390 px).

Check it after each new screen:

- Does it only *read* tables and change things through `invoke`?
- Did it create a migration, a table or Lovable Cloud? It must not.
- Does the Approve button *disappear* for a non-`jack` login?
- Does it still work at 390 px?

**Screen order**, one prompt each, verify between: Approval Inbox (done) →
Content Calendar → Health → Analytics/Friday → Signal board → Research → Inbox.

**Auth.** Jack's login is `printezyusd@gmail.com` with `app_metadata.twinos_role
= jack`. Row-level security reads that claim since migration 0016. The second
login (`jack@printezy.money`) has no role and reads nothing until it is given
one (step 0.3). There is no public registration.

**Publishing** (optional): the preview only opens for workspace members. To use
it on the phone without the Lovable login, press **Publish** in the editor; the
app still needs your Supabase login, and RLS guards the data.

### 4.1 Discussion group moderation (Phase 4)
1. Link a discussion group to the @ezymap channel (channel settings → Discussion). Add `@EzyOps_bot` to the group as an **admin** with *Delete messages*, *Ban users* and *Invite users via link* (restrict is part of ban).
2. Put the group's chat id in `settings` (a negative number, `-100…`):
   ```sql
   update settings set value = '-1001234567890' where key = 'discussion_group_chat_id';
   ```
3. The rules are the `mod_rules` rows from the seed. Read them in the dashboard or SQL (`select key, kind, action, enabled from mod_rules;`); switch one off with `update mod_rules set enabled = false where key = '…';`.
4. What the bot does, and never does: scam phrases are deleted with a warning (second strike: a 24 hour mute, third: ban); a member younger than 24 hours cannot post links or handles (t.me/ezymap and printezy.money pass); a name that copies Jack's or EzyMap's is **flagged to the Desk and nothing is removed**; a question asked twice is posted to the Desk for the FAQ sheet (`select * from v_repeat_questions;`). Jack and group admins are never moderated. It reads no member text with AI.
5. Join requests: create invite links with *approval required* (`POST /links` with `creates_join_request`). Each request is checked against cas.chat; a banned account is declined and logged, everyone else gets a private "I am a person" button and is let in when they tap it.

### 0.11 Baseline week, price list, benchmark study
Not technical: log hours by task for one week (`baseline_hours`), decide the monthly price list (§16 Q2) and give the five reference-channel handles (§16 Q1).

---

## Phase 1 — Desk loop (8–21 Oct)

### 1.1 PC worker
Follow `workers/pc/README.md` (keyring `url`, `worker_key`, `db_url`; folders; systemd user unit).

### 1.2 TradingView alert webhook (decision 13)
TradingView → chart → Alerts → **Create alert** on the EzyMap indicator:
- *Notifications* tab → **Webhook URL**:
  `https://<ref>.supabase.co/functions/v1/tv-webhook?secret=<tv_secret>` (`secret-tool lookup service twinos key tv_secret`)
- *Message* (JSON; placeholders are TradingView's):
  ```json
  {"id":"{{ticker}}-{{timenow}}","symbol":"{{ticker}}","tf":"{{interval}}",
   "side":"buy","entry":{{close}},"sl":{{plot("SL")}},"tp1":{{plot("TP1")}},"tp2":{{plot("TP2")}},
   "setup":"{{strategy.order.comment}}","counter_trend":false}
  ```
  One alert per direction (`"side":"sell"` for the other). If the indicator exposes a counter-trend plot, set `"counter_trend":{{plot("CT")}}` so the card keeps the warning line.
- TradingView only sends to ports 80/443 and cannot set headers, hence the query-string secret.

### 1.3 Signal bot push (plan §9.D.23)
In the signal bot's repo, point the existing signal client at TwinOS:
`EZYMAP_SITE_URL=https://<ref>.supabase.co/functions/v1` and path `/signals-ingest`,
key from 0.4. Same contract as printezy (`docs/API.md`).

### 1.4 Invite-link convention (plan §5)
`src-campaign-yymm`, lowercase: `tt-live-2610`, `ig-bio-2610`, `swap-<partner>-2611`. Create links only through TwinOS (`POST /links`, Phase 2) so Telechurn and TwinOS see the same names.

---

## Phase 2 — ABDUL, batch, Friday (22–31 Oct)
- Register the MCP server (`apps/mcp/`, other agent) next to `abdul mcp`; ABDUL reads `abdul_key` from the keyring.
- Telechurn: each Friday copy the weekly numbers into `~/EzyMap/telechurn/<monday>.csv` (no export on Jack's plan, decision 16) or into the dashboard form.
- Vantage portal numbers: Friday form in the dashboard (Analytics → Friday) or tell ABDUL.

---

## Phase 3 — Repurposing (Nov)

### 3.1 Meta app (Instagram + Facebook + Threads)
1. https://developers.facebook.com → **Create app** → use case *"Other"* → type **Business**.
2. Add products: **Instagram** (choose the **Instagram API with Instagram Login** path, not Facebook Login), **Threads API**, and for Facebook Reels the **Pages** permissions (`pages_manage_posts`, `pages_read_engagement`).
3. App settings → Basic → fill privacy URL (printezy.money/privacy) → **App Mode: Live**. Standard Access is enough for Jack's own accounts; no App Review.
4. Generate long-lived tokens for the IG professional account, the Page and the Threads account (Graph API Explorer → exchange), and note each account's numeric id. Store all of it as function secrets, nothing in a file or the repo (values from the keyring, never typed into a command that is saved in history):
   ```bash
   supabase secrets set \
     TWINOS_META_IG_USER_ID=… TWINOS_META_IG_TOKEN=… TWINOS_META_IG_EXPIRES=YYYY-MM-DD \
     TWINOS_META_PAGE_ID=…    TWINOS_META_PAGE_TOKEN=… TWINOS_META_PAGE_EXPIRES=YYYY-MM-DD \
     TWINOS_THREADS_USER_ID=… TWINOS_THREADS_TOKEN=… TWINOS_THREADS_EXPIRES=YYYY-MM-DD
   ```
   Tokens last 60 days. The `*_EXPIRES` dates are what lets `health` warn 7 days before one lapses (a Desk message and a dashboard alert, once a day). A provider with no id and token is simply off: its jobs fail as `permanent: … is not configured`, they never queue silently.
5. Limits to remember: IG 100 posts/24 h, FB Reels 30/24 h, Threads 250/24 h. Comment webhooks need Advanced Access → polled every 15 min instead.

### 3.2 YouTube API project + audit
1. https://console.cloud.google.com → New project `twinos` → Enable **YouTube Data API v3** → OAuth consent screen (External, Jack's email as test user) → OAuth client (Desktop).
2. Run the one-time OAuth flow on the PC (script in Phase 3), store the refresh token as `TWINOS_YT_REFRESH_TOKEN`.
3. Uploads stay **private** until Google's audit passes: fill the **YouTube API Services – Audit and Quota Extension Form** (free) with the publish-kit description. Until then the YouTube variant is a publish kit.

### 3.3 TikTok
Stays manual (decision 8): publish kit to Jack's phone; TikTok Studio schedule up to 10 days ahead.

---

## Phase 4 — Community + tracking (Nov–Dec)
- Create the discussion group linked to the channel; add `@EzyOps_bot` as admin (Delete, Ban, Invite via link); `settings.discussion_group_chat_id`.
- Seed `mod_rules` (scam keywords, `link_new_member`, `impersonation`).
- Turn on join requests on the channel invite links (`creates_join_request`) for the captcha.

## Phase 5 — Studio + research (Dec–Jan)
- `pip install faster-whisper Pillow` on the PC; test `python3 twinos_worker.py --once` with a `clip` job.
- Google Search Console: verify printezy.money and add Jack's Google account; Bing Webmaster likewise.

## Phase 6–8
Covered in `docs/PHASES.md`; nothing to set up before Phase 5 is done.
