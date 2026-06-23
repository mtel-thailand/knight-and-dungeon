// lib/battle/types.ts
//
// Frozen shared contract for the /studio/mock-battle feature (Phase 0).
// Imported by the engine (lib/battle/engine.ts), the resolve route
// (app/api/battle/resolve/route.ts), the mock-battle client, and the CMS.
// Freeze this before building the lanes — every must-fix from the pre-build
// review is encoded here. Do not redefine these shapes elsewhere.

export type HexPosition = { q: number; r: number };

export type Team = "player" | "enemy";

// Per-character combat stats. Source of truth = character_battle_stats (SQLite),
// loaded as defaults into the party builder, editable, sent in the resolve payload.
export type UnitStats = {
  hp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  range: number;
  skills: string[]; // owned skill ids, e.g. ["shield_bash"]; [] = no skill
};

// A unit inside the simulation.
export type Unit = {
  id: string; // per-battle deterministic id (allocated in createBattle, NOT a module global)
  team: Team;
  characterId: string; // which roster character (knight | john | ...) — drives sprites/Actions
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  actionGauge: number;
  range: number;
  skills: string[]; // owned skill ids (optional per-character skill ownership)
  position: HexPosition;
  cooldowns: Record<string, number>;
  isDead: boolean;
};

export type Skill = {
  id: string;
  name: string;
  cooldown: number; // seconds
  range: number;
  damageMultiplier: number;
  pushDistance?: number;
};

export type Action =
  | { type: "wait"; sourceId: string }
  | { type: "move"; sourceId: string; targetPosition: HexPosition }
  | { type: "attack"; sourceId: string; targetId: string }
  | { type: "skill"; sourceId: string; skillId: string; targetId: string };

// "draw" added for symmetric-party timeout resolution (NOT auto-lose).
export type BattleStatus = "setup" | "running" | "win" | "lose" | "draw";

export type BattleState = {
  status: BattleStatus;
  units: Unit[];
  currentTime: number; // accumulated seconds
  events: BattleEvent[]; // emitted in resolution order (see note on `t`)
};

// Event log = the bridge to the replayer.
// NOTE: `t` is battle.currentTime at emission and advances PER TICK, so several
// events can share one `t` (e.g. an attack and the death it causes). The replayer
// MUST preserve EMITTED ORDER within equal `t` (do not sort by t alone).
export type BattleEvent =
  | { t: number; kind: "move"; unitId: string; from: HexPosition; to: HexPosition }
  | { t: number; kind: "attack"; sourceId: string; targetId: string; damage: number; targetHp: number }
  | {
      t: number;
      kind: "skill";
      skillId: string;
      sourceId: string;
      targetId: string;
      damage: number;
      targetHp: number;
      push?: { from: HexPosition; to: HexPosition };
    }
  | { t: number; kind: "death"; unitId: string }
  | { t: number; kind: "end"; result: "win" | "lose" | "draw" };

export type UnitSnapshot = {
  id: string;
  team: Team;
  characterId: string;
  position: HexPosition;
  hp: number;
  maxHp: number;
};

export type BattleSnapshot = {
  hexes: HexPosition[]; // VALID_HEXES, for board layout
  units: UnitSnapshot[]; // opening board (before any event)
};

// ---- Resolve API: client <-> POST /api/battle/resolve ----

export type PartyMemberInput = {
  characterId: string;
  stats: UnitStats; // builder-supplied (DB defaults, editable); route MUST clamp/validate
  position: HexPosition; // deploy hex
};

export type ResolveRequest = {
  players: PartyMemberInput[];
  enemies: PartyMemberInput[];
};

export type ResolveResult = {
  result: "win" | "lose" | "draw";
  initialState: BattleSnapshot;
  events: BattleEvent[];
};

// ---- CMS / management contract ----

// Battle event roles the replayer drives. Mapped per character to authored Action ids.
export type BattleEventRole = "idle" | "move" | "attack" | "hit" | "death";

// role -> Action id (the "manipulated animation"). Partial: missing roles use the fallback ladder.
export type CharacterRoleMap = Partial<Record<BattleEventRole, string>>;

// One character's full battle config (managed in the CMS, persisted in SQLite).
export type CharacterBattleConfig = {
  characterId: string;
  stats: UnitStats;
  roles: CharacterRoleMap;
};

// ---- Constants ----

// Validation bounds the resolve route enforces on payload stats (anti-hang / anti-cheat).
// actionSpeed in particular is a hang vector: `while (gauge >= 100)` with a huge value loops.
export const STAT_BOUNDS = {
  hp: { min: 1, max: 100000 },
  attack: { min: 0, max: 100000 },
  defense: { min: 0, max: 100000 },
  actionSpeed: { min: 1, max: 1000 },
  range: { min: 1, max: 20 },
} as const;

export const BOARD = {
  cols: 5,
  rows: 4,
  playerRow: 3,
  enemyRow: 0,
  maxPerSide: 5,
} as const;

export const MAX_BATTLE_TIME = 60; // seconds; timeout resolves by higher remaining HP, else draw
export const BATTLE_TICK = 0.25; // fixed timestep (deterministic)

// ---- Map config (board layout persistence) ----

// Mock-battle board layout, persisted as a single row (id=1) in battle_map_config.
// rotation = in-plane (Z) view angle; rotationX / rotationY = view tilt about the
// X / Y axes (all degrees); tileWidth = base tile size in px; tileHeightRatio =
// vertical iso squash; scale = overall board scale.
export type MapConfig = { tileWidth: number; tileHeightRatio: number; scale: number; rotation: number; rotationX: number; rotationY: number };
export const DEFAULT_MAP_CONFIG: MapConfig = { tileWidth: 72, tileHeightRatio: 0.5, scale: 1, rotation: 0, rotationX: 0, rotationY: 0 };
