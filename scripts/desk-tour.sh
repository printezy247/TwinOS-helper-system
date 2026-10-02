#!/usr/bin/env bash
# scripts/desk-tour.sh — after a deploy, walk the new Desk features live.
#
#   ./scripts/desk-tour.sh            drive the LIVE tg-webhook, in the Desk only
#   ./scripts/desk-tour.sh --dry-run  print the payloads, touch nothing
#
# What it does, in order:
#   1. the read-only commands answer: /status, /friday, /hours today, /batch, /help
#   2. a synthetic Jack message becomes a draft with a Desk message
#   3. /fanout #<id> copies it to the other platforms
#   4. the ❌ button (callback verb "no") rejects the draft and every copy
#   5. all of them are rejected and nothing was queued to publish
#
# Hard rules (tests/test_desk_tour.py enforces them in CI): it only rejects,
# it never sends the batch approve command, and it never logs baseline hours.
# Needs what scripts/desk-selftest.sh needs: the Supabase CLI logged in and
# linked, and `url` + `ops_bot_token` in the keyring.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH${HOME:+:$HOME/.npm-global/bin}"

say() { printf '%s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

DRY=no
[ "${1:-}" = "--dry-run" ] && DRY=yes

ring() { secret-tool lookup service twinos key "$1" 2>/dev/null || true; }

query() {
  local out
  if ! out="$(supabase db query --linked "$1" 2>&1)"; then
    die "db query failed (is the Supabase CLI logged in and linked? try: supabase projects list)"
  fi
  printf '%s' "$out"
}

jqrows() { sed -n '/^{/,$p' | jq -r "$1" 2>/dev/null || true; }

setting() {
  query "select value::text as v from settings where key='$1'" | jqrows '.rows[0].v // empty'
}

# --- preflight (dry-run needs only bash + coreutils) --------------------------
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

  URL="$(ring url)"; TOKEN="$(ring ops_bot_token)"
  [ -n "$URL" ] || die "keyring entry 'url' is missing (docs/SETUP.md 0.2)"
  [ -n "$TOKEN" ] || die "keyring entry 'ops_bot_token' is missing (docs/SETUP.md 0.5)"
  SECRET="$(printf 'twinos-ops-webhook:%s' "$TOKEN" | sha256sum | cut -c1-48)"
  TOKEN=""
  [ -n "$SECRET" ] || die "could not derive the webhook secret"
  JACK_ID="$(setting jack_telegram_user_id)"
  DESK_ID="$(setting desk_group_chat_id)"
  SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
[ -n "$JACK_ID" ] || die "settings.jack_telegram_user_id is unset"
[ -n "$DESK_ID" ] || die "settings.desk_group_chat_id is unset"

# update_ids sit 1e10 above the selftest's, so the two never collide.
BASE=$(( 910000000000 + $(date +%s) ))
SEQ=0
WH="$URL/functions/v1/tg-webhook"

post() {
  # post <label> <json>
  if [ "$DRY" = yes ]; then
    say "   POST $WH  ($1)"
    say "   body: $2"
    return
  fi
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WH" \
    -H 'content-type: application/json' \
    -H "x-telegram-bot-api-secret-token: $SECRET" \
    -d "$2")"
  [ "$code" = 200 ] || die "tg-webhook answered HTTP $code for $1"
  say "   $1: HTTP 200"
}

next() { SEQ=$((SEQ + 1)); }

jack_says() {
  # jack_says <seq> <text>  -> a Desk message update from Jack
  cat <<JSON
{"update_id":$((BASE + $1)),"message":{"message_id":$1,"from":{"id":$JACK_ID,"is_bot":false,"first_name":"tour"},"chat":{"id":$DESK_ID,"type":"supergroup","title":"EzyMap Desk"},"date":$(date +%s),"text":"$2"}}
JSON
}

jack_rejects() {
  # jack_rejects <seq> <id8> <desk message id>  -> the ❌ tap
  cat <<JSON
{"update_id":$((BASE + $1)),"callback_query":{"id":"tour-$BASE-$1","from":{"id":$JACK_ID,"is_bot":false},"data":"no:$2","message":{"message_id":$3,"chat":{"id":$DESK_ID,"type":"supergroup"},"date":$(date +%s)}}}
JSON
}

# --- 1. read-only commands ------------------------------------------------------
say "1. read-only commands"
for cmd in "/status" "/friday" "/hours today" "/batch" "/help"; do
  next; post "$cmd" "$(jack_says "$SEQ" "$cmd")"
done

# --- 2. a draft -----------------------------------------------------------------
say "2. synthetic Jack message -> draft"
next; post "draft message" "$(jack_says "$SEQ" "desk tour 4590 held, bias up, watch 4612")"

CID="00000000-0000-0000-0000-000000000000"; DMID=42
if [ "$DRY" = no ]; then
  draft=""
  for _ in 1 2 3 4 5; do
    draft="$(query "select 'DRAFT:' || ci.id::text || ':' || ci.status || ':' || coalesce(ci.desk_message_id::text,'none') || ':END' as s
                     from content_items ci
                    where ci.created_at >= '$SINCE'
                      and coalesce(ci.source->>'via','') <> 'fanout'
                      and exists (select 1 from content_variants cv
                                   where cv.content_id = ci.id and cv.body like '%desk tour%')
                    order by ci.created_at desc limit 1" \
      | grep -oE 'DRAFT:[0-9a-f-]+:[a-z_]+:[0-9a-z]+:END' | head -1 || true)"
    [ -n "$draft" ] && break
    sleep 2
  done
  [ -n "$draft" ] || die "no desk tour draft appeared within 10 s"
  CID="$(printf '%s' "$draft" | cut -d: -f2)"
  STATUS="$(printf '%s' "$draft" | cut -d: -f3)"
  DMID="$(printf '%s' "$draft" | cut -d: -f4)"
  say "   draft #${CID:0:8} status=$STATUS desk_message_id=$DMID"
  [ "$STATUS" = pending_approval ] || die "draft status is $STATUS, expected pending_approval (reject it in the Desk by hand)"
  [ "$DMID" != none ] || die "the Desk message id was not recorded (reject #${CID:0:8} in the Desk by hand)"
fi
SHORT="$(printf '%s' "$CID" | cut -c1-8)"

# --- 3. fan-out -----------------------------------------------------------------
say "3. copy it to the other platforms"
next; post "/fanout #$SHORT" "$(jack_says "$SEQ" "/fanout #$SHORT")"

KIDS=""
if [ "$DRY" = no ]; then
  for _ in 1 2 3 4 5; do
    KIDS="$(query "select 'IDS:' || coalesce(string_agg(id::text, ','), '') || ':END' as s
                     from content_items where source @> '{\"via\":\"fanout\",\"parent\":\"$CID\"}'" \
      | grep -oE 'IDS:[0-9a-f,-]*:END' | head -1 | sed 's/^IDS://; s/:END$//' || true)"
    [ -n "$KIDS" ] && break
    sleep 2
  done
  # No copies is reported below, after the draft itself has been rejected.
  say "   copies: $(printf '%s' "$KIDS" | tr ',' '\n' | grep -c . || true)"
fi

# --- 4. reject everything -------------------------------------------------------
say "4. tap ❌ on the draft and every copy (callback verb \"no\" only)"
next; post "reject #$SHORT" "$(jack_rejects "$SEQ" "$SHORT" "$DMID")"
if [ -n "$KIDS" ]; then
  for kid in ${KIDS//,/ }; do
    next; post "reject #${kid:0:8}" "$(jack_rejects "$SEQ" "${kid:0:8}" "$DMID")"
  done
fi

# --- 5. assert ------------------------------------------------------------------
if [ "$DRY" = no ]; then
  say "5. assert all rejected, nothing queued to publish"
  result="$(query "with t as (select id, status from content_items
                               where id = '$CID' or source @> '{\"via\":\"fanout\",\"parent\":\"$CID\"}')
                   select 'RESULT:' || count(*) || ':' ||
                          count(*) filter (where status = 'rejected') || ':' ||
                          (select count(*) from publish_jobs p where p.content_id in (select id from t)) || ':END' as s
                     from t" \
    | grep -oE 'RESULT:[0-9]+:[0-9]+:[0-9]+:END' | head -1)"
  total="$(printf '%s' "$result" | cut -d: -f2)"
  rejected="$(printf '%s' "$result" | cut -d: -f3)"
  jobs="$(printf '%s' "$result" | cut -d: -f4)"
  say "   posts=$total rejected=$rejected publish_jobs=$jobs"
  [ "$jobs" = 0 ] || die "a publish job exists for a tour post; cancel it in the dashboard NOW"
  [ "$total" = "$rejected" ] || die "not every tour post was rejected; reject the rest in the Desk"
  [ -n "$KIDS" ] || die "the draft was rejected, but /fanout made no copies (check the Desk reply)"
  failed="$(query "select 'FAILS:' || count(*) || ':END' as s from action_log
                    where created_at >= '$SINCE' and action like 'desk.%failed'" \
    | grep -oE 'FAILS:[0-9]+:END' | head -1 | cut -d: -f2)"
  [ "${failed:-0}" = 0 ] || die "$failed Desk action(s) failed during the tour (see action_log)"
  say ""
  say "PASS: commands answered, draft #$SHORT copied to $((total - 1)) platforms, all rejected, nothing published."
else
  say ""
  say "DRY RUN: payloads above, nothing sent."
fi
