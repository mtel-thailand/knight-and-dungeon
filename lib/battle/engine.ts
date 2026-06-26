// lib/battle/engine.ts
//
// Pure, deterministic party-vs-party hex auto-battle engine. Generalized from the
// single-Knight v3 spec (README_AFK_Hex_Battle_Knight_MVP_v3.md) to N-vs-N.
//
// PURITY CONTRACT (do not break): no React/Pixi/DB/`next` imports, and no `Date`
// or `Math.random`. The same ResolveRequest in => byte-identical events out.
// Determinism rests on: fixed BATTLE_TICK, array-order resolution, `-= 100` gauge
// carryover, per-battle ids (no module-global counter), and full lower-r/lower-q
// tie-breaks. All shapes are imported from the frozen contract; none redefined.

import type {
  Team,
  Unit,
  Skill,
  SpellInput,
  Action,
  BattleState,
  BattleSnapshot,
  ManaState,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
} from "./types";
import {
  BATTLE_TICK,
  DEFAULT_ATTACK_TYPE,
  SPAWN_INTERVAL,
  TANK_MANA_MAX,
  DEFAULT_SPELL_HP_THRESHOLD,
} from "./types";
import {
  VALID_HEXES,
  hexDistance,
  isValidHex,
  isOccupied,
  getNextHexToward,
  tryPushUnit,
  findEnemySpawnHex,
} from "./hex";

// ---- Constants ----

// How much HP a heal spell restores (NOT scaled by spell.power).
const HEAL_SPELL_AMOUNT = 100;

// ---- Helpers ----

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function finiteClamp(v: unknown, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? clampInt(v, min, max)
    : 0;
}

// ---- Skill registry ----
// Single source so executeAction can resolve a skill by id (v3 B2 fix).

export const SHIELD_BASH: Skill = {
  id: "shield_bash",
  name: "Shield Bash",
  cooldown: 5,
  range: 1,
  damageMultiplier: 1.5,
  pushDistance: 1,
};

export const SKILLS: Record<string, Skill> = {
  shield_bash: SHIELD_BASH,
};

// ---- Construction ----

// Build the battle from pre-made player/enemy unit arrays. IDs are allocated HERE,
// per battle (`${team}-${characterId}-${index}`) — never from a module global — so
// re-resolving the same request yields identical ids and events. Units are
// concatenated player-first (mutation order: players resolve before enemies).
export function createBattle(
  players: Unit[],
  enemies: Unit[],
  spawnCount: number = 0,
  startingMana?: Partial<ManaState>,
): BattleState {
  const assign = (units: Unit[], team: Team): Unit[] =>
    units.map((u, i) => ({ ...u, team, id: `${team}-${u.characterId}-${i}` }));

  return {
    status: "setup",
    units: [...assign(players, "player"), ...assign(enemies, "enemy")],
    currentTime: 0,
    events: [],
    spawnsRemaining: spawnCount,
    nextSpawnAt: spawnCount > 0 ? SPAWN_INTERVAL : Infinity,
    mana: {
      player: finiteClamp(startingMana?.player, 0, TANK_MANA_MAX),
      enemy: finiteClamp(startingMana?.enemy, 0, TANK_MANA_MAX),
    },
  };
}

// ---- Helpers ----

// Absent cooldown key = ready (units start with cooldowns: {}).
export function isSkillReady(unit: Unit, skillId: string): boolean {
  const cd = unit.cooldowns[skillId];
  return cd === undefined || cd <= 0;
}

// Decrement every cooldown by real elapsed seconds (B1's other half: the cooldown
// is *set* in executeAction on use).
function updateCooldowns(unit: Unit, dt: number): void {
  for (const skillId of Object.keys(unit.cooldowns)) {
    unit.cooldowns[skillId] = Math.max(0, unit.cooldowns[skillId] - dt);
  }
}

function getUnitById(battle: BattleState, id: string): Unit | undefined {
  return battle.units.find((u) => u.id === id);
}

