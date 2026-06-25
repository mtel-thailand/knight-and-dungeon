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
// Attack type gates targeting: a "melee" unit cannot attack a target sharing its
// row (r); "ranged" has no such restriction. Orthogonal to `range`. Optional on
// input — omitted/invalid defaults to melee (see DEFAULT_ATTACK_TYPE in buildUnit).
export type AttackType = "melee" | "ranged";
export const ATTACK_TYPES: readonly AttackType[] = ["melee", "ranged"] as const;
export const DEFAULT_ATTACK_TYPE: AttackType = "melee";

// ---- Spells (CMS-managed top-level entities; MAGIC attacks) ----
// A Spell is a top-level configurable entity (like a character): an assigned
// animation (a catalog key = the projectile art), a type (only "attack" now), a
// power (damage = floor(caster.attack * power), IGNORES defense), and a cooldown
// (seconds). Characters own a list of spell ids; magic fires any-position →
// any-position (no range/row restriction).
export type SpellType = "attack";
export const SPELL_TYPES: readonly SpellType[] = ["attack"] as const;
export const DEFAULT_SPELL_TYPE: SpellType = "attack";

// CMS entity, persisted in `spells`, surfaced in GET /api/config as `spells`.
export type SpellTransition = "fade" | "none";
export const SPELL_TRANSITIONS = ["fade", "none"] as const;
export const DEFAULT_SPELL_TRANSITION: SpellTransition = "fade";

export type SpellDef = {
  id: string;
  name: string;
  animationKey: string; // an `animations` catalog key (projectile art)
  type: SpellType;
  power: number; // damage multiplier on caster.attack
  cooldown: number; // seconds
  // Visual-only playback config — used by the replay projectile + the editor
  // preview, NOT by the engine (so it never reaches SpellInput / the resolve payload).
  fps?: number; // projectile animation frames/sec (default DEFAULT_SPELL_FPS)
  scaleX?: number; // projectile width multiplier (default 1)
  scaleY?: number; // projectile height multiplier (default 1)
  loop?: boolean; // loop the animation during flight (default true)
  duration?: number; // projectile FLIGHT time, seconds (default DEFAULT_SPELL_DURATION)
  offsetX?: number; // projectile render X offset, px (-200..200)
  offsetY?: number; // projectile render Y offset, px (-200..200)
  rotation?: number; // orientation offset added to the aim, degrees
  transitionIn?: SpellTransition; // projectile fade-in style (default "fade")
  transitionOut?: SpellTransition; // projectile fade-out style (default "fade")
};

// What travels to the PURE engine per member (the engine can't read the DB).
export type SpellInput = {
  id: string;
  power: number;
  cooldown: number;
  type: SpellType;
  animationKey: string;
};

export const SPELL_BOUNDS = {
  power: { min: 0, max: 100 },
  cooldown: { min: 0, max: 600 },
  fps: { min: 1, max: 60 },
  scaleX: { min: -10, max: 10 },
  scaleY: { min: -10, max: 10 },
  duration: { min: 0.05, max: 5 },
  offsetX: { min: -200, max: 200 },
  offsetY: { min: -200, max: 200 },
  rotation: { min: -360, max: 360 },
} as const;
export const MAX_SPELLS_PER_UNIT = 8;
export const DEFAULT_SPELL_FPS = 12; // projectile playback fps when a spell has no `fps`
export const DEFAULT_SPELL_DURATION = 0.36; // projectile flight seconds (matches SPELL_FLIGHT_MS)
export const SPELL_FADE_MS = 140; // projectile transition-in/out alpha fade duration (ms), clamped to ≤ half of flight time

// ---- Campaigns (CMS-managed; the /camp consecutive-wave runner config) ----
// CMS entity, persisted in `campaigns`, surfaced in GET /api/config as `campaigns`.
// Sim-inert: a campaign NEVER enters the engine or the resolve payload — it only
// configures how the (future) /camp screen spawns successive waves. Exactly one
// campaign may be active at a time (enforced by a partial unique index in db.ts:
// `CREATE UNIQUE INDEX ... ON campaigns(is_active) WHERE is_active = 1`).
export type CampaignDef = {
  id: string;
  name: string;
  waveCount: number; // number of consecutive waves (>= 1)
  monsterPool: string[]; // character ids enemies are spawned from across the waves
  isActive: boolean; // exactly one campaign is active at a time
};

