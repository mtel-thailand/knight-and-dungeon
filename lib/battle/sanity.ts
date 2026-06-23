// lib/battle/sanity.ts
//
// Headless determinism / smoke check for the battle engine. NOT part of the app
// build — run manually:  npx tsx lib/battle/sanity.ts
//
// Resolves a 1v1 and a 3v3, logs the result + event count, and asserts that the
// same ResolveRequest yields byte-identical events twice (determinism).

import { resolveBattle } from "./engine";
import type { ResolveRequest, UnitStats } from "./types";

const knightStats: UnitStats = {
  hp: 1000,
  attack: 120,
  defense: 30,
  actionSpeed: 80,
  range: 1,
  skills: ["shield_bash"],
};

const enemyStats: UnitStats = {
  hp: 300,
  attack: 50,
  defense: 5,
  actionSpeed: 70,
  range: 1,
  skills: [],
};

const oneVsOne: ResolveRequest = {
  players: [{ characterId: "knight", stats: knightStats, position: { q: 2, r: 3 } }],
  enemies: [{ characterId: "skeleton", stats: enemyStats, position: { q: 2, r: 0 } }],
};

const threeVsThree: ResolveRequest = {
  players: [
    { characterId: "knight", stats: knightStats, position: { q: 1, r: 3 } },
    { characterId: "knight", stats: knightStats, position: { q: 2, r: 3 } },
    { characterId: "john", stats: { ...knightStats, skills: [] }, position: { q: 3, r: 3 } },
  ],
  enemies: [
    { characterId: "skeleton", stats: enemyStats, position: { q: 1, r: 0 } },
    { characterId: "skeleton", stats: enemyStats, position: { q: 2, r: 0 } },
    { characterId: "skeleton", stats: enemyStats, position: { q: 3, r: 0 } },
  ],
};

function run(label: string, req: ResolveRequest): void {
  const a = resolveBattle(req);
  const b = resolveBattle(req);
  const deterministic =
    a.result === b.result && JSON.stringify(a.events) === JSON.stringify(b.events);

  console.log(
    `${label}: result=${a.result} events=${a.events.length} ` +
      `units=${a.initialState.units.length} hexes=${a.initialState.hexes.length} ` +
      `deterministic=${deterministic}`,
  );

  if (!deterministic) {
    console.error(`  !! NON-DETERMINISTIC: ${label}`);
    process.exitCode = 1;
  }
}

run("1v1", oneVsOne);
run("3v3", threeVsThree);
