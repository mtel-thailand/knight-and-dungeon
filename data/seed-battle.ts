// data/seed-battle.ts
//
// Idempotent battle-data seeder for /studio/mock-battle. Authors per-character
// combat stats + event-role->animation maps into SQLite (data/app.db) via the
// db.ts helpers, then prunes battle rows for any character no longer in the
// roster. Safe to re-run (writes are upserts; prune removes stale rows).
//
// Run from the repo root:  npx tsx data/seed-battle.ts
//
// LIVE ROSTER — exactly three real characters, each with its own animation kit:
//   - blue         ("Blue")         — has the shield_bash skill.
//   - little-green  ("Little Green").
//   - big-green     ("Big Green").
//
// Role-map values are per-character authored Action ids (e.g. "attack", "stab")
// or raw animation catalog keys; the replayer resolves either.

import {
  upsertBattleStats,
  upsertRoleMap,
  setCharacterSpells,
  pruneBattleData,
  getBattleStats,
  getCharacterRoleMaps,
} from "../app/api/config/db";
import type { UnitStats, CharacterRoleMap } from "../lib/battle/types";

type CharacterSeed = {
  stats: UnitStats;
  roles: CharacterRoleMap;
  spells: string[];
};

const ROSTER: Record<string, CharacterSeed> = {
  blue: {
    stats: { hp: 200, attack: 20, defense: 0, actionSpeed: 100, range: 1, skills: ["shield_bash"], attackType: "melee" },
    roles: { idle: "idle", move: "idle", attack: "attack", hit: "hit", death: "die" },
    spells: [],
  },
  "little-green": {
    stats: { hp: 20, attack: 5, defense: 0, actionSpeed: 100, range: 1, skills: [], attackType: "melee" },
    roles: { idle: "idle", move: "idle", attack: "stab", hit: "take-hit", death: "die" },
    spells: [],
  },
  "big-green": {
    stats: { hp: 150, attack: 15, defense: 0, actionSpeed: 100, range: 1, skills: [], attackType: "melee" },
    roles: { idle: "idle", move: "idle", attack: "attack", hit: "hit", death: "die" },
    spells: [],
  },
};

for (const [characterId, seed] of Object.entries(ROSTER)) {
  upsertBattleStats(characterId, seed.stats);
  upsertRoleMap(characterId, seed.roles);
  setCharacterSpells(characterId, seed.spells);
  console.log(`seeded battle data for "${characterId}"`);
}

// Drop battle rows for any character no longer in the roster, so re-running
// fully syncs the tables to ROSTER.
pruneBattleData(Object.keys(ROSTER));

console.log("\n--- battleStats ---");
console.log(JSON.stringify(getBattleStats(), null, 2));
console.log("\n--- roleMaps ---");
console.log(JSON.stringify(getCharacterRoleMaps(), null, 2));
