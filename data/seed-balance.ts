/**
 * Final balance seed: calibrate stats + 3 campaigns with rewards.
 *
 * Run: DATABASE_URL=... npx tsx data/seed-balance.ts
 */
import {
  upsertBattleStats, upsertRoleMap, pruneBattleData,
  upsertCampaign, setActiveCampaign,
} from "../lib/db/adapter";
import type { AttackType } from "../lib/battle/types";

// =============================================================================
// FINAL CALIBRATED STATS (verified with 1000-run simulations)
// =============================================================================
const ATK_TYPE_MELEE: AttackType = "melee";
const STATS: Record<string, { hp: number; attack: number; defense: number; actionSpeed: number; range: number; skills: string[]; attackType: AttackType }> = {
  "blue":         { hp: 250, attack: 30, defense: 2,  actionSpeed: 100, range: 1, skills: ["shield_bash"], attackType: ATK_TYPE_MELEE },
  "big-green":    { hp: 80,  attack: 32, defense: 0,  actionSpeed: 85,  range: 1, skills: [],              attackType: ATK_TYPE_MELEE },
  "little-green": { hp: 25,  attack: 8,  defense: 0,  actionSpeed: 120, range: 1, skills: [],              attackType: ATK_TYPE_MELEE },
};

// =============================================================================
// CAMPAIGNS — verified wave compositions
// =============================================================================
interface Wave { enemies: string[]; spawnCount: number }

const CAMPAIGNS: { id: string; name: string; difficulty: number; slots: number; waves: Wave[] }[] = [
  {
    id: "camp-easy", name: "The Rat Warrens", difficulty: 1, slots: 1,
    // 1 hero, ~73% win rate
    waves: [
      { enemies: ["big-green"],                          spawnCount: 0 },
      { enemies: ["big-green"],                          spawnCount: 0 },
      { enemies: ["big-green"],                          spawnCount: 1 },
    ],
  },
  {
    id: "camp-normal", name: "The Goblin Tunnels", difficulty: 2, slots: 2,
    // 2 heroes, ~50% win rate
    waves: [
      { enemies: ["big-green", "little-green", "little-green"],     spawnCount: 2 },
      { enemies: ["big-green", "little-green"],                     spawnCount: 2 },
      { enemies: ["big-green", "big-green", "big-green"],           spawnCount: 3 },
    ],
  },
  {
    id: "camp-hard", name: "The Dark Bastille", difficulty: 3, slots: 3,
    // 3 heroes, ~4% win rate
    waves: [
      { enemies: ["big-green", "big-green"],                        spawnCount: 2 },
      { enemies: ["big-green", "big-green"],                        spawnCount: 3 },
      { enemies: ["big-green", "big-green", "big-green"],           spawnCount: 4 },
    ],
  },
];

const ALL_IDS = Object.keys(STATS);

async function main() {
  // Seed stats
  for (const [id, s] of Object.entries(STATS)) {
    await upsertBattleStats(id, s);
    await upsertRoleMap(id, { idle: "idle", move: "idle", attack: "attack", hit: "hit", death: "die" });
  }
  await pruneBattleData(ALL_IDS);
  console.log(`Seeded ${ALL_IDS.length} characters`);

  // Seed campaigns
  for (const c of CAMPAIGNS) {
    const pool = [...new Set(c.waves.flatMap((w) => w.enemies))];
    const maxSpawn = Math.max(...c.waves.map((w) => w.spawnCount));
    await upsertCampaign({ id: c.id, name: c.name, waveCount: c.waves.length, monsterPool: pool, spawnCount: maxSpawn, difficulty: c.difficulty });
    console.log(`Campaign "${c.id}": ${c.waves.length} waves, maxSpawn=${maxSpawn}, pool=[${pool.join(",")}]`);
  }

  await setActiveCampaign(null);
  console.log("\nDone. Set a campaign as active in the CMS to play.");
}

main().catch((err) => { console.error(err); process.exit(1); });