export const CAMPAIGN_BOUNDS = {
  waveCount: { min: 1, max: 50 },
} as const;

// ---- Battle rewards (campaign wave-reward system) ----

// The effect type determines how a reward modifies the player party mid-run.
// "atkPercent"  — multiply stats.attack by (1 + value/100), floor/round
// "restoreHp"   — add value to currentHp, capped by max hp; if no currentHp, treat as stats.hp
// "defFlat"     — add value to stats.defense
export type BattleRewardEffect = "atkPercent" | "restoreHp" | "defFlat";
export const BATTLE_REWARD_EFFECTS: readonly BattleRewardEffect[] = [
  "atkPercent",
  "restoreHp",
  "defFlat",
] as const;
export type BattleRewardRarity = "common" | "uncommon" | "rare";
export const BATTLE_REWARD_RARITIES: readonly BattleRewardRarity[] = [
  "common",
  "uncommon",
  "rare",
] as const;

/** CMS entity, persisted in `battle_rewards`, surfaced in GET /api/config as `battleRewards`. */
export type BattleRewardDef = {
  id: string;
  name: string;
  description: string; // short flavour text shown on the reward card
  rarity: BattleRewardRarity;
  effect: BattleRewardEffect;
  effectValue: number; // meaning depends on effect type (percent points, flat HP, flat DEF)
};

export const BATTLE_REWARD_BOUNDS = {
  effectValue: { min: 1, max: 10000 },
} as const;

export const DEFAULT_BATTLE_REWARDS: BattleRewardDef[] = [
  { id: "heal-50", name: "Heal I", description: "Restore 50 HP", rarity: "common", effect: "restoreHp", effectValue: 50 },
  { id: "heal-100", name: "Heal II", description: "Restore 100 HP", rarity: "uncommon", effect: "restoreHp", effectValue: 100 },
  { id: "heal-200", name: "Heal III", description: "Restore 200 HP", rarity: "rare", effect: "restoreHp", effectValue: 200 },
  { id: "atk-10", name: "Power I", description: "ATK plus 10%", rarity: "common", effect: "atkPercent", effectValue: 10 },
  { id: "atk-20", name: "Power II", description: "ATK plus 20%", rarity: "uncommon", effect: "atkPercent", effectValue: 20 },
  { id: "atk-30", name: "Power III", description: "ATK plus 30%", rarity: "rare", effect: "atkPercent", effectValue: 30 },
  { id: "def-1", name: "Fortify I", description: "Def plus 1", rarity: "common", effect: "defFlat", effectValue: 1 },
  { id: "def-3", name: "Fortify II", description: "Def plus 3", rarity: "uncommon", effect: "defFlat", effectValue: 3 },
  { id: "def-5", name: "Fortify III", description: "Def plus 5", rarity: "rare", effect: "defFlat", effectValue: 5 },
];

export type UnitStats = {
  hp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  range: number;
  attackType?: AttackType; // default "melee"; melee cannot attack a same-row target
  skills: string[]; // owned skill ids, e.g. ["shield_bash"]; [] = no skill
};

// A unit inside the simulation.
export type Unit = {
  id: string; // per-battle deterministic id (allocated in createBattle, NOT a module global)
  team: Team;
  characterId: string; // which roster character (blue | little-green | big-green) — drives sprites/Actions
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  actionGauge: number;
  range: number;
  attackType: AttackType; // resolved (defaulted) in buildUnit; never undefined here
  spells: SpellInput[]; // resolved (defaulted []) in buildUnit; per-unit spell configs
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
  | { type: "skill"; sourceId: string; skillId: string; targetId: string }
  | { type: "spell"; sourceId: string; spellId: string; targetId: string };

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
  | {
      t: number;
      kind: "spellcast";
      sourceId: string;
      targetId: string;
      spellId: string;
      from: HexPosition; // caster hex (projectile start)
      to: HexPosition; // target hex (projectile end)
      damage: number;
      targetHp: number;
    }
  | { t: number; kind: "death"; unitId: string; killedBy?: string }
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
  spells?: SpellInput[]; // owned spell configs (optional; default []); route clamps/validates
  currentHp?: number; // optional starting-HP override (campaign wave carryover), clamped [1,stats.hp]; ABSENT ⇒ buildUnit defaults to stats.hp (byte-identical to pre-campaign requests)
};

export type ResolveRequest = {
  players: PartyMemberInput[];
  enemies: PartyMemberInput[];
};

