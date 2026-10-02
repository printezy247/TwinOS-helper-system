#!/usr/bin/env bash
# Deploy the Edge Functions to the hosted project and check they answer.
#
#   ./scripts/deploy.sh            deploy all ten functions
#   ./scripts/deploy.sh --check    only run the checks and probe the live functions
#
# Needs the Supabase CLI logged in (`supabase login`) and linked once
# (`supabase link --project-ref <ref>`). It finds the CLI even when npm's global
# folder is not on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.npm-global/bin"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

command -v supabase >/dev/null || die "the Supabase CLI is not installed (npm i -g supabase)"
REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
[ -n "$REF" ] || die "project not linked. Run: supabase link --project-ref <ref>"

say "checks"
python3 tests/check_consistency.py | tail -1
if command -v deno >/dev/null; then
  (cd supabase/functions && deno check --config deno.json _shared/*.ts */index.ts && deno lint --config deno.json)
else
  echo "(deno not installed here; CI runs deno check, lint and test on every push)"
fi

if [ "${1:-}" != "--check" ]; then
  # Edge deploys upload the whole function folder, tests included (~20
  # *_test.ts files today). Move them aside for the deploy only; the EXIT
  # trap puts every file back even when a deploy fails. Checks above already
  # ran with the tests present.
  TESTCACHE="$(mktemp -d)"
  TESTLIST="$TESTCACHE/list"
  find supabase/functions -name '*_test.ts' > "$TESTLIST"
  restore_tests() {
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      mv -f "$TESTCACHE/$(printf '%s' "$f" | tr '/' '__')" "$f" 2>/dev/null || true
    done < "$TESTLIST"
    rm -rf "$TESTCACHE"
  }
  trap restore_tests EXIT
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mv -f "$f" "$TESTCACHE/$(printf '%s' "$f" | tr '/' '__')"
  done < "$TESTLIST"
  say "deploy (11 functions that verify the caller's JWT)"
  supabase functions deploy content approve publish signals-ingest results health friday jobs links metrics research
  say "deploy (3 routes that carry their own credential)"
  supabase functions deploy tg-webhook tv-webhook tg-auth --no-verify-jwt
  restore_tests
  trap - EXIT
fi

say "live probe"
fail=0
for fn in content approve publish signals-ingest results health friday jobs links metrics research; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$REF.supabase.co/functions/v1/$fn")"
  # 401/403 = deployed and refusing an anonymous caller. 404 = not deployed.
  case "$code" in 401|403) echo "ok   $fn ($code)";; *) echo "FAIL $fn ($code)"; fail=1;; esac
done
# tg-auth has no bare route (unknown route = 400 by design): probe GET /me,
# which refuses a caller without a Mini App session (401).
for fn in tg-webhook tv-webhook tg-auth/me; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$REF.supabase.co/functions/v1/$fn")"
  case "$code" in 200|401|403|405) echo "ok   $fn ($code)";; *) echo "FAIL $fn ($code)"; fail=1;; esac
done
# A scoped key rides behind the public anon key (docs/API.md). A made-up key must
# get past the gateway and be refused by our own code, not by the gateway.
anon="$(secret-tool lookup service twinos key apikey 2>/dev/null || true)"
if [ -n "$anon" ]; then
  fake="twk_abdul_$(printf '0123456789abcdef%.0s' 1 2 3 | cut -c1-40)"
  body="$(curl -s -X POST -H "apikey: $anon" -H "Authorization: Bearer $anon" -H "X-TwinOS-Key: $fake" \
            "https://$REF.supabase.co/functions/v1/health/beat")"
  case "$body" in
    *"unknown or revoked api key"*) echo "ok   API keys reach the functions (X-TwinOS-Key)";;
    *) echo "FAIL API-key path: $body"; fail=1;;
  esac
else
  echo "skip API-key probe (no anon key in the keyring yet; run ./scripts/mint-keys.sh)"
fi
[ "$fail" -eq 0 ] || die "a function did not answer as expected"

say "desk commands"
# setMyCommands scoped to the Desk chat (plan §17 Wave 1 item 3). Best effort:
# a miss here never fails the deploy; the bot still answers every command.
if TOKEN="$(secret-tool lookup service twinos key ops_bot_token 2>/dev/null)" && [ -n "$TOKEN" ]; then
  DESK_ID="$(supabase db query --linked --output-format json "select value::text as v from settings where key='desk_group_chat_id'" 2>/dev/null | sed -n '/^[[{]/,$p' | jq -r '(.rows? // .) | .[0].v // .[0] // empty' 2>/dev/null || true)"
  if [ -n "${DESK_ID:-}" ]; then
    COMMANDS='[{"command":"menu","description":"Button panel"},{"command":"status","description":"Anything broken?"},{"command":"friday","description":"Friday numbers so far"},{"command":"batch","description":"The Wednesday batch"},{"command":"hours","description":"Log baseline hours"},{"command":"help","description":"What the Desk understands"}]'
    if curl -s -X POST "https://api.telegram.org/bot$TOKEN/setMyCommands" -H 'content-type: application/json' -d "{\"commands\":$COMMANDS,\"scope\":{\"type\":\"chat\",\"chat_id\":$DESK_ID}}" | grep -q '"ok":true'; then
      echo "ok   setMyCommands scoped to the Desk chat"
    else
      echo "WARN setMyCommands failed (the bot still works; rerun this step by hand)"
    fi
  else
    echo "skip setMyCommands (desk_group_chat_id unset; docs/SETUP.md 0.6)"
  fi
  TOKEN=""
else
  echo "skip setMyCommands (no ops_bot_token in the keyring yet; docs/SETUP.md 0.5)"
fi
say "done"
supabase functions list 2>&1 | sed -n "1,14p" || true
