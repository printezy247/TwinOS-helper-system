"""Studio module (plan §9.G): lives and shorts on Jack's GPU.

Optional extras (requirements.txt): faster-whisper, Pillow. ffmpeg must be on
PATH. Everything here is imported lazily by twinos_worker.py and guarded by
ImportError so the worker runs without the extras.
"""
