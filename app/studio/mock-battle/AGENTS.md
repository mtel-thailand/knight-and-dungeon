# mock-battle (replayer + party builder)

Resolve-then-replay: the pure engine computes the whole battle; this module replays the
event log on a PixiJS isometric [5,6,7,6,5] board, and is the party-builder UI.

## Key files / entry points
- `MockBattleClient.tsx` (~3040 lines) — top-level page client:
  - **BattleStage** (the Pixi `useEffect`): frames loader + asset scoping,
    action resolution (`clipForRole` ladder), board geometry (`centerBoard`/`drawGrid`/
    `relayout`/`pixelOf`), playback primitives (`tween`/`playOnce`/`spawnDamage`/`updateHp`/
    `flashHit`/`knockback`/`flyProjectile`/`doMove`/`doAttack`/`doDeath`), beat dispatch
    (`runBeat`/`runReplay`).
  - `mockResolve` (offline fallback), `requestResolve`, party-builder state, `BoardPreview`,
    `PartyColumn`, `DisplayConfigPanel`.
- `GameScreenShell.tsx` — portable 9:19.5 portrait frame (no deps; movable to `/play`).

## Contract consumed
- `ResolveResult`/`BattleEvent` (read-only) from `POST /api/battle/resolve`.
- `GET /api/config` for catalog/seed/roleMaps/spells/characterSpells/mapConfig/damageConfig/roster.
- Geometry from `../studioHelpers` (`isoPos`/`isoHex`); `BOARD` from `lib/battle/types`.
- Writes ONLY: `/api/config/{map,damage,roster}`. **Never** writes battleStats/roleMaps/spells.

## Invariants / gotchas
- **Preserve emitted order within equal `t`** (group by `t`, never sort by `t`).
- **Pixi lifecycle:** `await import("pixi.js")` inside the effect; `destroyed` guards after every
  await; `genId` cancel token for re-fight; push teardown into `cleanups`; `resizeTo` the wrapper.
- **Asset scoping (perf):** load ONLY the battle characters' sheets — owned art + authored
  Actions' steps + role-map values + **each owned spell's `animationKey`** + `deriveFrom` chains.
- **Spell projectile:** `flyProjectile` (caster hex→target hex straight line); HP/number/flash
  fire AFTER flight (impact), not at cast. Visual config from `SpellDef` (fps/scaleX/scaleY/duration/…).
- Board = `result.initialState.hexes` (29 cells); `centerBoard` fits any hex set.
- **One `next dev` only** (two = separate SQLite WAL connections = inconsistent reads).

## Don't touch
- Don't import the engine; the only engine contact is the resolve HTTP route + the contract types.
- Don't persist battle data from here (server-managed; CMS owns it).
- Don't reach into `lib/battle` internals or redefine its types.

## Verify
`npx tsc --noEmit`; run one `next dev`; load `/studio/mock-battle`, start a fight, watch a
spell cast (projectile + impact), re-fight (cancel token), resize (recenter).
