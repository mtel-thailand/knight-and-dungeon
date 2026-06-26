// data/seed-test-campaign.ts
//
// Creates/updates a test campaign with mid-fight spawning enabled since wave 1.
// Run: npx tsx data/seed-test-campaign.ts
// Requires DATABASE_URL env pointing to the target Postgres.

import { upsertCampaign, setActiveCampaign, getBattleStats } from "../lib/db/adapter";

(async () => {
  // Get available enemy types so we can seed the monster pool
  const stats = await getBattleStats();
  const pool = Object.keys(stats).filter((id) => id !== "blue" && id !== "john-copy");
  console.log("Monster pool candidates:", pool);

  await upsertCampaign({
    id: "test-spawn-cave",
    name: "Spawn Test (Cave)",
    waveCount: 3,
    monsterPool: pool.length > 0 ? pool : ["blue"],
    spawnCount: 5, // 5 extra enemies per wave, spawn every 3s, max 5 on board
  });
  console.log('Created/updated campaign "test-spawn-cave" with spawnCount=5');

  await setActiveCampaign("test-spawn-cave");
  console.log('Set "test-spawn-cave" as the active campaign');

  console.log("\nDone. Open /g/camp to test — enemies should spawn mid-fight.");
})().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
