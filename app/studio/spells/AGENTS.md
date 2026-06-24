# spell-cms

Global spell library and per-spell editor. These pages own the catalog UI and the
preview/convert flow for visual spell assets.

## Key files / entry points
- `spells/page.tsx` — list/create/delete page for the global `spells` catalog.
- `spells/[id]/page.tsx` — edit page with preview canvas, playback knobs, and MP4 convert-and-assign.
- `spellsStyles.ts` — page-scoped CSS for both routes.

## Contract consumed / exposed
- Uses `SpellDef` from `lib/battle/types.ts`.
- Reads `spells` + `animations` from `GET /api/config` via `BootstrapPayload`.
- Writes the catalog through `POST/DELETE /api/config/spell` and the conversion route through `POST /api/spell/animation`.
- Uses `slugify` from `../studioHelpers`.

## Invariants & gotchas
- Visual-only fields live on `SpellDef`: `fps`, `scale`, `loop`, `duration`, `offsetX`, `offsetY`, `rotation`.
- Those fields are for preview/CMS only; they must never leak into the engine's `SpellInput`.
- The preview canvas must restart cleanly on knob changes and cancel its rAF on teardown.
- Per-character ownership stays in the studio Battle Data panel, not here.

## Don't touch
- Don't move per-character spell assignment into this library UI.
- Don't couple preview rendering to engine internals.

## Verify
`npx tsc --noEmit`; smoke `/studio/spells`.
