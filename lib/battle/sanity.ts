// lib/battle/sanity.ts
//
// Headless determinism / smoke check for the battle engine. NOT part of the app
// build — run manually:  npx tsx lib/battle/sanity.ts
//
// Resolves a 1v1 and a 3v3, logs the result + event count, and asserts that the
// same ResolveRequest yields byte-identical events twice (determinism).
// Also verifies mana-on-death accrual, spell blocking by mana, spell casting
// with mana, and heal-spell execution (full and capped).

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
// from range (any position, ignores defense). Starting mana is set so the spell
// actually fires. Must be byte-identical across two runs.
const withSpell: ResolveRequest = {
  players: [
    {
      characterId: "blue",
      stats: { ...blueStats, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        {
          id: "fireball",
          power: 2,
          cooldown: 6,
          type: "attack",
          animationKey: "blue-spell",
          manaCost: 2,
        },
      ],
    },
  ],
  enemies: [{ characterId: "little-green", stats: enemyStats, position: { q: 1, r: -2 } }],
  startingMana: { player: 5 },
};

// ---- Mana-specific test cases ----

// Mana-on-death: enemy dies → player gains +1 mana.
const manaOnDeath: ResolveRequest = {
  players: [
    {
      characterId: "blue",
      stats: { hp: 500, attack: 100, defense: 10, actionSpeed: 200, range: 1, skills: [] },
      position: { q: -1, r: 2 },
    },
  ],
  enemies: [
    {
      characterId: "little-green",
      stats: { hp: 10, attack: 1, defense: 0, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 1, r: -2 },
    },
  ],
  startingMana: { player: 0, enemy: 0 },
};

// Spell blocked — no mana: has spell but 0 mana → no spellcast events.
const spellBlockedNoMana: ResolveRequest = {
  players: [
    {
      characterId: "blue",
      stats: { ...blueStats, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        {
          id: "fireball",
          power: 2,
          cooldown: 6,
          type: "attack",
          animationKey: "blue-spell",
          manaCost: 2,
        },
      ],
    },
  ],
  enemies: [{ characterId: "little-green", stats: enemyStats, position: { q: 1, r: -2 } }],
  startingMana: { player: 0 },
};

// Spell cast with mana: sufficient mana → spellcast event fires with correct manaAfter.
const spellCastWithMana: ResolveRequest = {
  players: [
    {
      characterId: "blue",
      stats: { hp: 500, attack: 100, defense: 10, actionSpeed: 200, range: 1, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        {
          id: "fireball",
          power: 2,
          cooldown: 6,
          type: "attack",
          animationKey: "blue-spell",
          manaCost: 2,
        },
      ],
    },
  ],
  enemies: [
    {
      characterId: "little-green",
      stats: { hp: 100, attack: 1, defense: 0, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 1, r: -2 },
    },
  ],
  startingMana: { player: 5 },
};

// Heal-full: healer + damaged ally below threshold → heal spell casts, healAmount=100.
const healFull: ResolveRequest = {
  players: [
    {
      characterId: "healer",
      stats: { hp: 500, attack: 0, defense: 10, actionSpeed: 200, range: 1, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        {
          id: "restore",
          power: 0,
          cooldown: 3,
          type: "heal",
          animationKey: "heal-spell",
          manaCost: 1,
        },
      ],
      spellHpThreshold: 90,
    },
    {
      characterId: "ally",
      stats: { hp: 200, attack: 0, defense: 10, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 0, r: 2 },
      currentHp: 50,
      spellHpThreshold: 50,
    },
  ],
  enemies: [
    {
      characterId: "dummy",
      stats: { hp: 5000, attack: 1, defense: 10, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 1, r: -2 },
    },
  ],
  startingMana: { player: 5 },
};

// Heal-capped: ally missing only 5 HP → healAmount=5, targetHp=maxHp.
const healCapped: ResolveRequest = {
  players: [
    {
      characterId: "healer",
      stats: { hp: 500, attack: 0, defense: 10, actionSpeed: 200, range: 1, skills: [] },
      position: { q: -1, r: 2 },
      spells: [
        {
          id: "restore",
          power: 0,
          cooldown: 3,
          type: "heal",
          animationKey: "heal-spell",
          manaCost: 1,
        },
      ],
      spellHpThreshold: 90,
    },
    {
      characterId: "ally",
      stats: { hp: 200, attack: 0, defense: 10, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 0, r: 2 },
      currentHp: 150,
      spellHpThreshold: 50,
    },
  ],
  enemies: [
    {
      characterId: "dummy",
      stats: { hp: 5000, attack: 1, defense: 10, actionSpeed: 1, range: 1, skills: [] },
      position: { q: 1, r: -2 },
    },
  ],
  startingMana: { player: 5 },
};

// ---- Helpers ----

