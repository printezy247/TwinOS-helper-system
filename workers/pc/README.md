# TwinOS PC worker

The part of TwinOS that needs Jack's PC: the GPU, the drop folder CapCut
exports into, the Telechurn CSV and the nightly backup. It **never opens a
port**. It polls the `jobs` function with a scoped key, runs one job, posts the
result back (plan §7).

## Files

| File | What |
|---|---|
| `twinos_worker.py` | The worker. Python 3.12 standard library only |
| `studio/clipper.py` | Live recording → transcript → clips (needs `faster-whisper`, `ffmpeg`). Phase 5 |
| `requirements.txt` | Optional extras; the worker runs without them |
| `twinos-worker.service` | systemd **user** unit |
| `test_worker.py` | `python3 -m unittest` (no network, no keyring) |

## Job kinds (Phase 1)

| Kind | What it does | Where the input lives |
|---|---|---|
| `drop_folder_watch` | Every `.mp4/.mov/.webm/.png/.jpg` in `~/EzyMap/out/` → signed upload to the `assets` bucket → `assets` row. Moved to `~/EzyMap/out/.ingested/` after. Also runs on idle without a job row | `~/EzyMap/out/` |
| `telechurn_import` | CSV with `link_name,joins,leaves,retained` → `telechurn_imports` | `~/EzyMap/telechurn/<monday>.csv` |
| `backup` | `pg_dump` (or `supabase db dump`) → `~/EzyMap/backups/twinos-<stamp>.sql.gz`, keeps 14 | keyring `twinos/db_url` |
| `clip` | `studio.clipper.run(source)`; stub until the extras are installed | job payload `source` |
| `scorecard_image` | Pillow renderer (Phase 2, `studio/scorecard.py` not written yet) | job payload |
| `research_batch` | Phase 5 stub; reports "not implemented" | – |

Assets over 45 MB are refused (plan §7 storage limit).

## Setup (Jack, Phase 1)

```bash
# 1. Secrets in the keyring, never in files
secret-tool store --label "TwinOS url"        service twinos key url          # https://<ref>.supabase.co
secret-tool store --label "TwinOS worker key" service twinos key worker_key   # twk_pc_worker_… from mint_api_key()
secret-tool store --label "TwinOS db url"     service twinos key db_url       # postgresql://… (backups only; optional)

# 2. Folders
mkdir -p ~/EzyMap/out ~/EzyMap/telechurn ~/EzyMap/backups

# 3. Try it
cd ~/TwinOS-helper-system/workers/pc
python3 twinos_worker.py --self-test
python3 twinos_worker.py --once -v

# 4. Run it always
mkdir -p ~/.config/systemd/user
cp twinos-worker.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now twinos-worker
journalctl --user -u twinos-worker -f
```

Optional extras for clipping: `pip install "faster-whisper>=1.0" "Pillow>=10"`
(the GTX 1050 Ti handles the `small` model in int8).

## Health

Every claim call writes a `pc_worker` beat into `health_checks`. The `health`
function alerts Jack when no beat arrives for 20 minutes
(`settings.health_stale_pc_worker` to change).

## Environment overrides (tests, odd paths)

`TWINOS_URL`, `TWINOS_WORKER_KEY`, `TWINOS_DB_URL` override the keyring;
`TWINOS_DROP_DIR`, `TWINOS_TELECHURN_DIR`, `TWINOS_BACKUP_DIR` override the folders.
Do not put the real key into a `.env`: `.env*` is git-ignored but the keyring is the rule on this PC.
