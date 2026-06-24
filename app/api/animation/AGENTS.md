# asset-pipeline

MP4 → spritesheet authoring and local-dev conversion. This module bridges the Python
CLI pipeline and the Next.js upload routes that register new animations.

## Key files / entry points
- `add_animation.py` — MP4 → PNG+JSON → SQLite catalog row; live use is `--assets-dir ./public/assets --no-inject`.
- `make_spritesheet.py` — bare spritesheet PNG generator.
- `app/api/animation/route.ts` — multipart upload route; shells `python3 add_animation.py`, writes `public/assets`, upserts the animation and character kit.
- `app/api/spell/animation/route.ts` — local-dev spell conversion route; shells `ffprobe`/`ffmpeg`, writes `public/assets`, then `upsertAnimation`.

## Contract consumed / exposed
- Frames are keyed `<name_with_underscores>_<NNN>`; frame order comes from `Object.keys` and zero-padded names.
- The upload routes consume multipart form data and return the registered catalog key / row.

## Invariants & gotchas
- `chromakey` default green is `0x04F108`; the legacy CLI frame size is 160 with 4 columns.
- `app/api/spell/animation/route.ts` is local-dev only (no Vercel / read-only FS / missing ffmpeg).
- Keep generated PNGs under `public/assets`; legacy root `assets/` and `main.js` are dead.

## Don't touch
- Don't replace the CLI + route pipeline with manual PNG editing.
- Don't make the local-dev route part of the production contract.

## Verify
`npx tsc --noEmit`; local smoke with `ffmpeg` and `ffprobe` on PATH.
