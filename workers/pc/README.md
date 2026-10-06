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
| `run_worker.sh` | Starts the worker with the `.venv` python when it exists |
| `twinos-worker.service` | systemd **user** unit |
| `test_worker.py` | `python3 -m unittest` (no network, no keyring) |

## GPU setup (clipping)

The worker itself is standard library only. Clipping needs the studio extras,
and they live in a venv beside the worker so they can never collide with the
system python:

```bash
cd ~/TwinOS-helper-system/workers/pc
python3 -m venv .venv
./.venv/bin/pip install "faster-whisper>=1.0" "Pillow>=10" "av<14" nvidia-cublas-cu12 nvidia-cudnn-cu12
systemctl --user restart twinos-worker      # picks the venv up via run_worker.sh
```

Three things on this machine are not optional, and each one cost a real
failure to find:

- **`av<14`.** faster-whisper 1.2.1 still calls
  `av.open(..., metadata_errors="ignore")`; av 14 removed that argument, so
  every transcription dies in the decoder with `TypeError: open() got an
  unexpected keyword argument 'metadata_errors'`.
- **`nvidia-cublas-cu12` and `nvidia-cudnn-cu12`.** CTranslate2 loads them at
  run time and finds nothing without them:
  `Library libcublas.so.12 is not found or cannot be loaded`. `run_worker.sh`
  puts their `lib` directories on `LD_LIBRARY_PATH`.
- **The compute type is discovered, not assumed.** The GTX 1050 Ti is compute
  capability 6.1 and has no `int8_float16`; `clipper.load_model()` walks down
  a list per device and reports which one it used (this machine lands on
  `cuda`/`int8_float32`).

Verify without a recording of your own:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=6" -ar 16000 -ac 1 /tmp/t.wav
./.venv/bin/python -c "import sys; sys.path.insert(0,'.'); from pathlib import Path; \
  from studio import clipper; print(clipper.transcribe(Path('/tmp/t.wav'), 'en')[:1])"
```

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

One command does all of this (folders, unit, enable, linger, self-test, a
queued test job, and the backup if `db_url` is stored):

```bash
cd ~/TwinOS-helper-system
./scripts/install-worker.sh --check    # preflight only, changes nothing
./scripts/install-worker.sh            # install and verify
```

The manual steps it replaces:

```bash
# 1. Secrets in the keyring, never in files
~/TwinOS-helper-system/scripts/mint-keys.sh    # stores url, apikey (anon) and worker_key; prints no secret
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

Remove the service with `./scripts/install-worker.sh --uninstall`.

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


## Clipping a live (Phase 5)

Put the recording in `~/EzyMap/lives/` (OBS's `.mkv` is fine; the file name should carry the date, `2026-09-30` or
`20260930`, and ideally `tiktok` or `telegram`). Then ask ABDUL, or call the tool:

```
twinos_clip {}                                          # yesterday's TikTok live, plain cuts
twinos_clip {"layout": "blurred_fill"}                  # 1080x1920 clips, chart over a blurred copy of itself
twinos_clip {"layout": "chart_face", "face_box": [1400, 600, 480, 360]}   # chart on top, camera view underneath
twinos_clip {"layout": "chart_full", "end_text": "Not financial advice."} # plus a 3 second end card on every clip
```

`face_box` is `[x, y, width, height]` of the camera view in the recording. Without one, `chart_face` crops the lower
right quarter. The worker needs `pip install faster-whisper Pillow` and `ffmpeg` on the PATH; clips land in
`~/EzyMap/lives/clips/<recording>/` with an SRT and a `clips.json`. CapCut stays the editor: nothing is burned in.