function run(label: string, req: ResolveRequest, extra?: { expectSpellAttacks?: number; expectSpellHealsAtLeast?: number; expectMinMana?: number; expectDeathMana?: boolean; }): void {
  const a = resolveBattle(req);
  const b = resolveBattle(req);
  const deterministic =
    a.result === b.result && JSON.stringify(a.events) === JSON.stringify(b.events);

  console.log(
    `${label}: result=${a.result} events=${a.events.length} ` +
      `units=${a.initialState.units.length} hexes=${a.initialState.hexes.length} ` +
      `deterministic=${deterministic}` +
      ` mana={${a.mana.initial.player},${a.mana.initial.enemy}}→{${a.mana.final.player},${a.mana.final.enemy}}`,
  );

  if (!deterministic) {
    console.error(`  !! NON-DETERMINISTIC: ${label}`);
    process.exitCode = 1;
  }

  if (extra) {
    // Count spellcast events by type
    const spellAttacks = a.events.filter(
      (e): e is typeof e & { kind: "spellcast"; spellType: "attack" } =>
        e.kind === "spellcast" && e.spellType === "attack",
    );
    const spellHeals = a.events.filter(
      (e): e is typeof e & { kind: "spellcast"; spellType: "heal" } =>
        e.kind === "spellcast" && e.spellType === "heal",
    );

    if (extra.expectSpellAttacks !== undefined) {
      const actual = spellAttacks.length;
      if (actual !== extra.expectSpellAttacks) {
        console.error(`  !! ${label}: expected ${extra.expectSpellAttacks} attack spellcasts, got ${actual}`);
        process.exitCode = 1;
      }
    }

    if (extra.expectSpellHealsAtLeast !== undefined) {
      const actual = spellHeals.length;
      if (actual < extra.expectSpellHealsAtLeast) {
        console.error(`  !! ${label}: expected at least ${extra.expectSpellHealsAtLeast} heal spellcasts, got ${actual}`);
        process.exitCode = 1;
      }
    }

    // Check manaAfter on first attack spellcast
    if (extra.expectMinMana !== undefined && spellAttacks.length > 0) {
      const first = spellAttacks[0];
      if (first.manaAfter < extra.expectMinMana) {
        console.error(`  !! ${label}: expected manaAfter >= ${extra.expectMinMana} on first attack spellcast, got ${first.manaAfter}`);
        process.exitCode = 1;
      }
    }

    // Check death manaAwarded exists
    if (extra.expectDeathMana) {
      const deaths = a.events.filter((e) => e.kind === "death");
      for (const d of deaths) {
        if (!("manaAwarded" in d)) {
          console.error(`  !! ${label}: death event missing manaAwarded`);
          process.exitCode = 1;
        } else {
          const ma = (d as any).manaAwarded as { team: string; delta: number; manaAfter: number };
          if (ma.delta <= 0) {
            console.error(`  !! ${label}: death manaAwarded.delta should be > 0, got ${ma.delta}`);
            process.exitCode = 1;
          }
        }
      }
    }

    // Check heal amount on first heal spellcast
    if (extra.expectSpellHealsAtLeast !== undefined && extra.expectSpellHealsAtLeast > 0 && spellHeals.length > 0) {
      const first = spellHeals[0];
      // For healFull: targetHp should be 150 (50 + 100 heal)
      if (label.includes("heal-full") && first.healAmount !== 100) {
        console.error(`  !! ${label}: expected healAmount=100, got ${first.healAmount}`);
        process.exitCode = 1;
      }
      if (label.includes("heal-full") && first.targetHp !== 150) {
        console.error(`  !! ${label}: expected targetHp=150, got ${first.targetHp}`);
        process.exitCode = 1;
      }
      // For healCapped: healAmount should be 50 (maxHp - currentHp = 200-150)
      if (label.includes("heal-capped") && first.healAmount !== 50) {
        console.error(`  !! ${label}: expected healAmount=50, got ${first.healAmount}`);
        process.exitCode = 1;
      }
      if (label.includes("heal-capped") && first.targetHp !== 200) {
        console.error(`  !! ${label}: expected targetHp=200, got ${first.targetHp}`);
        process.exitCode = 1;
      }
    }
  }
}

// ---- Run ----

run("1v1", oneVsOne);
run("3v3", threeVsThree);
run("same-row", sameRowMelee);
run("spell", withSpell, { expectSpellAttacks: 1 });

// Mana tests
run("mana-on-death", manaOnDeath, { expectDeathMana: true });
run("spell-blocked-no-mana", spellBlockedNoMana, { expectSpellAttacks: 0 });
run("spell-cast-with-mana", spellCastWithMana, { expectSpellAttacks: 1, expectMinMana: 3 });
run("heal-full", healFull, { expectSpellHealsAtLeast: 1 });
run("heal-capped", healCapped, { expectSpellHealsAtLeast: 1 });