// Target priority (used by BOTH teams): nearest -> lowest HP -> lower r -> lower q.
// Filters dead and same-team. Returns null when no living enemy remains. Sorts a
// filtered copy, so battle.units order is never disturbed.
export function selectTarget(unit: Unit, battle: BattleState): Unit | null {
  const enemies = battle.units.filter((u) => !u.isDead && u.team !== unit.team);
  if (enemies.length === 0) return null;

  return enemies.sort((a, b) => {
    const da = hexDistance(unit.position, a.position);
    const db = hexDistance(unit.position, b.position);
    if (da !== db) return da - db;
    if (a.hp !== b.hp) return a.hp - b.hp;
    if (a.position.r !== b.position.r) return a.position.r - b.position.r;
    return a.position.q - b.position.q;
  })[0];
}

// Melee units cannot engage a target sharing their row (r); ranged is unrestricted.
// (attackType is orthogonal to `range`.)
function canEngage(unit: Unit, target: Unit): boolean {
  return unit.attackType !== "melee" || target.position.r !== unit.position.r;
}

// selectTarget's priority restricted to targets this unit is ALLOWED to attack
// (the melee same-row rule). Used for the skill/attack decision; movement falls
// back to selectTarget so a melee unit keeps closing on the nearest enemy (and
// repositions) when only same-row enemies are reachable, rather than freezing.
function selectEngageTarget(unit: Unit, battle: BattleState): Unit | null {
  const enemies = battle.units.filter(
    (u) => !u.isDead && u.team !== unit.team && canEngage(unit, u),
  );
  if (enemies.length === 0) return null;

  return enemies.sort((a, b) => {
    const da = hexDistance(unit.position, a.position);
    const db = hexDistance(unit.position, b.position);
    if (da !== db) return da - db;
    if (a.hp !== b.hp) return a.hp - b.hp;
    if (a.position.r !== b.position.r) return a.position.r - b.position.r;
    return a.position.q - b.position.q;
  })[0];
}

// First owned skill (in skills[] order) that is registered, ready, and in range.
// Only `shield_bash` is registered for the MVP, so this reduces exactly to:
// fire iff unit.skills.includes("shield_bash") && isSkillReady && distance <= range.
// (Generalized here so adding skills to SKILLS needs no decision-logic change.)
function pickUsableSkill(unit: Unit, distance: number): Skill | null {
  for (const skillId of unit.skills) {
    const skill = SKILLS[skillId];
    if (!skill) continue;
    if (isSkillReady(unit, skillId) && distance <= skill.range) return skill;
  }
  return null;
}

// A spell is ready when its `spell:`-namespaced cooldown is clear (absent = ready).
// Namespacing avoids collisions with skill ids in the shared unit.cooldowns map.
function isSpellReady(unit: Unit, spellId: string): boolean {
  const cd = unit.cooldowns[`spell:${spellId}`];
  return cd === undefined || cd <= 0;
}

// Pick a heal target for a caster: living same-team units whose HP% is below the
// caster's spellHpThreshold. Returns lowest-HP target; tie-break by iteration
// order (deterministic: the unit array is stable per resolve).
function pickHealTarget(caster: Unit, battle: BattleState): Unit | null {
  const threshold = caster.spellHpThreshold; // 0..100
  const candidates = battle.units.filter(
    (u) =>
      !u.isDead &&
      u.team === caster.team &&
      u.hp * 100 < threshold * u.maxHp,
  );
  if (candidates.length === 0) return null;
  // Lowest HP wins; ties keep first-in-iteration-order (no stable-sort assumption).
  let best = candidates[0];
  for (const u of candidates) if (u.hp < best.hp) best = u;
  return best;
}

// First owned spell (payload order = deterministic) that is ready, has enough
// mana, and has a valid target. Attack spells pick via selectTarget; heal spells
// pick via pickHealTarget. Returns {spell, target} or null.
function pickUsableSpell(
  unit: Unit,
  battle: BattleState,
): { spell: SpellInput; target: Unit } | null {
  for (const sp of unit.spells) {
    if (!isSpellReady(unit, sp.id)) continue;
    if (sp.manaCost > battle.mana[unit.team]) continue;

    if (sp.type === "attack") {
      const target = selectTarget(unit, battle);
      if (target) return { spell: sp, target };
    } else if (sp.type === "heal") {
      const target = pickHealTarget(unit, battle);
      if (target) return { spell: sp, target };
    }
  }
  return null;
}

