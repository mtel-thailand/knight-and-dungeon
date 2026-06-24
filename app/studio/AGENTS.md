# studio-cms

Imperative DOM + Pixi studio for characters, animations, actions, and battle data.
This module intentionally stays non-React inside `StudioClient.tsx`.

## Key files / entry points
- `StudioClient.tsx` — the big client; `useEffect` builds the Pixi canvas and all side panels via raw DOM.
  Key helpers/sections: `applyAnimation`, `resolveCharAnimKeys`, `renderPlaybackPanel`,
  `renderActionEditor`, `loadAnimationLive`, `submitAnimation`, `renderSpellsTab`, Battle Data panel.
- `studioConstants.ts`, `studioStyles.ts`, `studioTypes.ts`, `studioHelpers.ts` — extracted pure modules.
- `page.tsx` — renders `StudioClient`.

## Contract consumed / exposed
- Consumes `GET /api/config` (see `BootstrapPayload`, the client mirror of the server payload).
- Writes `POST /api/config/battle`, `POST /api/config/map`, `POST /api/config/damage`,
  `POST /api/config/roster`, and `POST/DELETE /api/config/spell`.
- Uses shared geometry from `studioHelpers.ts` (`getHexRowsFromCounts`, `isoPos`, `isoHex`) and `lib/battle/types.ts`.

## Invariants & gotchas
- `applyAnimation(idx)` is the single source of truth for sprite paint and transform.
- Pixi is loaded lazily with `await import('pixi.js')`; cleanup must survive Strict Mode double-invoke.
- Keep the board geometry aligned with `BOARD.rowCounts` / `[5,6,7,6,5]`; don't resurrect radius-based layout math.
- This component is intentionally imperative; don't migrate it piecemeal to declarative React.

## Don't touch
- Don't redefine `lib/battle` types here.
- Don't inline the shared constants/styles/helpers back into the giant client.

## Verify
`npx tsc --noEmit`; smoke `/studio`.