export type ResolveResult = {
  result: "win" | "lose" | "draw";
  initialState: BattleSnapshot;
  finalState?: BattleSnapshot; // closing board after the sim (survivor HP for campaign wave carryover); resolveBattle always emits it, the client mock-resolve path may omit it
  events: BattleEvent[];
  expGains?: Record<string, number>; // unitId → EXP gained from kills (killed enemy's maxHp)
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

// [5,6,7,6,5] hexagon arena in centered axial coords (r in {-2..2}, q centered
// per row) — the same shape the studio preview renders. Outer rows hold the
// deploy zones: enemyRow = -2 (top, 5 cells), playerRow = +2 (bottom, 5 cells).
// maxPerSide must stay <= min(rowCounts[0], rowCounts[last]).
export const BOARD = {
  rowCounts: [5, 6, 7, 6, 5],
  rows: 5,
  playerRow: 2,
  enemyRow: -2,
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

// ---- Display config (damage-number + health-bar persistence) ----

// mock-battle Display panel: damage-number AND health-bar render settings,
// persisted as a single row (id=1) in damage_config — stored as a JSON blob
// (NOT columns), so new knobs need no migration. size/offset/height/rise are
// multipliers of the live tile size; stroke is px; durationMs is the float
// lifetime. barWidth is × tile width; barHeight / barGap are px.
export type DamageConfig = {
  sizeNormal: number; // attack number font size            (× tile size)
  sizeSkill: number; // skill number font size              (× tile size)
  height: number; // gap above the unit's head              (× tile size)
  offsetX: number; // horizontal nudge, + = toward facing   (× tile size)
  offsetY: number; // vertical nudge, + = up                (× tile size)
  rise: number; // float-up distance                        (× tile size)
  stroke: number; // outline width (px)
  durationMs: number; // float lifetime (ms)
  barWidth: number; // HP bar width                         (× tile width)
  barHeight: number; // HP bar height (px)
  barGap: number; // HP bar gap above the unit's head (px)
};
export const DEFAULT_DAMAGE_CONFIG: DamageConfig = {
  sizeNormal: 0.27,
  sizeSkill: 0.34,
  height: 0.2,
  offsetX: 0,
  offsetY: 0,
  rise: 0.45,
  stroke: 4,
  durationMs: 520,
  barWidth: 0.95,
  barHeight: 6,
  barGap: 12,
};
// [min, max] clamp bounds (mirror the panel sliders) — used by the writer route.
export const DAMAGE_BOUNDS: Record<keyof DamageConfig, [number, number]> = {
  sizeNormal: [0.1, 0.8],
  sizeSkill: [0.1, 0.9],
  height: [0, 1],
  offsetX: [-1, 1],
  offsetY: [-1, 1],
  rise: [0, 1.2],
  stroke: [0, 12],
  durationMs: [200, 1500],
  barWidth: [0.2, 2],
  barHeight: [2, 20],
  barGap: [-40, 60],
};

// ---- Spell-text config (spell-name "shout" persistence) ----

// mock-battle Display panel: the floating spell-name callout ("shout") shown
// above a caster when it casts a spell. Persisted as a single row (id=1) in
// spell_text_config — a JSON blob (NOT columns), so new knobs need no migration.
// size/height/offset/rise are multipliers of the live tile size; stroke is px;
// durationMs is the float lifetime. Defaults preserve the original shout look.
export type SpellTextConfig = {
  size: number; // spell-name font size           (× tile size)
  height: number; // gap above the caster's head   (× tile size)
  offsetX: number; // horizontal nudge             (× tile size)
  offsetY: number; // vertical nudge, + = up        (× tile size)
  rise: number; // float-up distance               (× tile size)
  stroke: number; // outline width (px)
  durationMs: number; // float lifetime (ms)
};
export const DEFAULT_SPELL_TEXT_CONFIG: SpellTextConfig = {
  size: 0.32,
  height: 0.2,
  offsetX: 0,
  offsetY: 0,
  rise: 0.9,
  stroke: 5,
  durationMs: 1100,
};
// [min, max] clamp bounds (mirror the panel sliders) — used by the writer route.
export const SPELL_TEXT_BOUNDS: Record<keyof SpellTextConfig, [number, number]> = {
  size: [0.1, 0.9],
  height: [0, 1],
  offsetX: [-1, 1],
  offsetY: [-1, 1],
  rise: [0, 1.5],
  stroke: [0, 12],
  durationMs: [300, 2500],
};
