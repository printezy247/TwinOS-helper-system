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
  say "deploy (8 functions that verify the caller's JWT)"
  supabase functions deploy content approve publish signals-ingest results health friday jobs
  say "deploy (2 webhooks that carry their own secret)"
  supabase functions deploy tg-webhook tv-webhook --no-verify-jwt
fi

say "live probe"
fail=0
for fn in content approve publish signals-ingest results health friday jobs; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$REF.supabase.co/functions/v1/$fn")"
  # 401/403 = deployed and refusing an anonymous caller. 404 = not deployed.
  case "$code" in 401|403) echo "ok   $fn ($code)";; *) echo "FAIL $fn ($code)"; fail=1;; esac
done
for fn in tg-webhook tv-webhook; do
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
say "done"
supabase functions list 2>&1 | sed -n "1,14p" || true
