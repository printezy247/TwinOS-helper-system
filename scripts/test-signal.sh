#!/usr/bin/env bash
# scripts/test-signal.sh — prove the TradingView path live (P1.3).
#
#   ./scripts/test-signal.sh            drive the LIVE tv-webhook
#   ./scripts/test-signal.sh --dry-run  print the alert, touch nothing
#
# What it proves, in order:
#   1. a fake alert becomes a `signals` row (source=tradingview)
#   2. a `signal_card` draft is built from it
#   3. the card keeps the direction emoji, the COUNTER-TREND line, the locked
#      risk line and the result footer
#   4. the ❌ button rejects it and nothing is enqueued to publish
#
# It ALWAYS rejects the card it creates. A test alert never reaches @ezymap.
# external_id starts with "test-" so these rows are obvious and never mistaken
# for a real board signal. Needs: supabase CLI logged in + linked, secret-tool
# with `url`, `tv_secret` and `ops_bot_token` (docs/SETUP.md).
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
cd "$(dirname "$0")/.."
export PATH="$PATH${HOME:+:$HOME/.npm-global/bin}"

EXT="test-$(date +%s)"
ALERT=$(cat <<JSON
{"id":"$EXT","symbol":"XAUUSD","tf":"15","side":"buy","entry":4591.5,"sl":4585.0,"tp1":4604.0,"tp2":4612.0,"setup":"EzyMap break","counter_trend":true}
JSON
)

if [ "$DRY" = yes ]; then
  URL="https://placeholder.supabase.co"
  JACK_ID="6282941580"
  DESK_ID="-1009999999999"
  SINCE="2026-10-02T00:00:00Z"
else
  command -v supabase >/dev/null || die "the Supabase CLI is not installed (npm i -g supabase)"
  command -v secret-tool >/dev/null || die "secret-tool is missing (sudo apt install libsecret-tools)"
  command -v jq >/dev/null || die "jq is missing"
  command -v curl >/dev/null || die "curl is missing"

  URL="$(ring url)"; TV="$(ring tv_secret)"; TOKEN="$(ring ops_bot_token)"
  [ -n "$URL" ] || die "keyring entry 'url' is missing (docs/SETUP.md 0.2)"
  [ -n "$TV" ] || die "keyring entry 'tv_secret' is missing (docs/SETUP.md 0.7)"
  [ -n "$TOKEN" ] || die "keyring entry 'ops_bot_token' is missing (docs/SETUP.md 0.5)"
  SECRET="$(printf 'twinos-ops-webhook:%s' "$TOKEN" | sha256sum | cut -c1-48)"
  TOKEN=""
  JACK_ID="$(setting jack_telegram_user_id)"
  DESK_ID="$(setting desk_group_chat_id)"
  SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [ -n "$JACK_ID" ] && [ -n "$DESK_ID" ] || die "desk settings are unset (docs/SETUP.md 0.6)"
fi

say "1. fake alert -> tv-webhook (counter_trend=true, external_id=$EXT)"
if [ "$DRY" = yes ]; then
  say "   POST $URL/functions/v1/tv-webhook?secret=<tv_secret>"
  say "   body: $ALERT"
else
  out="$(printf 'url = "%s/functions/v1/tv-webhook?secret=%s"\n' "$URL" "$TV" \
    | curl -s -K - -X POST -H 'content-type: application/json' -d "$ALERT")"
  TV=""
  say "   $out"
  printf '%s' "$out" | grep -q '"ok":true' || die "tv-webhook did not accept the alert"
fi

