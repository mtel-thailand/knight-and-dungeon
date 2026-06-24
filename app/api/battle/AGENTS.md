# battle resolve HTTP face

Thin adapter for the pure engine: parse, validate/clamp, canonicalize, then call
`resolveBattle`. Clients reach battle logic only through this route.

## Key files / entry points
- `resolve/route.ts` — `POST /api/battle/resolve`.
- Pipeline helpers: `sanitizeStat`, `sanitizePosition`, `sanitizeSpells`, `sanitizeMember`,
  `sanitizeParty`, `canonicalize`.
- Contract/types come from `lib/battle/types.ts`; simulation comes from `lib/battle/engine.ts`.

## Contract consumed / exposed
- Consumes `ResolveRequest`, `PartyMemberInput`, `ResolveResult`, `BOARD`, `STAT_BOUNDS`,
  `SPELL_BOUNDS`, `DEFAULT_ATTACK_TYPE`, `MAX_SPELLS_PER_UNIT`.
- Exposes only `POST /api/battle/resolve` as the engine's HTTP face.

## Invariants & gotchas
- No game rules here; keep targeting, damage, turn logic, and determinism in `lib/battle`.
- Clamp / reject bad payloads here before the request reaches the engine.
- Preserve canonical deploy ordering and let the engine preserve emitted event order.

## Don't touch
- Don't add alternate battle entry points or bypass the resolve route.
- Don't import Pixi, DB helpers, or studio code.

## Verify
`npx tsc --noEmit` && `npx tsx lib/battle/sanity.ts`.
