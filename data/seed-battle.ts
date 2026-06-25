// data/seed-battle.ts
//
// Idempotent battle-data seeder for /studio/mock-battle. Authors per-character
// combat stats + event-role->animation maps into the database, then prunes
// battle rows for any character no longer in the roster.
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

import type { UnitStats, CharacterRoleMap, BattleRewardEffect, BattleRewardRarity } from "../lib/battle/types";
import { DEFAULT_BATTLE_REWARDS } from "../lib/battle/types";

import {
  upsertBattleStats,
  upsertRoleMap,
  setCharacterSpells,
  pruneBattleData,
  getBattleStats,
  getCharacterRoleMaps,
  upsertBattleReward,
  pruneBattleRewards,
} from "../lib/db/adapter";

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
    roles: { idle: "idle", move: "idle", attack: "attack", hit: "hit", death: "die" },
    spells: [],
  },
  "big-green": {
    stats: { hp: 150, attack: 15, defense: 0, actionSpeed: 100, range: 1, skills: [], attackType: "melee" },
    roles: { idle: "idle", move: "idle", attack: "attack", hit: "hit", death: "die" },
    spells: [],
  },
};

(async () => {
  for (const [characterId, seed] of Object.entries(ROSTER)) {
    await upsertBattleStats(characterId, seed.stats);
    await upsertRoleMap(characterId, seed.roles);
    await setCharacterSpells(characterId, seed.spells);
    console.log(`seeded battle data for "${characterId}"`);
  }

  await pruneBattleData(Object.keys(ROSTER));

  for (let i = 0; i < DEFAULT_BATTLE_REWARDS.length; i++) {
    await upsertBattleReward({ ...DEFAULT_BATTLE_REWARDS[i], sortOrder: i });
    console.log(`seeded battle reward "${DEFAULT_BATTLE_REWARDS[i].id}"`);
  }
  await pruneBattleRewards(DEFAULT_BATTLE_REWARDS.map((reward) => reward.id));

  console.log("\n--- battleStats ---");
  console.log(JSON.stringify(await getBattleStats(), null, 2));
  console.log("\n--- roleMaps ---");
  console.log(JSON.stringify(await getCharacterRoleMaps(), null, 2));
})().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