if [ "$DRY" = no ]; then
  say "2. assert the signals row and the signal_card draft"
  card=""
  for _ in 1 2 3 4 5; do
    card="$(query "select 'CARD:' || ci.id::text || ':' || ci.status || ':' || coalesce(ci.desk_message_id::text,'none')
                    || ':' || case when cv.body like '%COUNTER-TREND%' then 'ct' else 'no-ct' end
                    || ':' || case when cv.body like '%Risk 1% or less%' then 'risk' else 'no-risk' end
                    || ':' || case when cv.body like '%Results get posted%' then 'foot' else 'no-foot' end
                    || ':' || case when cv.body like '%🟢%' then 'emoji' else 'no-emoji' end
                    || ':' || (select status from public.signals s where s.id = ci.signal_id)
                    || ':END' as s
               from public.content_items ci
               join public.content_variants cv on cv.content_id = ci.id
              where ci.created_at >= '$SINCE' and ci.post_type = 'signal_card'
                and ci.source->>'external_id' = '$EXT'
              order by ci.created_at desc limit 1" \
      | grep -oE 'CARD:[0-9a-f-]+:[a-z_]+:[0-9a-z-]+:[0-9a-z-]+:[0-9a-z-]+:[0-9a-z-]+:[0-9a-z-]+:[a-z_]+:END' | head -1 || true)"
    [ -n "$card" ] && break
    sleep 2
  done
  [ -n "$card" ] || die "no signal card appeared within 10 s for $EXT"
  CID="$(printf '%s' "$card" | cut -d: -f2)"
  STATUS="$(printf '%s' "$card" | cut -d: -f3)"
  DMID="$(printf '%s' "$card" | cut -d: -f4)"
  CT="$(printf '%s' "$card" | cut -d: -f5)"
  RISK="$(printf '%s' "$card" | cut -d: -f6)"
  FOOT="$(printf '%s' "$card" | cut -d: -f7)"
  EMOJI="$(printf '%s' "$card" | cut -d: -f8)"
  SIGSTATUS="$(printf '%s' "$card" | cut -d: -f9)"
  say "   card #$CID status=$STATUS signal=$SIGSTATUS emoji=$EMOJI counter_trend=$CT risk=$RISK footer=$FOOT"
  [ "$STATUS" = pending_approval ] || die "card status is $STATUS, expected pending_approval"
  [ "$DMID" != none ] || die "the Desk message id was not recorded"
  [ "$CT" = ct ] || die "the COUNTER-TREND warning line is missing from the card"
  [ "$RISK" = risk ] || die "the locked risk line is missing from the card"
  [ "$FOOT" = foot ] || die "the result footer is missing from the card"
  [ "$EMOJI" = emoji ] || die "the direction emoji is missing from the card"
  [ "$SIGSTATUS" = pending ] || die "the signals row status is $SIGSTATUS, expected pending"
fi

SHORT="$(printf '%s' "${CID:-00000000-0000-0000-0000-000000000000}" | cut -c1-8)"
BASE=$(( 900000000000 + $(date +%s) ))
CB=$(cat <<JSON
{"update_id":$BASE,"callback_query":{"id":"tvtest-$BASE","from":{"id":$JACK_ID,"is_bot":false},"data":"no:$SHORT","message":{"message_id":${DMID:-42},"chat":{"id":$DESK_ID,"type":"supergroup"},"date":$(date +%s)}}}
JSON
)

say "3. tap the ❌ button (callback verb \"no\" — this script has no verb \"ok\")"
if [ "$DRY" = yes ]; then
  say "   POST $URL/functions/v1/tg-webhook"
  say "   body: $CB"
else
  resp="$(printf 'header = "x-telegram-bot-api-secret-token: %s"\n' "$SECRET" \
    | curl -s -o /dev/null -w '%{http_code}' -K - -X POST "$URL/functions/v1/tg-webhook" \
    -H 'content-type: application/json' -d "$CB")"
  [ "$resp" = 200 ] || die "tg-webhook answered HTTP $resp for the reject callback"

  say "4. assert rejected, one approvals row, zero publish jobs"
  result="$(query "select 'RESULT:' || ci.status || ':' ||
                         (select count(*) from approvals a where a.content_id = ci.id and a.decision = 'reject') || ':' ||
                         (select count(*) from publish_jobs p where p.content_id = ci.id) || ':END' as s
                    from content_items ci where ci.id = '$CID'" \
    | grep -oE 'RESULT:[a-z_]+:[0-9]+:[0-9]+:END' | head -1)"
  say "   ${result#RESULT:} (status : reject rows : publish jobs)"
  [ "$result" = "RESULT:rejected:1:0:END" ] || die "expected RESULT:rejected:1:0:END, got $result"
  say ""
  say "PASS — alert $EXT -> signal card #$CID shown in the Desk, rejected, nothing published."
fi
if [ "$DRY" = yes ]; then
  say ""
  say "DRY RUN — alert above, nothing sent."
fi
