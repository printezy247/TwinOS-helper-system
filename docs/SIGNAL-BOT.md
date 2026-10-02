# Signal bot → TwinOS (`signals-ingest`)

Handoff for the EzyAi signal-bot repo. The bot pushes its signals and outcomes
to TwinOS here; TwinOS turns the ones Jack approves into channel posts, and
posts result replies by itself when a signal closes.

Same contract as printezy's `/api/public/ezyai/signals` (plan §9.B.10, §9.D.23).

## 1. Endpoint and auth

```
POST https://cdnyybrfoclexjlroqcf.supabase.co/functions/v1/signals-ingest
```

Two headers. The platform gateway only admits JWTs, so the **public anon key**
rides as the bearer, and the **scoped key** says who is calling:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <anon key>` (public) |
| `apikey` | `<anon key>` (same value; some clients send both) |
| `X-TwinOS-Key` | `twk_ezyai_<40 hex>` |
| `Content-Type` | `application/json` |

The key is minted in `docs/SETUP.md` 0.4 and lives **only** on the bot's host,
as an environment variable — never in the bot's git repo. Suggested names:

```bash
EZYMAP_SITE_URL=https://cdnyybrfoclexjlroqcf.supabase.co/functions/v1
TWINOS_SIGNAL_KEY=twk_ezyai_…      # the ezyai key from the keyring
TWINOS_ANON_KEY=eyJ…               # the public anon key
```

`_shared/auth.ts` hashes the key and looks it up in `api_keys`; a revoked key
answers `401 unauthorized`. Only the key's SHA-256 is stored.

## 2. Body

One signal, or a batch of at most **50**:

```json
{ "signals": [ { "external_id": "auto-8842", "symbol": "XAUUSD", "direction": "buy",
                 "status": "running", "entry_low": 4590.2, "entry_high": 4593.0,
                 "stop_price": 4585.0, "tp1": 4604.0, "tp2": 4612.0, "rr": 2.4,
                 "setup": "London continuation", "timeframe": "M15", "quality": "live" },
               { "external_id": "auto-8841", "status": "tp1", "result_r": 1.2, "result_pips": 70 },
               { "external_id": "auto-8842", "status": "sl" } ] }
```

A single signal may be posted on its own (no `signals` wrapper).

### Fields

| Field | Notes |
|---|---|
| `external_id` | **Required.** The bot's own id. The merge key — see §3. ≤120 chars. |
| `symbol` | e.g. `XAUUSD`. ≤120 chars. |
| `direction` | `buy` or `sell`. Anything else is refused. |
| `status` | `pending` · `running` · `tp` · `tp1` · `tp2` · `be` · `sl` · `cancelled`. |
| `entry_low`, `entry_high` | Numbers. Equal values mean a single entry price. |
| `stop_price`, `tp1`, `tp2`, `rr` | Numbers. |
| `setup`, `timeframe` | Free text, ≤120 chars. |
| `quality` | `live` (default) · `demo` · `shadow`. Only `live` can produce a public post. |
| `counter_trend` | Boolean. Keeps the warning line on the card. |
| `result_r`, `result_pips` | Numbers, on a closing status. |
| `opened_at`, `closed_at` | ISO timestamps. Defaulted to now when omitted. |
| `raw` | Any object; kept verbatim on the row for the audit trail. |

Numbers may arrive as strings (`"4604.5"`); they are coerced. Anything that is
not a number is refused for that row. Absent fields **keep their current value**
— that is what makes an open / tick / close sequence safe to retry.

## 3. Merge semantics

Every row is an upsert keyed on `external_id`:

- **First time seen** → a new `signals` row, `status` defaults to `pending`.
- **Seen again** → the given fields are updated, the rest are left alone. So
  "open", "price tick" and "close" are all the same call.
- A status change to `tp` / `tp1` / `tp2` / `be` / `sl` sets `closed_at` and
  appends a `signal_outcomes` row.
- On a **live** signal, a close to `tp`/`tp1`/`tp2`/`be`/`sl` queues a
  `result_reply` job: TwinOS posts the result under the original card by itself.
  `demo` and `shadow` never queue one.

Re-posting the same row is harmless. This is the retry story: send it again.

## 4. Response

```json
{ "accepted": 2, "results": [
  { "ok": true, "external_id": "auto-8842", "id": "…", "created": true,  "status_changed": { "from": null, "to": "running" } },
  { "ok": true, "external_id": "auto-8841", "id": "…", "created": false, "status_changed": { "from": "running", "to": "tp1" } },
  { "ok": false, "error": "external_id is required" } ] }
```

| Status | Meaning |
|---|---|
| `200` | every row accepted |
| `207` | some accepted, some not — inspect `results` |
| `400` | none accepted (or a bad request: no signals, over 50, not a JSON object) |

Treat `200` and `207` as success for the accepted rows; a rejected row carries a
human `error`. `401` means the key is wrong or revoked — do not retry.

## 5. Reading the board

```
GET /signals-ingest          → { "signals": [ …open board rows… ] }
GET /signals-ingest?diagnose=1 → { configured, role, key, presented_fingerprint }
```

`diagnose` is the fastest way to prove the key is right: it names the key and
prints the fingerprint of what was presented, without revealing it.

## 6. Try it

```bash
curl -s "$EZYMAP_SITE_URL/signals-ingest" \
  -H "Authorization: Bearer $TWINOS_ANON_KEY" \
  -H "apikey: $TWINOS_ANON_KEY" \
  -H "X-TwinOS-Key: $TWINOS_SIGNAL_KEY" \
  -H 'content-type: application/json' \
  -d '{"signals":[{"external_id":"test-manual-1","symbol":"XAUUSD","direction":"buy","status":"pending","entry_low":4590,"stop_price":4585,"tp1":4604,"quality":"demo"}]}'
```

Use `quality: "demo"` for a hand test: the row is stored and visible, but the
publisher will never post it.

The payload contract itself is tested in
`supabase/functions/_shared/signals_test.ts` (runs in CI).

## 7. Never

- Never send the **service-role** key: this endpoint needs the anon key plus the
  scoped key.
- Never commit the key to the bot's repo; it lives in the host environment only.
- Never send a `demo`/`shadow` signal expecting a post: only `live` reaches the
  channel, and only after Jack approves.
