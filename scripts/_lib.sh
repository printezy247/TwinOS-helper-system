#!/usr/bin/env bash
# scripts/_lib.sh — the shared helpers every live Desk script needs. Not run on
# its own; the scripts source it: `. "$(dirname "$0")/_lib.sh"`.
#
# Sourcing must come after `set -euo pipefail`. Needs only bash in a dry run
# (CI has no keyring and no Supabase CLI).

say() { printf '%s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

DRY=no
[ "${1:-}" = "--dry-run" ] && DRY=yes

ring() { secret-tool lookup service twinos key "$1" 2>/dev/null || true; }

query() {
  # Same discipline as scripts/mint-keys.sh: one shell variable, never echoed.
  local out
  if ! out="$(supabase db query --linked --output-format json "$1" 2>&1)"; then
    die "db query failed (is the Supabase CLI logged in and linked? try: supabase projects list)"
  fi
  # The CLI can exit 0 without rows (an error object, a bare banner). Say what
  # it said, instead of letting an empty answer look like a missing setting.
  if ! printf '%s' "$out" | sed -n '/^[[{]/,$p' | jq -e 'type == "array" or has("rows")' >/dev/null 2>&1; then
    local why
    why="$(printf '%s' "$out" | sed -n '/^[[{]/,$p' | jq -r '.error.message // .message // empty' 2>/dev/null || true)"
    [ -n "$why" ] || why="$(printf '%s' "$out" | grep -v '^Initialising' | head -1)"
    die "the Supabase CLI gave no rows: ${why:-empty answer} (try: supabase projects list)"
  fi
  printf '%s' "$out"
}

# The CLI answers {"rows":[...]} under an agent and a bare [...] for a person
# with --output-format json; both become {"rows":[...]} before $1 reads them.
jqrows() { sed -n '/^[[{]/,$p' | jq -r "(.rows? // .) as \$r | {rows: \$r} | $1" 2>/dev/null || true; }

setting() {
  query "select value::text as v from settings where key='$1'" \
    | jqrows '.rows[0].v // empty'
}