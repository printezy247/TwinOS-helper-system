#!/usr/bin/env bash
# scripts/desk-selftest.sh — prove the Desk loop live, end to end (P1.1).
#
#   ./scripts/desk-selftest.sh            drive the LIVE tg-webhook
#   ./scripts/desk-selftest.sh --dry-run  print the payloads, touch nothing
#
# What it proves, in order:
#   1. a synthetic Jack message in the Desk group becomes a draft
#   2. the draft's Desk message (desk_message_id) and buttons exist
#   3. the draft carries no blocking compliance findings
#   4. the ❌ button (callback verb "no") rejects it
#   5. nothing was enqueued to publish
#
# It ALWAYS rejects the draft it creates. A selftest never taps ✅.
# Needs: supabase CLI logged in + linked, secret-tool with `url` and
# `ops_bot_token` in the keyring (docs/SETUP.md).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.npm-global/bin"

say() { printf '%s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

DRY=no
[ "${1:-}" = "--dry-run" ] && DRY=yes

# --- helpers ---------------------------------------------------------------
ring() { secret-tool lookup service twinos key "$1" 2>/dev/null || true; }

query() {
  # Same discipline as scripts/mint-keys.sh: one shell variable, never echoed.
  local out
  if ! out="$(supabase db query --linked "$1" 2>&1)"; then
    die "db query failed (is the Supabase CLI logged in and linked? try: supabase projects list)"
  fi
  printf '%s' "$out"
}

# The CLI prints a banner line before its JSON; parse from the first "{".
jqrows() { sed -n '/^{/,$p' | jq -r "$1" 2>/dev/null || true; }

setting() {
  query "select value::text as v from settings where key='$1'" \
    | jqrows '.rows[0].v // empty'
}

# --- preflight ---------------------------------------------------------------
command -v supabase >/dev/null || die "the Supabase CLI is not installed (npm i -g supabase)"
command -v secret-tool >/dev/null || die "secret-tool is missing (sudo apt install libsecret-tools)"
command -v jq >/dev/null || die "jq is missing"
command -v curl >/dev/null || die "curl is missing"

if [ "$DRY" = yes ]; then
  URL="https://placeholder.supabase.co"
  JACK_ID="6282941580"          # placeholder shapes only; nothing is sent
  DESK_ID="-1009999999999"
  SINCE="2026-10-02T00:00:00Z"
else
  URL="$(ring url)"; TOKEN="$(ring ops_bot_token)"
  [ -n "$URL" ] || die "keyring entry 'url' is missing (docs/SETUP.md 0.2)"
  [ -n "$TOKEN" ] || die "keyring entry 'ops_bot_token' is missing (docs/SETUP.md 0.5)"
  # Derived, never stored: sha256("twinos-ops-webhook:" + token)[:48]
  SECRET="$(printf 'twinos-ops-webhook:%s' "$TOKEN" | sha256sum | cut -c1-48)"
  TOKEN=""
  [ -n "$SECRET" ] || die "could not derive the webhook secret"
  JACK_ID="$(setting jack_telegram_user_id)"
  DESK_ID="$(setting desk_group_chat_id)"
  SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
[ -n "$JACK_ID" ] || die "settings.jack_telegram_user_id is unset"
[ -n "$DESK_ID" ] || die "settings.desk_group_chat_id is unset"

# update_ids: far above Telegram's own (~1e10 today) so a replay never matches a
# real update, and unique per run.
BASE=$(( 900000000000 + $(date +%s) ))
WH="$URL/functions/v1/tg-webhook"

MSG_UPDATE=$(cat <<JSON
{"update_id":$BASE,"message":{"message_id":1,"from":{"id":$JACK_ID,"is_bot":false,"first_name":"selftest"},"chat":{"id":$DESK_ID,"type":"supergroup","title":"EzyMap Desk"},"date":$(date +%s),"text":"desk selftest 4590 held, bias up, watch 4612"}}
JSON
)

say "1. synthetic Jack message -> tg-webhook"
if [ "$DRY" = yes ]; then
  say "   POST $WH"
  say "   X-Telegram-Bot-Api-Secret-Token: <derived>"
  say "   body: $MSG_UPDATE"
else
  resp="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WH" \
    -H 'content-type: application/json' \
    -H "x-telegram-bot-api-secret-token: $SECRET" \
    -d "$MSG_UPDATE")"
  [ "$resp" = 200 ] || die "tg-webhook answered HTTP $resp for the message update"
  say "   tg-webhook: HTTP 200"