// ---- Decision logic (one function for both teams) ----

// Priority: usable skill (Shield Bash) -> basic attack in range -> step toward target.
export function decideUnitAction(unit: Unit, battle: BattleState): Action {
  // Nearest living enemy drives every branch (movement goal + spell/attack pick).
  const nearest = selectTarget(unit, battle);
  if (!nearest) return { type: "wait", sourceId: unit.id };

  // 1) SPELL (magic): cooldown + mana gated, ANY range/row — picks its own target.
  const spellResult = pickUsableSpell(unit, battle);
  if (spellResult) {
    return {
      type: "spell",
      spellId: spellResult.spell.id,
      sourceId: unit.id,
      targetId: spellResult.target.id,
    };
  }

  // 2-4) Melee same-row rule: only engage (skill/attack) a DIFFERENT-row target; else
  // move toward the nearest enemy. (No spells + this block == the prior behavior, so a
  // spell-less request stays byte-identical: engageTarget ?? nearest === the old target.)
  const engageTarget = selectEngageTarget(unit, battle);
  const target = engageTarget ?? nearest;
  const distance = hexDistance(unit.position, target.position);

  if (engageTarget) {
    const skill = pickUsableSkill(unit, distance);
    if (skill) {
      return {
        type: "skill",
        skillId: skill.id,
        sourceId: unit.id,
        targetId: engageTarget.id,
      };
    }
    if (distance <= unit.range) {
      return { type: "attack", sourceId: unit.id, targetId: engageTarget.id };
    }
  }

  return {
    type: "move",
    sourceId: unit.id,
    targetPosition: getNextHexToward(unit.position, target.position, battle.units),
  };
}

// ---- Action execution ----

// `damage` is always a pre-floored integer (see executeAction), so for integer-hp
// inputs hp stays integer and the emitted targetHp is an integer too.
function applyDamage(target: Unit, damage: number): void {
  target.hp = Math.max(0, target.hp - damage); // clamp; checkDeaths flips isDead
}

