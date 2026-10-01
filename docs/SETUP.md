# SETUP — things only Jack can do, in order

Each step says which phase needs it (plan §13). Tokens go into the keyring or
Supabase function secrets, never into a file in this repo. Commands assume
Linux Mint with `secret-tool`, `curl`, `node`, `python3`.

Keyring entries used everywhere below (`service twinos key <name>`):

| key | value | used by |
|---|---|---|
| `url` | `https://<project-ref>.supabase.co` | PC worker, ABDUL |
| `apikey` | anon key (public, but keep it here anyway) | ABDUL's MCP, scripts |
| `worker_key` | `twk_pc_worker_…` | PC worker |
| `abdul_key` | `twk_abdul_…` | ABDUL's `twinos_call()` |
| `ops_bot_token` | from BotFather | webhook setup, `supabase secrets set` |
| `tv_secret` | random 32+ chars | TradingView alert URL |
| `db_url` | `postgresql://postgres.<ref>:…@…pooler.supabase.com:5432/postgres` | nightly backup |

---

## Phase 0 — Plan and mind (1–7 Oct)

### 0.1 Make `printezy247/EzyMap` private (plan §3.3, decision 19)
GitHub → repo → Settings → General → Danger Zone → **Change visibility → Private**.
Then rotate anything that was in the public history (licence server token if it ever was).

### 0.2 Supabase project (own account, option A)
1. https://supabase.com/dashboard → **New project** in Jack's own org (decide: same login as printezy's or a new one; plan §16 Q3).
   Name `twinos`, region **Southeast Asia (Singapore)**, generate a strong DB password → store it:
   `secret-tool store --label "TwinOS db password" service twinos key db_password`
2. Project → Settings → API: copy the project ref and anon key:
   ```bash
   secret-tool store --label "TwinOS url"    service twinos key url      # https://<ref>.supabase.co
   secret-tool store --label "TwinOS anon"   service twinos key apikey
   ```
3. Settings → Database → Connection string (Session pooler, port 5432) → store as `db_url`.
4. Install the CLI (`npm i -g supabase` or the .deb), log in, link, push, seed:
   ```bash
   cd ~/TwinOS-helper-system
   supabase login
   supabase link --project-ref <ref>
   supabase db push                       # applies supabase/migrations/*
   psql "$(secret-tool lookup service twinos key db_url)" -f supabase/seed.sql
   ```
5. Enable extensions the functions rely on: Database → Extensions → `pg_cron`, `pg_net` (both free tier).
6. Create the `assets` storage bucket (private, 45 MB file limit): Storage → New bucket → `assets`.

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
Mint with the `mint_api_key(name, role)` RPC from the migrations (it returns the plain key **once**):
```sql
select mint_api_key('jack-pc', 'pc_worker');
select mint_api_key('abdul', 'abdul');
select mint_api_key('ezyai-fly', 'ezyai');
```
Store each immediately:
```bash
secret-tool store --label "TwinOS worker key" service twinos key worker_key
secret-tool store --label "TwinOS abdul key"  service twinos key abdul_key
```
The EzyAi key goes to Fly: `fly secrets set TWINOS_SIGNAL_KEY=twk_ezyai_… -a <ezyai-app>`.
Revoke any time: `update api_keys set revoked_at = now() where name = 'jack-pc';`.

### 0.5 Ops bot (@EzyOpsBot) — see `bots/ops/README.md`
1. BotFather `/newbot` → token → `secret-tool store --label "EzyOps bot token" service twinos key ops_bot_token`.
2. `/setprivacy` Disable, `/setjoingroups` Enable, `/setcommands`.
3. Get Jack's Telegram id: message `@userinfobot` or `@getidsbot`; it goes into `settings.jack_telegram_id` (seed).

### 0.6 EzyMap Desk group (decision 17)
1. Telegram → New Group → name **EzyMap Desk** → add `@EzyOpsBot` → done. Keep it private, two members.
2. Get the chat id: forward any message from it to `@getidsbot` (or read `my_chat_member` in the function logs after step 0.8). It is negative (`-100…`).
3. Also note the channel id of `@ezymap` and, in Phase 4, the discussion group id.
4. Put them in `settings` (SQL Editor):
   ```sql
   insert into settings(key, value) values
     ('jack_telegram_id', '<id>'), ('tg_desk_chat_id', '-100…'), ('tg_channel_id', '-100…'),
     ('timezone', 'Asia/Kuala_Lumpur'), ('signal_expiry_hours', '48')
   on conflict (key) do update set value = excluded.value;
   ```

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
```bash
supabase functions deploy content approve publish signals-ingest results health friday jobs
supabase functions deploy tg-webhook tv-webhook --no-verify-jwt     # webhooks carry their own secret
```
Then set the Telegram webhook with the block in `bots/ops/README.md` and check `getWebhookInfo`.

