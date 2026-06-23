// data/seed-battle.ts
//
// Idempotent battle-data seeder for /studio/mock-battle. Authors per-character
// combat stats + event-role->animation maps into SQLite (data/app.db) via the
// db.ts helpers, then prunes battle rows for any character no longer in the
// roster. Safe to re-run (writes are upserts; prune removes stale rows).
//
// Run from the repo root:  npx tsx data/seed-battle.ts
//
// LIVE ROSTER (verified against data/app.db):
//   - john      ("John")     — full own-frame animation kit, incl. real hit
//                              (john-hit) and death (john-defeated) art.
//   - john-copy ("Red John") — a tinted variant with NO own character_animations
//                              rows; it renders via the GLOBAL animation catalog,
//                              so its role map points at the same john-* keys.
// `knight` is NOT a live character (no character_animations, not in the roster),
// so it is intentionally dropped here and pruned from the battle tables.
//
// Role-map values are global animation catalog keys (the replayer resolves a
// role-map value as a global animation key). Every value below is a real,
// own-frame john-* animation, so all five roles resolve directly.

import {
  upsertBattleStats,
  upsertRoleMap,
  upsertSpell,
  setCharacterSpells,
  pruneBattleData,
  getBattleStats,
  getCharacterRoleMaps,
} from "../app/api/config/db";
import type {
  UnitStats,
  CharacterRoleMap,
  SpellDef,
} from "../lib/battle/types";

type CharacterSeed = {
  stats: UnitStats;
  roles: CharacterRoleMap;
  spells: string[];
};

// john + john-copy share one mapping: john-copy has no own frames and renders
// through the global john-* catalog, so the same keys drive both.
const JOHN_ROLES: CharacterRoleMap = {
  idle: "john-idle",
  move: "john-jump-forward",
  attack: "john-sword-swing",
  hit: "john-hit",
  death: "john-defeated",
};

// Global spell catalog seeded into `spells`; characters own ids from it.
const SPELLS: SpellDef[] = [
  { id: "fireball", name: "Fireball", animationKey: "john-spell", type: "attack", power: 2, cooldown: 6 },
];

const ROSTER: Record<string, CharacterSeed> = {
  john: {
    stats: {
      hp: 520,
      attack: 95,
      defense: 16,
      actionSpeed: 80,
      range: 1,
      skills: ["shield_bash"],
      attackType: "melee",
    },
    roles: JOHN_ROLES,
    spells: ["fireball"],
  },
  "john-copy": {
    stats: {
      hp: 560,
      attack: 100,
      defense: 18,
      actionSpeed: 74,
      range: 1,
      skills: ["shield_bash"],
      attackType: "melee",
    },
    roles: JOHN_ROLES,
    spells: ["fireball"],
  },
};

for (const spell of SPELLS) {
  upsertSpell(spell);
}

for (const [characterId, seed] of Object.entries(ROSTER)) {
  upsertBattleStats(characterId, seed.stats);
  upsertRoleMap(characterId, seed.roles);
  setCharacterSpells(characterId, seed.spells);
  console.log(`seeded battle data for "${characterId}"`);
}

// Drop battle rows for any character no longer in the roster (e.g. stale knight),
// so re-running fully syncs the tables to ROSTER.
pruneBattleData(Object.keys(ROSTER));

console.log("\n--- battleStats ---");
console.log(JSON.stringify(getBattleStats(), null, 2));
console.log("\n--- roleMaps ---");
console.log(JSON.stringify(getCharacterRoleMaps(), null, 2));
