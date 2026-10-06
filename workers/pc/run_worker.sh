#!/usr/bin/env bash
# run_worker.sh — start the PC worker with the python that has the studio extras.
#
# The worker itself is standard library only. `studio/clipper.py` needs
# faster-whisper (and Pillow for the scorecard), and those live in `.venv`
# beside this file so they can never collide with the system python.
#
# Using the venv when it exists and the system python when it does not keeps
# the service starting on a machine that has not installed the extras — a clip
# job reports "faster-whisper not installed" instead of the whole worker being
# down. That is the same trade the lazy imports inside studio/ already make.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
py="$here/.venv/bin/python3"
[ -x "$py" ] || py=/usr/bin/python3

# CTranslate2 loads cuBLAS and cuDNN at runtime. The pip nvidia-* wheels keep
# them under site-packages, which is not on the loader path by default, so a
# GPU run would fail with "Library libcublas.so.12 is not found or cannot be
# loaded" on a machine whose system CUDA is a different major version.
nv="$here/.venv/lib/python3.12/site-packages/nvidia"
if [ -d "$nv" ]; then
  libs="$(find "$nv" -type d -name lib 2>/dev/null | paste -sd: -)"
  [ -n "$libs" ] && export LD_LIBRARY_PATH="${libs}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec "$py" "$here/twinos_worker.py"
