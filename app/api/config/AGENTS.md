# persistence (Postgres + Drizzle ORM + config API)

Single source of truth for studio state, battle CMS data, spell catalog state, and
the mock-battle roster. This module owns the Postgres schema (via Drizzle ORM) and `/api/config` family.

## Key files / entry points
- `db.ts` — `createDb`, `readUserState`, `writeUserState`, `listAnimations`, `upsertAnimation`,
  `getCharacterSeed`, `upsertCharacterAnimation`, `deleteCharacter`, `getBattleStats`,
  `getCharacterRoleMaps`, `upsertBattleStats`, `upsertRoleMap`, `pruneBattleData`,
  `getMapConfig`, `saveMapConfig`, `getDamageConfig`, `saveDamageConfig`, `listSpells`,
  `getCharacterSpells`, `upsertSpell`, `deleteSpell`, `setCharacterSpells`, `getRoster`, `setRoster`.
- `route.ts` — GET aggregator + POST strip-list + DELETE character.
- Subroutes: `battle/route.ts`, `map/route.ts`, `damage/route.ts`, `spell/route.ts`, `roster/route.ts`.
- Seed source: `data/seed-battle.ts`.

## Contract consumed / exposed
- Owns the Postgres schema via Drizzle ORM (`lib/db/schema.ts`); connection managed through `lib/db/client.ts`.
  guarded `ALTER TABLE` migrations in `createDb`).
- `GET /api/config` returns mutable user state plus server-managed catalog/seed/battle data:
  `animations`, `characterSeed`, `battleStats`, `roleMaps`, `mapConfig`, `damageConfig`,
  `spells`, `characterSpells`, `roster`.
- `POST /api/config` must strip every server-managed key it returns.

## Invariants & gotchas
- If a GET key is server-managed, the POST strip-list in `route.ts` must be updated immediately.
- `lib/db/adapter.ts` is the only sanctioned DB access layer; always import from `@/lib/db`.
- `app/api/config/battle/route.ts` writes stats, role maps, and replace-all spell ownership.

## Don't touch
- Don't move persistence to JSON/localStorage.
- Don't let client saves overwrite server-owned tables or blobs.

## Verify
`npx tsc --noEmit`.
