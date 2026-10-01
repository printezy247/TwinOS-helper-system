#!/usr/bin/env bash
# Mint the scoped TwinOS API keys and put each one straight into the keyring.
#
#   ./scripts/mint-keys.sh                 store url + anon key, mint every missing key (safe to re-run)
#   ./scripts/mint-keys.sh --list          show the keys in the database (prefixes only)
#   ./scripts/mint-keys.sh --rotate WHO    revoke WHO's key and mint a new one
#   ./scripts/mint-keys.sh --revoke WHO    revoke WHO's key and remove it from the keyring
#
# WHO is one of: abdul, worker, ezyai.
#
# A key is printed nowhere: the CLI's answer is held in a shell variable, the key
# is cut out of it and piped into `secret-tool store`. Only its first 12
# characters (the prefix the database also keeps) ever reach the screen.
#
# Needs the Supabase CLI logged in and linked (same as scripts/deploy.sh) and
# the desktop keyring (run it from your own terminal, not from an agent).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.npm-global/bin"

say() { printf '%s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

# who -> "<api_keys.name> <role> <keyring entry>"
spec() {
  case "$1" in
    abdul)  echo "abdul abdul abdul_key" ;;
    worker) echo "pc-worker pc_worker worker_key" ;;
    ezyai)  echo "ezyai ezyai ezyai_key" ;;
    *) return 1 ;;
  esac
}
ALL=(abdul worker ezyai)
field() { local f; read -r -a f <<<"$(spec "$1")"; echo "${f[$2]}"; }
db_name()  { field "$1" 0; }
db_role()  { field "$1" 1; }
ring_key() { field "$1" 2; }

# Mask anything key-shaped before showing CLI output (used only on errors and --list).
redact() { sed -E 's/twk_[a-z_]+_[0-9a-f]{8,}/twk_…(hidden)/g'; }

query() {
  # Both streams are captured: whichever one the CLI uses, nothing reaches the terminal unread.
  local out
  if ! out="$(supabase db query --linked "$1" 2>&1)"; then
    printf '%s\n' "$out" | redact | tail -5 >&2
    die "the database query failed (is the CLI logged in and linked? try: supabase projects list)"
  fi
  printf '%s' "$out"
}

ring_has() { [ -n "$(secret-tool lookup service twinos key "$1" 2>/dev/null || true)" ]; }

# Active (not revoked) keys, as "name=prefix,name=prefix".
active_keys() {
  query "select 'KEYSTATE:' || coalesce(string_agg(name || '=' || key_prefix, ',' order by name), '') || ':END' as s
           from public.api_keys where revoked_at is null" \
    | { grep -oE 'KEYSTATE:[a-z0-9=_,-]*:END' || true; } | head -1 | sed -E 's/^KEYSTATE://; s/:END$//'
}

# rotate_api_key retires any old row with this name and mints a fresh key.
mint_into_ring() {
  local who="$1" name role ring out key stored
  name="$(db_name "$who")"; role="$(db_role "$who")"; ring="$(ring_key "$who")"
  out="$(query "select public.rotate_api_key('$name', '$role') as minted")"
  key="$(printf '%s' "$out" | { grep -oE "twk_${role}_[0-9a-f]{40}" || true; } | head -1)"
  out=""
  [ -n "$key" ] || die "minted $name but could not read the key from the answer. Run --rotate $who to try again."
  printf '%s' "$key" | secret-tool store --label "TwinOS $who key" service twinos key "$ring"
  stored="$(secret-tool lookup service twinos key "$ring" 2>/dev/null || true)"
  if [ "$stored" != "$key" ]; then
    key=""; stored=""
    die "the keyring did not keep $ring. Is the desktop keyring unlocked? Then run --rotate $who."
  fi
  say "  $who: new key ${key:0:12}… stored in the keyring as '$ring'"
  key=""; stored=""
}

# The two public values every caller also needs: the project URL and the anon
# key (the gateway only admits JWTs; the anon JWT carries a twk_ key in).
# The CLI lists every key; only the one named "anon" is kept, inside the pipe.
ensure_public_values() {
  if ring_has url; then
    say "  url: already set"
  else
    printf 'https://%s.supabase.co' "$REF" | secret-tool store --label "TwinOS url" service twinos key url
    say "  url: stored (https://$REF.supabase.co)"
  fi
  if ring_has apikey; then
    say "  apikey (public anon key): already set"
    return
  fi
  supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null \
    | python3 -c 'import json,sys
try:
    keys = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
anon = [k.get("api_key", "") for k in keys if isinstance(k, dict) and k.get("name") == "anon"]
if not anon or not anon[0].startswith("eyJ"):
    sys.exit(1)
sys.stdout.write(anon[0])' \
    | secret-tool store --label "TwinOS anon" service twinos key apikey || true
  if ring_has apikey; then
    say "  apikey (public anon key): stored"
  else
    say "  apikey: could not fetch it. Paste it yourself (Supabase → Settings → API → anon public):"
    say "         secret-tool store --label 'TwinOS anon' service twinos key apikey"
  fi
}

command -v supabase >/dev/null || die "the Supabase CLI is not installed (npm i -g supabase)"
command -v secret-tool >/dev/null || die "secret-tool is missing (sudo apt install libsecret-tools)"
REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
[ -n "$REF" ] || die "project not linked. Run: supabase link --project-ref <ref>"

case "${1:-}" in
  --list)
    query "select name, role, key_prefix, created_at::date as created, last_used_at, revoked_at
             from public.api_keys order by revoked_at nulls first, name" | redact
    echo
    ;;
  --rotate|--revoke)
    who="${2:-}"; spec "$who" >/dev/null || die "say who: abdul, worker or ezyai"
    if [ "$1" = "--rotate" ]; then
      say "rotating $who (the old key stops working now)"
      mint_into_ring "$who"
    else
      query "update public.api_keys set revoked_at = now(), revoke_note = 'revoked by mint-keys.sh'
               where name = '$(db_name "$who")' and revoked_at is null" >/dev/null
      secret-tool clear service twinos key "$(ring_key "$who")" 2>/dev/null || true
      say "revoked $who and removed it from the keyring"
    fi
    ;;
  "")
    say "public values"
    ensure_public_values
    say "scoped keys"
    state=",$(active_keys),"
    for who in "${ALL[@]}"; do
      name="$(db_name "$who")"; ring="$(ring_key "$who")"
      in_db=no; [[ "$state" == *",$name="* ]] && in_db=yes
      in_ring=no; ring_has "$ring" && in_ring=yes
      if [ "$in_db" = yes ] && [ "$in_ring" = yes ]; then
        say "  $who: already set, nothing to do"
      elif [ "$in_db" = yes ]; then
        say "  $who: the database has a key but this keyring does not (keys cannot be read back)."
        say "         Run: ./scripts/mint-keys.sh --rotate $who"
      else
        mint_into_ring "$who"
      fi
    done
    say ""
    say "done. Check with: ./scripts/mint-keys.sh --list"
    ;;
  *)
    sed -n '2,9p' "$0"; exit 2 ;;
esac
