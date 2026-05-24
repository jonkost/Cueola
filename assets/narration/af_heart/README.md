# Cueola narration assets

Place generated Kokoro `af_heart` MP3 files in this folder.

Cueola looks for `manifest.json` first. If a lesson reference appears in the manifest and the matching MP3 exists, the Learning Hub plays that file. It is Kokoro-only: if the file is not ready yet, Cueola shows the pending reference instead of falling back to a browser system voice.

Cueola keeps its own Kokoro environment separate from other projects. Initial setup:

```bash
/opt/homebrew/bin/python3.12 -m venv .venv-kokoro
.venv-kokoro/bin/python -m pip install --upgrade pip mlx-audio 'misaki[en]'
```

Generate files with:

```bash
.venv-kokoro/bin/python scripts/generate_cueola_narration.py
```

Each MP3 should be named with the reference ID from `docs/content-reference.md`, for example:

```text
LH-start.lesson.mp3
```