fi

if [ "$DRY" = no ]; then
  say "2. assert the draft + Desk message exist"
  draft=""
  for _ in 1 2 3 4 5; do
    draft="$(query "select 'DRAFT:' || ci.id::text || ':' || ci.status || ':' || coalesce(ci.desk_message_id::text,'none') || ':END' as s
                     from content_items ci
                    where ci.created_at >= '$SINCE'
                      and exists (select 1 from content_variants cv
                                   where cv.content_id = ci.id and cv.body like '%desk selftest%')
                    order by ci.created_at desc limit 1" \
      | grep -oE 'DRAFT:[0-9a-f-]+:[a-z_]+:[0-9a-z]+:END' | head -1 || true)"
    [ -n "$draft" ] && break
    sleep 2
  done
  [ -n "$draft" ] || die "no desk selftest draft appeared within 10 s"
  CID="$(printf '%s' "$draft" | cut -d: -f2)"
  STATUS="$(printf '%s' "$draft" | cut -d: -f3)"
  DMID="$(printf '%s' "$draft" | cut -d: -f4)"
  say "   draft #$CID status=$STATUS desk_message_id=$DMID"
  [ "$STATUS" = pending_approval ] || die "draft status is $STATUS, expected pending_approval"
  [ "$DMID" != none ] || die "the Desk message id was not recorded"

  blocking="$(query "select 'BLOCKS:' || count(*) || ':END' as s
                      from compliance_checks cc
                      join content_variants cv on cv.id = cc.variant_id
                     where cv.content_id = '$CID' and cc.ok = false" \
    | grep -oE 'BLOCKS:[0-9]+:END' | head -1 | cut -d: -f2)"
  say "3. blocking findings: $blocking"
  [ "$blocking" = 0 ] || die "the draft has blocking findings (see the Desk message); refusing to continue"
fi

SHORT="$(printf '%s' "${CID:-00000000-0000-0000-0000-000000000000}" | cut -c1-8)"
DMID_NUM="${DMID:-42}"
CB_UPDATE=$(cat <<JSON
{"update_id":$((BASE+1)),"callback_query":{"id":"selftest-$BASE","from":{"id":$JACK_ID,"is_bot":false},"data":"no:$SHORT","message":{"message_id":$DMID_NUM,"chat":{"id":$DESK_ID,"type":"supergroup"},"date":$(date +%s)}}}
JSON
)

say "4. tap the ❌ button (callback verb \"no\" — the script has no verb \"ok\")"
if [ "$DRY" = yes ]; then
  say "   POST $WH"
  say "   body: $CB_UPDATE"
else
  resp="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WH" \
    -H 'content-type: application/json' \
    -H "x-telegram-bot-api-secret-token: $SECRET" \
    -d "$CB_UPDATE")"
  [ "$resp" = 200 ] || die "tg-webhook answered HTTP $resp for the reject callback"

  say "5. assert rejected, one approvals row, zero publish jobs"
  result="$(query "select 'RESULT:' || ci.status || ':' ||
                         (select count(*) from approvals a where a.content_id = ci.id and a.decision = 'reject') || ':' ||
                         (select count(*) from publish_jobs p where p.content_id = ci.id) || ':END' as s
                    from content_items ci where ci.id = '$CID'" \
    | grep -oE 'RESULT:[a-z_]+:[0-9]+:[0-9]+:END' | head -1)"
  say "   ${result#RESULT:} (status : reject rows : publish jobs)"
  [ "$result" = "RESULT:rejected:1:0:END" ] || die "expected RESULT:rejected:1:0:END, got $result"
  say ""
  say "PASS — draft #$CID drafted, shown in the Desk, rejected, nothing published."
fi
if [ "$DRY" = yes ]; then
  say ""
  say "DRY RUN — payloads above, nothing sent."
fi
