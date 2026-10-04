#!/usr/bin/env bash
# scripts/install-worker.sh — install the TwinOS PC worker as a systemd user
# service (P1.8). It never opens a port; it only polls outbound.
#
#   ./scripts/install-worker.sh              install, enable, start, verify
#   ./scripts/install-worker.sh --check      preflight only, change nothing
#   ./scripts/install-worker.sh --uninstall  stop, disable, remove the unit
#
# Secrets stay in the keyring (secret-tool); the unit file carries none.
# The verify step enqueues a harmless `drop_folder_watch` job and waits for the
# worker to finish it, so a green run proves enqueue -> claim -> run -> result.
#
# `jobs/enqueue` is jack/abdul/cron only, so the test job is enqueued through
# the Supabase CLI (like the seed and the cron), not with the worker's key.
set -euo pipefail
. "$(dirname "$0")/_lib.sh"
cd "$(dirname "$0")/.."
export PATH="$PATH${HOME:+:$HOME/.npm-global/bin}"

grab() { grep -oE "$1" | head -1 || true; }

MODE="${1:-install}"
case "$MODE" in
  install|--check|--uninstall) ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 2 ;;
esac

UNIT_SRC="workers/pc/twinos-worker.service"
UNIT_DST="$HOME/.config/systemd/user/twinos-worker.service"
SERVICE="twinos-worker"
WORKER="workers/pc/twinos_worker.py"
BACKUP_DIR="$HOME/EzyMap/backups"

# --- preflight ---------------------------------------------------------------
say "1. preflight"
[ -f "$UNIT_SRC" ] || die "$UNIT_SRC is missing"
[ -f "$WORKER" ] || die "$WORKER is missing"
command -v systemctl >/dev/null || die "systemctl is missing"
command -v python3 >/dev/null || die "python3 is missing"
command -v secret-tool >/dev/null || die "secret-tool is missing (sudo apt install libsecret-tools)"
systemctl --user show-environment >/dev/null 2>&1 || die "no systemd user session (log in to your desktop and retry)"

missing=""
for k in url worker_key; do [ -n "$(ring "$k")" ] || missing="$missing $k"; done
[ -z "$missing" ] || die "keyring is missing:$missing — run ./scripts/mint-keys.sh first (docs/SETUP.md 0.4)"
say "   systemd user session: ok; keyring url + worker_key: present"
if [ -n "$(ring db_url)" ]; then say "   keyring db_url: present (backups can run)"; else say "   keyring db_url: MISSING (backups will be skipped)"; fi

if [ "$MODE" = "--check" ]; then
  say ""
  say "CHECK ONLY — nothing changed. Run without --check to install."
  exit 0
fi

# --- uninstall ---------------------------------------------------------------
if [ "$MODE" = "--uninstall" ]; then
  say "2. stop and remove the service"
  systemctl --user disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT_DST"
  systemctl --user daemon-reload
  say "   removed. Folders and keyring entries are left alone."
  exit 0
fi

# --- install -----------------------------------------------------------------
say "2. folders"
mkdir -p "$HOME/EzyMap/out" "$HOME/EzyMap/telechurn" "$BACKUP_DIR" "$HOME/.config/systemd/user"
say "   ~/EzyMap/{out,telechurn,backups}"

say "3. unit -> $UNIT_DST"
cp "$UNIT_SRC" "$UNIT_DST"
systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE"
say "   enabled and started"

say "4. linger (keep it running when you are not logged in)"
if [ "$(loginctl show-user "$USER" -p Linger 2>/dev/null)" = "Linger=yes" ]; then
  say "   already on"
elif loginctl enable-linger "$USER" 2>/dev/null; then
  say "   enabled"
else
  say "   NOTE: could not enable it without a password. Run: sudo loginctl enable-linger $USER"
  say "         (without it the worker stops when you log out — fine while you are at the PC)"
fi

say "5. self-test"
python3 "$WORKER" --self-test || die "the worker self-test failed (keyring or API unreachable)"
say "   self-test ok"

say "6. queued test job: enqueue -> worker claims -> done"
job_id="$(query "insert into public.jobs (kind, payload, status, created_by)
                 values ('drop_folder_watch', '{}'::jsonb, 'queued', 'install-worker')
                 returning 'JOB:' || id::text || ':END' as s" | grab 'JOB:[0-9a-f-]+:END' | cut -d: -f2)"
[ -n "$job_id" ] || die "could not enqueue the test job"
say "   enqueued $job_id; waiting (up to 90 s)"
state=""
for _ in $(seq 1 30); do
  state="$(query "select 'JOB:' || status || ':END' as s from public.jobs where id = '$job_id'" | grab 'JOB:[a-z_]+:END' | cut -d: -f2)"
  case "$state" in done|failed) break ;; esac
  sleep 3
done
[ "$state" = "done" ] || die "the test job is '$state' (not done). Check: systemctl --user status $SERVICE; journalctl --user -u $SERVICE -n 50"
say "   job done — the loop works"

say "7. nightly backup"
if [ -n "$(ring db_url)" ]; then
  bjob="$(query "insert into public.jobs (kind, payload, status, created_by)
                 values ('backup', '{}'::jsonb, 'queued', 'install-worker')
                 returning 'JOB:' || id::text || ':END' as s" | grab 'JOB:[0-9a-f-]+:END' | cut -d: -f2)"
  bstate=""
  for _ in $(seq 1 40); do
    bstate="$(query "select 'JOB:' || status || ':END' as s from public.jobs where id = '$bjob'" | grab 'JOB:[a-z_]+:END' | cut -d: -f2)"
    case "$bstate" in done|failed) break ;; esac
    sleep 3
  done
  [ "$bstate" = "done" ] || die "the backup job is '$bstate'. Check: journalctl --user -u $SERVICE -n 50"
  ls -1 "$BACKUP_DIR"/twinos-*.sql.gz >/dev/null 2>&1 || die "the backup job reported done but no file is in $BACKUP_DIR"
  say "   backup file: $(ls -1t "$BACKUP_DIR"/twinos-*.sql.gz | head -1)"
else
  say "   SKIPPED — keyring 'db_url' is not set, so job_backup has no connection string."
  say "   Store it once (Dashboard -> Database -> Connection string, Session pooler):"
  say "     secret-tool store --label 'TwinOS db url' service twinos key db_url"
  say "   Then re-run this script, or wait for the 03:00 MYT cron job."
fi

say ""
say "Installed. Logs:"
say "  systemctl --user status $SERVICE"
say "  journalctl --user -u $SERVICE -f"
say "  journalctl --user -u $SERVICE --since '1 hour ago'"
say "Remove it with: ./scripts/install-worker.sh --uninstall"