// Re-validates source/target liveness (stale-target guards), applies damage,
// pushes on skill, and SETS the skill cooldown on use (v3 B1 — without the set,
// isSkillReady is always true and a unit skills every action). Emits one event per
// visible change at t = battle.currentTime.
export function executeAction(action: Action, battle: BattleState): void {
  const source = getUnitById(battle, action.sourceId);
  if (!source || source.isDead) return;
  const t = battle.currentTime;

  switch (action.type) {
    case "wait":
      return;

    case "move": {
      const dest = action.targetPosition;
      if (dest.q === source.position.q && dest.r === source.position.r) return; // blocked/stay
      if (!isValidHex(dest)) return;
      if (isOccupied(dest, battle.units)) return;
      const from = { q: source.position.q, r: source.position.r };
      source.position = { q: dest.q, r: dest.r };
      battle.events.push({
        t,
        kind: "move",
        unitId: source.id,
        from,
        to: { q: dest.q, r: dest.r },
      });
      return;
    }

    case "attack": {
      const target = getUnitById(battle, action.targetId);
      if (!target || target.isDead) return; // stale-target guard
      const damage = Math.max(1, Math.floor(source.attack - target.defense)); // integer damage
      applyDamage(target, damage);
      battle.events.push({
        t,
        kind: "attack",
        sourceId: source.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
      });
      return;
    }

    case "skill": {
      const target = getUnitById(battle, action.targetId);
      if (!target || target.isDead) return; // stale-target guard
      const skill = SKILLS[action.skillId];
      if (!skill) return;

      const damage = Math.max(1, Math.floor(source.attack * skill.damageMultiplier - target.defense)); // integer (floors the x1.5)
      applyDamage(target, damage);

      const pushFrom = { q: target.position.q, r: target.position.r };
      if (skill.pushDistance && skill.pushDistance > 0) {
        tryPushUnit(source, target, battle.units);
      }
      const pushed =
        target.position.q !== pushFrom.q || target.position.r !== pushFrom.r;

      source.cooldowns[skill.id] = skill.cooldown; // B1: set cooldown on use

      battle.events.push({
        t,
        kind: "skill",
        skillId: skill.id,
        sourceId: source.id,
        targetId: target.id,
        damage,
        targetHp: target.hp,
        push: pushed
          ? { from: pushFrom, to: { q: target.position.q, r: target.position.r } }
          : undefined,
      });
      return;
    }

    case "spell": {
      const target = getUnitById(battle, action.targetId);
      if (!target || target.isDead) return; // stale-target guard
      const spell = source.spells.find((s) => s.id === action.spellId);
      if (!spell) return; // unknown spell id (defensive)

      if (spell.type === "attack") {
        // Defensive mana check: insufficient mana = no-op, no cooldown, no event.
        if (battle.mana[source.team] < spell.manaCost) return;
        battle.mana[source.team] -= spell.manaCost;

        // MAGIC: caster.attack * power, IGNORES defense; integer, min 1.
        const damage = Math.max(1, Math.floor(source.attack * spell.power));
        applyDamage(target, damage);
        source.cooldowns[`spell:${spell.id}`] = spell.cooldown;

        battle.events.push({
          t,
          kind: "spellcast",
          spellType: "attack",
          sourceId: source.id,
          targetId: target.id,
          spellId: spell.id,
          from: { q: source.position.q, r: source.position.r },
          to: { q: target.position.q, r: target.position.r },
          damage,
          targetHp: target.hp,
          manaTeam: source.team,
          manaCost: spell.manaCost,
          manaAfter: battle.mana[source.team],
        });
      } else if (spell.type === "heal") {
        // Defensive re-check: target same team, alive, still below threshold.
        if (target.team !== source.team || target.isDead) return;
        const threshold = source.spellHpThreshold;
        if (!(target.hp * 100 < threshold * target.maxHp)) return;
        if (battle.mana[source.team] < spell.manaCost) return;
        battle.mana[source.team] -= spell.manaCost;

        const heal = Math.min(HEAL_SPELL_AMOUNT, target.maxHp - target.hp);
        target.hp += heal;
        source.cooldowns[`spell:${spell.id}`] = spell.cooldown;

        battle.events.push({
          t,
          kind: "spellcast",
          spellType: "heal",
          sourceId: source.id,
          targetId: target.id,
          spellId: spell.id,
          from: { q: source.position.q, r: source.position.r },
          to: { q: target.position.q, r: target.position.r },
          healAmount: heal,
          targetHp: target.hp,
          manaTeam: source.team,
          manaCost: spell.manaCost,
          manaAfter: battle.mana[source.team],
        });
      }
      return;
    }
  }
}

// ---- Death & end resolution ----

// Mark every unit at <= 0 HP dead immediately (so it is skipped for the rest of the
// tick) and emit a death event. Runs after every action.
// `killedBy` is the source unit that dealt the killing blow (tracked for EXP).
export function checkDeaths(battle: BattleState, killedBy?: string): void {
  for (const unit of battle.units) {
    if (!unit.isDead && unit.hp <= 0) {
      unit.hp = 0;
      unit.isDead = true;

      // Mana accrual: +1 to opposing team, capped at TANK_MANA_MAX.
      const awardTeam: Team = unit.team === "player" ? "enemy" : "player";
      const before = battle.mana[awardTeam];
      const after = Math.min(TANK_MANA_MAX, before + 1);
      const delta = after - before;
      battle.mana[awardTeam] = after;

      battle.events.push({
        t: battle.currentTime,
        kind: "death",
        unitId: unit.id,
        killedBy,
        manaAwarded: { team: awardTeam, delta, manaAfter: after },
      });
    }
  }
}

// Sum of current HP for a team (dead units contribute 0).
function teamHp(battle: BattleState, team: Team): number {
  let sum = 0;
  for (const u of battle.units) if (u.team === team) sum += u.hp;
  return sum;
}

// Win = all enemies dead; lose = all players dead; mutual death = LOSE (players are
// checked first). No timeout — battle runs until one side is fully eliminated.
// Guarded so the terminal status and the `end` event are produced exactly once.
export function checkBattleEnd(battle: BattleState): void {
  if (battle.status !== "running") return;

  const playersAlive = battle.units.some((u) => u.team === "player" && !u.isDead);
  const enemiesAlive = battle.units.some((u) => u.team === "enemy" && !u.isDead);

  let result: "win" | "lose" | "draw" | null = null;
  if (!playersAlive) result = "lose"; // lose-first on mutual death
  else if (!enemiesAlive) result = "win";

  if (result) {
    battle.status = result;
    battle.events.push({ t: battle.currentTime, kind: "end", result });
  }
}

