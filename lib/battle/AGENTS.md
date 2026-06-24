# battle-engine

Pure, deterministic party-vs-party hex auto-battle. The same ResolveRequest in ⇒
byte-identical events out. This module is the gold-standard isolation in the repo.

## Key files / entry points
- `types.ts`  — THE frozen contract (also imported by db, routes, both clients). See "Contract".
- `engine.ts` — `resolveBattle(req)` (entry), `createBattle`/`buildUnit`/`decideUnitAction`/
  `executeAction`/`updateBattle`/`checkDeaths`/`checkBattleEnd`, `selectTarget`, `SKILLS`.
- `hex.ts`    — `VALID_HEXES` (the [5,6,7,6,5] board), `getNeighbors`/`hexDistance`/`isValidHex`/
  `getNextHexToward`/`tryPushUnit`. Board shape lives ONLY here + `BOARD.rowCounts`.
- `sanity.ts` — determinism harness. Run: `npx tsx lib/battle/sanity.ts`.
- Server adapter (this module's HTTP face): `app/api/battle/resolve/route.ts` —
  validate → clamp (STAT_BOUNDS/SPELL_BOUNDS) → canonicalize → `resolveBattle`.

## Invariants (do not break)
- **Purity:** no React/Pixi/DB/`next` imports; no `Date`, no `Math.random`.
- **Determinism rests on:** fixed `BATTLE_TICK`, array-order unit iteration, `-= 100` gauge
  carryover (not reset), per-battle ids (`${team}-${characterId}-${i}`, no module counter),
  and full lower-`r`/lower-`q` tie-breaks. Don't reorder units or introduce a stable-sort assumption.
- **Spell = MAGIC:** any range/row, targets `selectTarget` (nearest→lowHP→r→q), damage
  `floor(attack*power)` ignoring defense, cooldown keyed `spell:<id>`. Priority in
  `decideUnitAction`: **spell → skill → attack → move**.
- **`SpellInput` carries NO visual fields** (fps/scaleX/scaleY/duration/offsets/rotation live in `SpellDef` only).
- **Optionality = backward-compat:** `PartyMemberInput.spells?` defaults `[]` in `buildUnit`;
  a spell-less request is byte-identical to pre-spell output (sanity proves it).
- Event `t` = `currentTime` at emission; several events share one `t`; consumers preserve emitted order.

## Don't touch
- Don't import this module's internals from clients — go through `POST /api/battle/resolve`.
- Don't add fields to `types.ts` shapes without the contract-change protocol (root AGENTS.md).
- The resolve route is the ONLY entry; it owns clamping (anti-hang: `actionSpeed` cap).

## Verify
`npx tsc --noEmit` && `npx tsx lib/battle/sanity.ts` (expect `deterministic=true`, `hexes=29`).