### 0.9 Cron (SQL Editor; replace `<ref>` and paste the service-role key from Settings → API; it stays inside the database)
```sql
select vault.create_secret('<service-role-key>', 'twinos_service_key');
-- helper that calls a function as cron
create or replace function twinos_cron_call(fn text, body jsonb default '{}'::jsonb) returns void language sql as $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='twinos_service_key'),
      'x-twinos-actor','cron'),
    body := body);
$$;
select cron.schedule('publish-tick',   '* * * * *',     $$select twinos_cron_call('publish', '{"limit":10}')$$);
select cron.schedule('health-check',   '*/5 * * * *',   $$select twinos_cron_call('health/check')$$);
select cron.schedule('stop-if',        '*/15 * * * *',  $$select twinos_cron_call('results/stop-if')$$);
select cron.schedule('friday-inputs',  '0 1 * * 5',     $$select twinos_cron_call('friday/request-inputs')$$);  -- 09:00 MYT
select cron.schedule('nightly-backup', '0 19 * * *',    $$insert into jobs(kind,status,created_by) values ('backup','queued','cron')$$); -- 03:00 MYT
select cron.schedule('keep-alive',     '0 */6 * * *',   $$insert into health_checks(source,status) values ('scheduler','ok')$$);
```

### 0.10 Lovable project (dashboard) — option A, NOT Lovable Cloud
1. https://lovable.dev → **New project** → name `TwinOS`. In the first prompt say: *"Do not enable Lovable Cloud. I will connect my own Supabase project."*
2. Project settings → **Integrations → Supabase → Connect** → pick the `twinos` project (own account). Do **not** let Lovable create tables; the schema is in this repo.
3. Settings → **GitHub → Connect** → this repo (`TwinOS-helper-system`), branch `main`. Lovable writes under `apps/dashboard/` (ask it to use that folder in the first prompt).
4. Settings → **Knowledge** → paste the whole of `docs/LOVABLE-KNOWLEDGE.md`.
5. First build prompt: "Read the knowledge. Build the Approval Inbox screen only."

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

### 1.3 EzyAi push (plan §9.D.23)
In `tradernonymous/EzyAi`, point the existing signal client at TwinOS:
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
4. Generate long-lived tokens for the IG professional account, the Page and the Threads account (Graph API Explorer → exchange). Store: `supabase secrets set TWINOS_META_IG_TOKEN=… TWINOS_META_PAGE_TOKEN=… TWINOS_THREADS_TOKEN=…` (from the keyring, as in 0.7). Tokens expire in 60 days; `health` warns at 7 days left.
5. Limits to remember: IG 100 posts/24 h, FB Reels 30/24 h, Threads 250/24 h. Comment webhooks need Advanced Access → polled every 15 min instead.

### 3.2 YouTube API project + audit
1. https://console.cloud.google.com → New project `twinos` → Enable **YouTube Data API v3** → OAuth consent screen (External, Jack's email as test user) → OAuth client (Desktop).
2. Run the one-time OAuth flow on the PC (script in Phase 3), store the refresh token as `TWINOS_YT_REFRESH_TOKEN`.
3. Uploads stay **private** until Google's audit passes: fill the **YouTube API Services – Audit and Quota Extension Form** (free) with the publish-kit description. Until then the YouTube variant is a publish kit.

### 3.3 TikTok
Stays manual (decision 8): publish kit to Jack's phone; TikTok Studio schedule up to 10 days ahead.

---

## Phase 4 — Community + tracking (Nov–Dec)
- Create the discussion group linked to the channel; add `@EzyOpsBot` as admin (Delete, Ban, Invite via link); `settings.tg_discussion_chat_id`.
- Seed `mod_rules` (scam keywords, `link_new_member`, `impersonation`).
- Turn on join requests on the channel invite links (`creates_join_request`) for the captcha.

## Phase 5 — Studio + research (Dec–Jan)
- `pip install faster-whisper Pillow` on the PC; test `python3 twinos_worker.py --once` with a `clip` job.
- Google Search Console: verify printezy.money and add Jack's Google account; Bing Webmaster likewise.

## Phase 6–8
Covered in `docs/PHASES.md`; nothing to set up before Phase 5 is done.