// ---- EXP computation ----

// Compute EXP gains from battle events: each kill awards EXP to the killer.
// Formula: EXP = defeated unit's maxHp (simple — will be refined).
// Extracted as a dedicated function so the formula is easy to update.
export function computeExpGains(battle: BattleState): Record<string, number> {
  const unitMaxHp = new Map<string, number>();
  for (const u of battle.units) unitMaxHp.set(u.id, u.maxHp);
  const expGains: Record<string, number> = {};
  for (const ev of battle.events) {
    if (ev.kind === "death" && ev.killedBy) {
      const exp = unitMaxHp.get(ev.unitId) ?? 0;
      expGains[ev.killedBy] = (expGains[ev.killedBy] ?? 0) + exp;
    }
  }
  return expGains;
}

// ---- Mid-fight spawn ----

// Pick a character id for a spawned enemy: cycle through existing enemy
// characterIds in deterministic (first-seen) order.
function pickSpawnCharacterId(battle: BattleState): string {
  const seen: string[] = [];
  const added = new Set<string>();
  for (const u of battle.units) {
    if (u.team === "enemy" && !added.has(u.characterId)) {
      added.add(u.characterId);
      seen.push(u.characterId);
    }
  }
  // Cycle through existing enemy types deterministically
  return seen[((battle.events.filter((e) => e.kind === "spawn").length) + 1) % seen.length] ?? seen[0] ?? "enemy";
}

// Spawn one enemy unit mid-fight. Finds an unoccupied hex, creates the unit,
// emits a spawn event. Returns true if a spawn happened.
function spawnEnemy(battle: BattleState): boolean {
  if (battle.spawnsRemaining <= 0) return false;

  // Check board cap: max 5 enemies at a time
  const enemiesAlive = battle.units.filter((u) => u.team === "enemy" && !u.isDead).length;
  if (enemiesAlive >= 5) return false;

  const hex = findEnemySpawnHex(battle.units);
  if (!hex) return false; // board full

  // Pick a template from existing enemies
  const charId = pickSpawnCharacterId(battle);
  const template = battle.units.find((u) => u.team === "enemy" && u.characterId === charId);
  if (!template) return false;

  // Create the new unit
  const spawnIndex = battle.units.filter((u) => u.team === "enemy").length;
  const newUnit: Unit = {
    id: `enemy-${charId}-${spawnIndex}`,
    team: "enemy",
    characterId: charId,
    hp: template.maxHp,
    maxHp: template.maxHp,
    attack: template.attack,
    defense: template.defense,
    actionSpeed: template.actionSpeed,
    actionGauge: 0,
    range: template.range,
    attackType: template.attackType,
    spells: template.spells.map((s) => ({ ...s })),
    skills: [...template.skills],
    position: { q: hex.q, r: hex.r },
    cooldowns: {},
    isDead: false,
    spellHpThreshold: template.spellHpThreshold,
  };

  battle.units.push(newUnit);
  battle.spawnsRemaining--;

  battle.events.push({
    t: battle.currentTime,
    kind: "spawn",
    unitId: newUnit.id,
    characterId: charId,
    team: "enemy",
    position: { q: hex.q, r: hex.r },
    hp: newUnit.hp,
    maxHp: newUnit.maxHp,
  });

  if (battle.spawnsRemaining <= 0) {
    battle.nextSpawnAt = Infinity;
  } else {
    battle.nextSpawnAt = battle.currentTime + SPAWN_INTERVAL;
  }

  return true;
}

// ---- Battle loop ----

