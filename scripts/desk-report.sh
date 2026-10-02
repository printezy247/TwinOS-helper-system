#!/usr/bin/env bash
# scripts/desk-report.sh — post a plain-text report to the EzyMap Desk.
#
#   ./scripts/desk-report.sh docs/reports/2026-10-02.txt            send it
#   ./scripts/desk-report.sh --dry-run docs/reports/2026-10-02.txt  show the parts, send nothing
#
# It can reach one chat only: settings.desk_group_chat_id. It sends as the Ops
# bot with the token from the keyring; the token goes to curl on stdin, never
# on a command line. Telegram caps a message at 4096 characters, so the report
# is split on line breaks into parts of at most 3900.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH${HOME:+:$HOME/.npm-global/bin}"

say() { printf '%s\n' "$*"; }
die() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

DRY=no
[ "${1:-}" = "--dry-run" ] && { DRY=yes; shift; }
FILE="${1:-}"
[ -n "$FILE" ] || die "usage: scripts/desk-report.sh [--dry-run] <report.txt>"
[ -f "$FILE" ] || die "no such file: $FILE"

# --- split into parts -----------------------------------------------------------
LIMIT=3900
parts=()
cur=""
while IFS= read -r line || [ -n "$line" ]; do
  # A single line longer than the limit is cut into pieces.
  while [ "${#line}" -gt "$LIMIT" ]; do
    [ -n "$cur" ] && { parts+=("$cur"); cur=""; }
    parts+=("${line:0:$LIMIT}")
    line="${line:$LIMIT}"
  done
  if [ -z "$cur" ]; then
    cur="$line"
  elif [ $(( ${#cur} + 1 + ${#line} )) -le "$LIMIT" ]; then
    cur="$cur"$'\n'"$line"
  else
    parts+=("$cur")
    cur="$line"
  fi
done < "$FILE"
[ -n "$cur" ] && parts+=("$cur")
[ "${#parts[@]}" -gt 0 ] || die "the report is empty: $FILE"
total="${#parts[@]}"

if [ "$DRY" = yes ]; then
  i=0
  for p in "${parts[@]}"; do
    i=$((i + 1))
    say "--- part $i/$total, ${#p} chars"
    say "$p"
  done
  say ""
  say "DRY RUN: $total part(s) above, nothing sent."
  exit 0
fi

# --- live -----------------------------------------------------------------------
command -v supabase >/dev/null || die "the Supabase CLI is not installed (npm i -g supabase)"
command -v secret-tool >/dev/null || die "secret-tool is missing (sudo apt install libsecret-tools)"
command -v jq >/dev/null || die "jq is missing"
command -v curl >/dev/null || die "curl is missing"

out="$(supabase db query --linked --output-format json "select value::text as v from settings where key='desk_group_chat_id'" 2>&1)" \
  || die "db query failed (is the Supabase CLI logged in and linked? try: supabase projects list)"
DESK_ID="$(printf '%s' "$out" | sed -n '/^[[{]/,$p' | jq -r '(.rows? // .)[0].v // empty' 2>/dev/null || true)"
[ -n "$DESK_ID" ] || die "settings.desk_group_chat_id is unset (or the CLI said: $(printf '%s' "$out" | grep -v '^Initialising' | head -1))"

TOKEN="$(secret-tool lookup service twinos key ops_bot_token 2>/dev/null || true)"
[ -n "$TOKEN" ] || die "keyring entry 'ops_bot_token' is missing (docs/SETUP.md 0.5)"

say "sending $total part(s) to the EzyMap Desk"
i=0
for p in "${parts[@]}"; do
  i=$((i + 1))
  code="$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" \
    | curl -s -K - -o /dev/null -w '%{http_code}' \
        --data-urlencode "chat_id=$DESK_ID" \
        --data-urlencode "disable_web_page_preview=true" \
        --data-urlencode "text=$p")"
  [ "$code" = 200 ] || { TOKEN=""; die "Telegram answered HTTP $code for part $i/$total (parts before it were sent)"; }
  say "   part $i/$total: sent"
  [ "$i" -lt "$total" ] && sleep 1
done
TOKEN=""
say ""
say "DONE: the report is in the Desk ($total message(s))."
