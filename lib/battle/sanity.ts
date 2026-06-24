// lib/battle/sanity.ts
//
// Headless determinism / smoke check for the battle engine. NOT part of the app
// build — run manually:  npx tsx lib/battle/sanity.ts
//
// Resolves a 1v1 and a 3v3, logs the result + event count, and asserts that the
// same ResolveRequest yields byte-identical events twice (determinism).

import { resolveBattle } from "./engine";
import type { ResolveRequest, UnitStats } from "./types";

const blueStats: UnitStats = {
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

// Positions are in the centered axial frame: players on playerRow (r=2),
// enemies on enemyRow (r=-2). Must be valid hexes or pathing degrades.
const oneVsOne: ResolveRequest = {
  players: [{ characterId: "blue", stats: blueStats, position: { q: -1, r: 2 } }],
  enemies: [{ characterId: "little-green", stats: enemyStats, position: { q: 1, r: -2 } }],
};

const threeVsThree: ResolveRequest = {
  players: [
    { characterId: "blue", stats: blueStats, position: { q: -2, r: 2 } },
    { characterId: "blue", stats: blueStats, position: { q: -1, r: 2 } },
    { characterId: "big-green", stats: { ...blueStats, skills: [] }, position: { q: 0, r: 2 } },
  ],
  enemies: [
    { characterId: "little-green", stats: enemyStats, position: { q: 0, r: -2 } },
    { characterId: "little-green", stats: enemyStats, position: { q: 1, r: -2 } },
    { characterId: "little-green", stats: enemyStats, position: { q: 2, r: -2 } },
  ],
};

// Same-row exercise for the melee rule: both melee, started ADJACENT in the same
// row (r=0). A melee unit can't attack a same-row target, so it must reposition to
// a different row before it can engage — exercising canEngage / selectEngageTarget
// and the movement fallback. Asserts that path stays deterministic.
const sameRowMelee: ResolveRequest = {
  players: [{ characterId: "blue", stats: blueStats, position: { q: 0, r: 0 } }],
  enemies: [{ characterId: "little-green", stats: enemyStats, position: { q: 1, r: 0 } }],
};

// Spell path: a caster with a ready "attack" spell magic-strikes the nearest enemy
// from range (any position, ignores defense), exercising the new cast/cooldown
// branch + the spellcast event — must stay byte-identical across two runs.
const withSpell: ResolveRequest = {
  players: [
    {
      characterId: "blue",
      stats: { ...blueStats, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        { id: "fireball", power: 2, cooldown: 6, type: "attack", animationKey: "blue-spell" },
      ],
    },
  ],
  enemies: [{ characterId: "little-green", stats: enemyStats, position: { q: 1, r: -2 } }],
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
run("same-row", sameRowMelee);
run("spell", withSpell);