// Advance the battle by `dt` seconds. Each living unit decays cooldowns, fills its
// action gauge, and spends every full 100 (overflow-preserving `-= 100`, not reset)
// on one decide+execute. Deaths/end are checked after each action and again at tick
// end (to catch the timeout on ticks where no unit acted).
export function updateBattle(battle: BattleState, dt: number): void {
  if (battle.status !== "running") return;

  battle.currentTime += dt;

  for (const unit of battle.units) {
    if (unit.isDead) continue;

    updateCooldowns(unit, dt);
    unit.actionGauge += unit.actionSpeed * dt;

    while (unit.actionGauge >= 100 && !unit.isDead) {
      const action = decideUnitAction(unit, battle);
      executeAction(action, battle);
      unit.actionGauge -= 100; // carryover, not reset

      checkDeaths(battle, action.sourceId);
      checkBattleEnd(battle);
      if (battle.status !== "running") return;
    }
  }

  // Mid-fight spawn check: spawn enemies on a timer
  if (battle.spawnsRemaining > 0 && battle.currentTime >= battle.nextSpawnAt) {
    spawnEnemy(battle);
  }

  checkBattleEnd(battle); // timeout guard on idle ticks
}

// ---- Server entry ----

// Build a fresh Unit from a builder-supplied member: hp = maxHp, gauge empty, no
// cooldowns, alive. id/team are (re)assigned authoritatively in createBattle; the
// values set here only satisfy the Unit shape.
function buildUnit(input: PartyMemberInput, team: Team): Unit {
  const s = input.stats;
  return {
    id: "",
    team,
    characterId: input.characterId,
    hp: input.currentHp === undefined ? s.hp : Math.max(1, Math.min(s.hp, input.currentHp)),
    maxHp: s.hp, // never shrink maxHp — HP bars + 0-death checks compare against full hp
    attack: s.attack,
    defense: s.defense,
    actionSpeed: s.actionSpeed,
    actionGauge: 0,
    range: s.range,
    attackType: s.attackType ?? DEFAULT_ATTACK_TYPE,
    spells: [...(input.spells ?? [])],
    skills: [...s.skills],
    position: { q: input.position.q, r: input.position.r },
    cooldowns: {},
    isDead: false,
    spellHpThreshold:
      typeof input.spellHpThreshold === "number" &&
      Number.isFinite(input.spellHpThreshold)
        ? clampInt(input.spellHpThreshold, 0, 100)
        : DEFAULT_SPELL_HP_THRESHOLD,
  };
}

function snapshotInitial(battle: BattleState): BattleSnapshot {
  return {
    hexes: VALID_HEXES.map((h) => ({ q: h.q, r: h.r })),
    units: battle.units.map((u) => ({
      id: u.id,
      team: u.team,
      characterId: u.characterId,
      position: { q: u.position.q, r: u.position.r },
      hp: u.hp,
      maxHp: u.maxHp,
    })),
  };
}

// Resolve an entire battle deterministically and return the replay payload. The
// caller (the resolve route) is responsible for validating/clamping stats and
// canonicalizing unit order; this function assumes a well-formed request.
export function resolveBattle(req: ResolveRequest): ResolveResult {
  const players = req.players.map((p) => buildUnit(p, "player"));
  const enemies = req.enemies.map((e) => buildUnit(e, "enemy"));

  // Normalize starting mana (default 0 per side).
  const manaInitial: ManaState = {
    player: finiteClamp(req.startingMana?.player, 0, TANK_MANA_MAX),
    enemy: finiteClamp(req.startingMana?.enemy, 0, TANK_MANA_MAX),
  };

  const battle = createBattle(players, enemies, req.spawnCount ?? 0, manaInitial);

  // Capture the opening board BEFORE any event is emitted, then run.
  const initialState = snapshotInitial(battle);
  battle.status = "running";

  while (battle.status === "running") {
    updateBattle(battle, BATTLE_TICK); // runs until one side is eliminated
  }

  // Closing board AFTER the sim (same shape as initialState) — lets the campaign
  // runner carry survivor HP across waves. snapshotInitial is a pure read of
  // battle.units; it emits no events and allocates no ids, so it cannot perturb
  // determinism (a field-absent request still produces byte-identical events).
  const finalState = snapshotInitial(battle);

  const expGains = computeExpGains(battle);
  return {
    result: battle.status as "win" | "lose" | "draw",
    initialState,
    finalState,
    events: battle.events,
    expGains: Object.keys(expGains).length > 0 ? expGains : undefined,
    mana: {
      initial: manaInitial,
      final: { player: battle.mana.player, enemy: battle.mana.enemy },
    },
  };
}
