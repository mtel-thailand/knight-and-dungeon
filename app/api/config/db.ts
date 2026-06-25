import path from "path";
import fs from "fs";
import os from "os";
import Database from "better-sqlite3";
import { DEFAULT_MAP_CONFIG, DEFAULT_DAMAGE_CONFIG, DEFAULT_SPELL_TEXT_CONFIG, DEFAULT_BATTLE_REWARDS } from "@/lib/battle/types";
import type {
  UnitStats,
  CharacterRoleMap,
  BattleEventRole,
  MapConfig,
  DamageConfig,
  SpellTextConfig,
  SpellDef,
  SpellTransition,
  SpellType,
  CampaignDef,
  BattleRewardDef,
  BattleRewardEffect,
  BattleRewardRarity,
} from "@/lib/battle/types";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "app.db");

// Serverless (Vercel) has a read-only filesystem except /tmp, and data/app.db
// isn't deployed — so the seeded snapshot data/seed/app.db (bundled via
// next.config `outputFileTracingIncludes`, resolved from process.cwd()) is
// copied to /tmp once per cold start and opened there read-write. Those writes
// are EPHEMERAL (reset on a new/cold instance) — fine for a preview/test deploy,
// not durable authoring. Local dev keeps using data/app.db unchanged.
const ON_VERCEL = process.env.VERCEL === "1";
const SEED_DB = path.join(DB_DIR, "seed", "app.db");
const RUNTIME_DB = ON_VERCEL ? path.join(os.tmpdir(), "app.db") : DB_PATH;

// Cache the connection on globalThis so Next.js dev hot-reload doesn't open a
// new handle / re-run setup on every request.
const globalForDb = globalThis as unknown as {
  __studioDb?: Database.Database;
};

function createDb(): Database.Database {
  if (ON_VERCEL) {
    // Cold-start seed: copy the bundled read-only snapshot into writable /tmp.
    if (!fs.existsSync(RUNTIME_DB)) fs.copyFileSync(SEED_DB, RUNTIME_DB);
  } else {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(RUNTIME_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS animations (
      key         TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      image       TEXT,
      frame_data  TEXT,
      derive_from TEXT,
      reverse     INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS character_animations (
      character_id  TEXT NOT NULL,
      animation_key TEXT NOT NULL,
      duration      REAL,
      loop          INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (character_id, animation_key)
    );
    CREATE TABLE IF NOT EXISTS character_battle_stats (
      character_id  TEXT PRIMARY KEY,
      hp            INTEGER NOT NULL,
      attack        INTEGER NOT NULL,
      defense       INTEGER NOT NULL,
      action_speed  REAL    NOT NULL,
      "range"       INTEGER NOT NULL,
      skills        TEXT    NOT NULL DEFAULT '[]',
      attack_type   TEXT    NOT NULL DEFAULT 'melee'
    );
    CREATE TABLE IF NOT EXISTS character_event_roles (
      character_id  TEXT NOT NULL,
      role          TEXT NOT NULL,
      action_id     TEXT NOT NULL,
      PRIMARY KEY (character_id, role)
    );
    CREATE TABLE IF NOT EXISTS battle_map_config (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      tile_width        REAL,
      tile_height_ratio REAL,
      scale             REAL,
      rotation          REAL
    );
    CREATE TABLE IF NOT EXISTS damage_config (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spell_text_config (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spells (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      animation_key TEXT,
      type          TEXT NOT NULL DEFAULT 'attack',
      power         REAL NOT NULL DEFAULT 1,
      cooldown      REAL NOT NULL DEFAULT 0,
      fps           REAL,
      scale         REAL,
      scale_x       REAL,
      scale_y       REAL,
      loop          INTEGER,
      duration      REAL,
      offset_x      REAL,
      offset_y      REAL,
      rotation      REAL,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      wave_count   INTEGER NOT NULL DEFAULT 1,
      monster_pool TEXT NOT NULL DEFAULT '[]',
      is_active    INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active ON campaigns (is_active) WHERE is_active = 1;
    CREATE TABLE IF NOT EXISTS character_spells (
      character_id TEXT NOT NULL,
      spell_id     TEXT NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (character_id, spell_id)
    );
    CREATE TABLE IF NOT EXISTS mock_battle_roster (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battle_rewards (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      rarity        TEXT NOT NULL DEFAULT 'common',
      effect        TEXT NOT NULL DEFAULT 'atkPercent',
      effect_value  REAL NOT NULL DEFAULT 10,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Migration: battle_map_config predates rotation_x / rotation_y. CREATE TABLE
  // IF NOT EXISTS won't add columns to an already-existing table, so add them
  // here, guarded by a column check so each ALTER is a no-op once applied.
  const mapCols = new Set(
    (
      db
        .prepare("SELECT name FROM pragma_table_info('battle_map_config')")
        .all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (!mapCols.has("rotation_x")) {
    db.exec(
      "ALTER TABLE battle_map_config ADD COLUMN rotation_x REAL NOT NULL DEFAULT 0",
    );
  }
  if (!mapCols.has("rotation_y")) {
    db.exec(
      "ALTER TABLE battle_map_config ADD COLUMN rotation_y REAL NOT NULL DEFAULT 0",
    );
  }
  // Migration: character_battle_stats predates attack_type. Existing DBs (incl.
  // data/app.db and the bundled data/seed/app.db copied to /tmp on Vercel) won't
  // get the new column from CREATE TABLE IF NOT EXISTS, so add it here, guarded
  // by a column check so the ALTER is a no-op once applied.
  const statCols = new Set(
    (
      db
        .prepare("SELECT name FROM pragma_table_info('character_battle_stats')")
        .all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (!statCols.has("attack_type")) {
    db.exec(
      "ALTER TABLE character_battle_stats ADD COLUMN attack_type TEXT NOT NULL DEFAULT 'melee'",
    );
  }
  // Migration: spells predates the visual playback columns (fps / scale_x /
  // scale_y / loop / duration / offset_x / offset_y / rotation). The legacy
  // uniform column is retained; new scaleX/scaleY columns are nullable and
  // existing data/app.db + bundled data/seed/app.db gain them here, each ALTER
  // guarded by a column check.
  const spellCols = new Set(
    (
      db
        .prepare("SELECT name FROM pragma_table_info('spells')")
        .all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (!spellCols.has("fps")) {
    db.exec("ALTER TABLE spells ADD COLUMN fps REAL");
  }
  if (!spellCols.has("scale")) {
    db.exec("ALTER TABLE spells ADD COLUMN scale REAL");
  }
  if (!spellCols.has("scale_x")) {
    db.exec("ALTER TABLE spells ADD COLUMN scale_x REAL");
  }
  if (!spellCols.has("scale_y")) {
    db.exec("ALTER TABLE spells ADD COLUMN scale_y REAL");
  }
  if (!spellCols.has("loop")) {
    db.exec("ALTER TABLE spells ADD COLUMN loop INTEGER");
  }
  if (!spellCols.has("duration")) {
    db.exec("ALTER TABLE spells ADD COLUMN duration REAL");
  }
  if (!spellCols.has("offset_x")) {
    db.exec("ALTER TABLE spells ADD COLUMN offset_x REAL");
  }
  if (!spellCols.has("offset_y")) {
    db.exec("ALTER TABLE spells ADD COLUMN offset_y REAL");
  }
  if (!spellCols.has("rotation")) {
    db.exec("ALTER TABLE spells ADD COLUMN rotation REAL");
  }
  if (!spellCols.has("transition_in")) {
    db.exec("ALTER TABLE spells ADD COLUMN transition_in TEXT");
  }
  if (!spellCols.has("transition_out")) {
    db.exec("ALTER TABLE spells ADD COLUMN transition_out TEXT");
  }
  const rewardCols = new Set(
    (
      db
        .prepare("SELECT name FROM pragma_table_info('battle_rewards')")
        .all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
  if (!rewardCols.has("rarity")) {
    db.exec("ALTER TABLE battle_rewards ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common'");
  }
  const rewardCount = (
    db.prepare("SELECT COUNT(*) AS n FROM battle_rewards").get() as { n: number }
  ).n;
  if (rewardCount === 0) {
    const insertReward = db.prepare(
      `INSERT INTO battle_rewards (id, name, description, effect, effect_value, sort_order)
         VALUES (@id, @name, @description, @effect, @effect_value, @sort_order)`,
    );
    DEFAULT_BATTLE_REWARDS.forEach((reward, i) => {
      insertReward.run({
        id: reward.id,
        name: reward.name,
        description: reward.description,
        rarity: reward.rarity,
        effect: reward.effect,
        effect_value: reward.effectValue,
        sort_order: i,
      });
    });
  }
  return db;
}

function getDb(): Database.Database {
  if (!globalForDb.__studioDb) {
    globalForDb.__studioDb = createDb();
  }
  return globalForDb.__studioDb;
}

// ---------------------------------------------------------------------------
// Mutable user state — stored as a single JSON blob (character list, per-anim
// overrides, actions, transforms, active character). The studio round-trips the
// whole object, so a blob keeps that contract simple.
// ---------------------------------------------------------------------------

/** Returns the stored user-state blob, or null when nothing has been saved yet. */
export function readUserState<T = unknown>(): T | null {
  const row = getDb()
    .prepare("SELECT data FROM app_config WHERE id = 1")
    .get() as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

/** Upserts the whole user-state blob into the single-row table. */
export function writeUserState(state: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO app_config (id, data) VALUES (1, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run({ data: JSON.stringify(state) });
}

// ---------------------------------------------------------------------------
// Animation catalog — the manifest + the spritesheet frame data that used to be
// hardcoded in the client / stored as *-spritesheet.json files on disk.
// ---------------------------------------------------------------------------

export type AnimationRow = {
  key: string;
  label: string;
  image: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  frameData: any | null;
  deriveFrom: string | null;
  reverse: boolean;
};

export function listAnimations(): AnimationRow[] {
  const rows = getDb()
    .prepare(
      `SELECT key, label, image, frame_data, derive_from, reverse
         FROM animations ORDER BY sort_order, key`,
    )
    .all() as Array<{
    key: string;
    label: string;
    image: string | null;
    frame_data: string | null;
    derive_from: string | null;
    reverse: number;
  }>;
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    image: r.image,
    frameData: r.frame_data ? JSON.parse(r.frame_data) : null,
    deriveFrom: r.derive_from,
    reverse: !!r.reverse,
  }));
}

/** Update only the `image` column of an existing animation row (used after
 *  uploading the spritesheet PNG to Firebase Storage — keeps the on-disk PNG
 *  in place for backward-compatible local-dev fallback). */
export function updateAnimationImage(key: string, image: string): void {
  getDb()
    .prepare("UPDATE animations SET image = @image WHERE key = @key")
    .run({ key, image });
}

export function upsertAnimation(a: {
  key: string;
  label: string;
  image?: string | null;
  frameData?: unknown;
  deriveFrom?: string | null;
  reverse?: boolean;
  sortOrder?: number;
}): void {
  const db = getDb();
  const sortOrder =
    a.sortOrder ??
    (
      db
        .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM animations")
        .get() as { n: number }
    ).n;
  db.prepare(
    `INSERT INTO animations (key, label, image, frame_data, derive_from, reverse, sort_order)
       VALUES (@key, @label, @image, @frame_data, @derive_from, @reverse, @sort_order)
     ON CONFLICT(key) DO UPDATE SET
       label       = excluded.label,
       image       = excluded.image,
       frame_data  = excluded.frame_data,
       derive_from = excluded.derive_from,
       reverse     = excluded.reverse`,
  ).run({
    key: a.key,
    label: a.label,
    image: a.image ?? null,
    frame_data: a.frameData != null ? JSON.stringify(a.frameData) : null,
    derive_from: a.deriveFrom ?? null,
    reverse: a.reverse ? 1 : 0,
    sort_order: sortOrder,
  });
}

// ---------------------------------------------------------------------------
// Character seed — which animations belong to each character + their default
// playback (replaces public/character-configs.json). Shaped to match what the
// studio previously read from that file: { [id]: { animations: { [key]: {...} } } }.
// ---------------------------------------------------------------------------

export type CharacterSeed = Record<
  string,
  { animations: Record<string, { duration: number; loop: boolean }> }
>;

export function getCharacterSeed(): CharacterSeed {
  const rows = getDb()
    .prepare(
      `SELECT character_id, animation_key, duration, loop
         FROM character_animations ORDER BY character_id, sort_order, animation_key`,
    )
    .all() as Array<{
    character_id: string;
    animation_key: string;
    duration: number | null;
    loop: number;
  }>;
  const out: CharacterSeed = {};
  for (const r of rows) {
    (out[r.character_id] ??= { animations: {} }).animations[r.animation_key] = {
      duration: r.duration ?? 0,
      loop: !!r.loop,
    };
  }
  return out;
}

export function upsertCharacterAnimation(c: {
  characterId: string;
  animationKey: string;
  duration?: number | null;
  loop?: boolean;
  sortOrder?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO character_animations (character_id, animation_key, duration, loop, sort_order)
         VALUES (@character_id, @animation_key, @duration, @loop, @sort_order)
       ON CONFLICT(character_id, animation_key) DO UPDATE SET
         duration   = excluded.duration,
         loop       = excluded.loop,
         sort_order = excluded.sort_order`,
    )
    .run({
      character_id: c.characterId,
      animation_key: c.animationKey,
      duration: c.duration ?? null,
      loop: c.loop === false ? 0 : 1,
      sort_order: c.sortOrder ?? 0,
    });
}

// ---------------------------------------------------------------------------
// Character removal — clears a character's seed rows AND prunes it from the
// user-state blob, so a deleted character is not re-seeded on the next load.
// ---------------------------------------------------------------------------

const BLOB_CHAR_MAPS = [
  "animationConfigs",
  "actions",
  "characterConfigs",
  "characterAnimations",
] as const;

export function deleteCharacter(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM character_animations WHERE character_id = ?").run(
      id,
    );
    db.prepare("DELETE FROM character_spells WHERE character_id = ?").run(id);
    const row = db.prepare("SELECT data FROM app_config WHERE id = 1").get() as
      | { data: string }
      | undefined;
    if (!row) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = JSON.parse(row.data) as Record<string, any>;
    if (Array.isArray(cfg.characters)) {
      cfg.characters = cfg.characters.filter(
        (c: { id: string }) => c.id !== id,
      );
    }
    for (const k of BLOB_CHAR_MAPS) {
      if (cfg[k] && typeof cfg[k] === "object") delete cfg[k][id];
    }
    if (cfg.activeCharacter === id) {
      cfg.activeCharacter = cfg.characters?.[0]?.id ?? "";
    }
    db.prepare("UPDATE app_config SET data = @data WHERE id = 1").run({
      data: JSON.stringify(cfg),
    });
  })();
}

// ---------------------------------------------------------------------------
// Battle data (/studio/mock-battle) — per-character combat stats + event-role
// maps. `character_battle_stats` is the source of truth for party-builder
// defaults; `character_event_roles` points battle event roles (idle/move/
// attack/hit/death) at authored Action ids the replayer plays (missing roles
// fall back). Both are surfaced read-only via GET /api/config and written
// through the CMS endpoint POST /api/config/battle. Mirrors the upsert style of
// upsertAnimation / upsertCharacterAnimation above.
// ---------------------------------------------------------------------------

function parseSkills(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

/** All per-character battle stats, keyed by character id (skills parsed to string[]). */
export function getBattleStats(): Record<string, UnitStats> {
  const rows = getDb()
    .prepare(
      `SELECT character_id, hp, attack, defense, action_speed, "range", skills, attack_type
         FROM character_battle_stats ORDER BY character_id`,
    )
    .all() as Array<{
    character_id: string;
    hp: number;
    attack: number;
    defense: number;
    action_speed: number;
    range: number;
    skills: string | null;
    attack_type: string | null;
  }>;
  const out: Record<string, UnitStats> = {};
  for (const r of rows) {
    out[r.character_id] = {
      hp: r.hp,
      attack: r.attack,
      defense: r.defense,
      actionSpeed: r.action_speed,
      range: r.range,
      skills: parseSkills(r.skills),
      attackType: (r.attack_type as "melee" | "ranged" | null) ?? "melee",
    };
  }
  return out;
}

/** Per-character event-role -> Action-id maps, keyed by character id. */
export function getCharacterRoleMaps(): Record<string, CharacterRoleMap> {
  const rows = getDb()
    .prepare(
      `SELECT character_id, role, action_id
         FROM character_event_roles ORDER BY character_id, role`,
    )
    .all() as Array<{ character_id: string; role: string; action_id: string }>;
  const out: Record<string, CharacterRoleMap> = {};
  for (const r of rows) {
    (out[r.character_id] ??= {})[r.role as BattleEventRole] = r.action_id;
  }
  return out;
}

/** Idempotent upsert of one character's battle stats (skills stored as JSON). */
export function upsertBattleStats(characterId: string, stats: UnitStats): void {
  getDb()
    .prepare(
      `INSERT INTO character_battle_stats
         (character_id, hp, attack, defense, action_speed, "range", skills, attack_type)
         VALUES (@character_id, @hp, @attack, @defense, @action_speed, @range, @skills, @attack_type)
       ON CONFLICT(character_id) DO UPDATE SET
         hp           = excluded.hp,
         attack       = excluded.attack,
         defense      = excluded.defense,
         action_speed = excluded.action_speed,
         "range"      = excluded."range",
         skills       = excluded.skills,
         attack_type  = excluded.attack_type`,
    )
    .run({
      character_id: characterId,
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      action_speed: stats.actionSpeed,
      range: stats.range,
      skills: JSON.stringify(stats.skills ?? []),
      attack_type: stats.attackType ?? "melee",
    });
}

/**
 * Idempotent upsert of one character's event-role map. Upserts each provided
 * (role -> Action id) pair; unset/empty roles are skipped so the replayer's
 * fallback ladder handles them. Does NOT delete roles omitted from `roleMap`.
 */
export function upsertRoleMap(
  characterId: string,
  roleMap: CharacterRoleMap,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO character_event_roles (character_id, role, action_id)
       VALUES (@character_id, @role, @action_id)
     ON CONFLICT(character_id, role) DO UPDATE SET
       action_id = excluded.action_id`,
  );
  db.transaction(() => {
    for (const [role, actionId] of Object.entries(roleMap)) {
      if (!actionId) continue;
      stmt.run({ character_id: characterId, role, action_id: actionId });
    }
  })();
}

/**
 * Removes battle rows (stats + role maps) for any character NOT in `keepIds`,
 * so the seeder can fully sync the roster and drop characters that are no
 * longer live. Empty `keepIds` clears both tables.
 */
export function pruneBattleData(keepIds: string[]): void {
  const db = getDb();
  db.transaction(() => {
    if (keepIds.length === 0) {
      db.prepare("DELETE FROM character_battle_stats").run();
      db.prepare("DELETE FROM character_event_roles").run();
      db.prepare("DELETE FROM character_spells").run();
      return;
    }
    const placeholders = keepIds.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM character_battle_stats WHERE character_id NOT IN (${placeholders})`,
    ).run(...keepIds);
    db.prepare(
      `DELETE FROM character_event_roles WHERE character_id NOT IN (${placeholders})`,
    ).run(...keepIds);
    db.prepare(
      `DELETE FROM character_spells WHERE character_id NOT IN (${placeholders})`,
    ).run(...keepIds);
  })();
}

// ---------------------------------------------------------------------------
// Board map config (/studio/mock-battle) — a single-row (id=1) table holding
// the board layout (tile size, iso squash, scale, view-angle). Read via
// GET /api/config (mapConfig) and written through POST /api/config/map.
// Mirrors the upsert style of the helpers above; falls back to
// DEFAULT_MAP_CONFIG when no row has been saved yet.
// ---------------------------------------------------------------------------

/** The persisted board layout, or DEFAULT_MAP_CONFIG when no row is saved yet. */
export function getMapConfig(): MapConfig {
  const row = getDb()
    .prepare(
      `SELECT tile_width, tile_height_ratio, scale, rotation, rotation_x, rotation_y
         FROM battle_map_config WHERE id = 1`,
    )
    .get() as
    | {
        tile_width: number;
        tile_height_ratio: number;
        scale: number;
        rotation: number;
        rotation_x: number | null;
        rotation_y: number | null;
      }
    | undefined;
  if (!row) return DEFAULT_MAP_CONFIG;
  return {
    tileWidth: row.tile_width,
    tileHeightRatio: row.tile_height_ratio,
    scale: row.scale,
    rotation: row.rotation,
    rotationX: row.rotation_x ?? 0,
    rotationY: row.rotation_y ?? 0,
  };
}

/** Idempotent upsert of the single board-layout row (id=1). */
export function saveMapConfig(cfg: MapConfig): void {
  getDb()
    .prepare(
      `INSERT INTO battle_map_config
         (id, tile_width, tile_height_ratio, scale, rotation, rotation_x, rotation_y)
         VALUES (1, @tile_width, @tile_height_ratio, @scale, @rotation, @rotation_x, @rotation_y)
       ON CONFLICT(id) DO UPDATE SET
         tile_width        = excluded.tile_width,
         tile_height_ratio = excluded.tile_height_ratio,
         scale             = excluded.scale,
         rotation          = excluded.rotation,
         rotation_x        = excluded.rotation_x,
         rotation_y        = excluded.rotation_y`,
    )
    .run({
      tile_width: cfg.tileWidth,
      tile_height_ratio: cfg.tileHeightRatio,
      scale: cfg.scale,
      rotation: cfg.rotation,
      rotation_x: cfg.rotationX,
      rotation_y: cfg.rotationY,
    });
}

// ---------------------------------------------------------------------------
// Damage-number config (/studio/mock-battle) — a single-row (id=1) table that
// stores the floating combat-text layout as a JSON blob (NOT columns), so new
// knobs need no migration. Read via GET /api/config (damageConfig) and written
// through POST /api/config/damage; falls back to (and merges over)
// DEFAULT_DAMAGE_CONFIG so missing/extra keys are tolerated.
// ---------------------------------------------------------------------------

/** The persisted damage-number config, merged over DEFAULT_DAMAGE_CONFIG. */
export function getDamageConfig(): DamageConfig {
  const row = getDb()
    .prepare("SELECT data FROM damage_config WHERE id = 1")
    .get() as { data: string } | undefined;
  if (!row) return DEFAULT_DAMAGE_CONFIG;
  try {
    const parsed = JSON.parse(row.data) as Partial<DamageConfig>;
    return { ...DEFAULT_DAMAGE_CONFIG, ...parsed };
  } catch {
    return DEFAULT_DAMAGE_CONFIG;
  }
}

/** Idempotent upsert of the single damage-number config row (id=1). */
export function saveDamageConfig(cfg: DamageConfig): void {
  getDb()
    .prepare(
      `INSERT INTO damage_config (id, data) VALUES (1, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run({ data: JSON.stringify(cfg) });
}

// ---------------------------------------------------------------------------
// Spell-text config (/studio/mock-battle) — a single-row (id=1) table that
// stores the floating spell-name callout layout as a JSON blob (NOT columns),
// so new knobs need no migration. Read via GET /api/config (spellTextConfig)
// and written through POST /api/config/spell-text; falls back to (and merges
// over) DEFAULT_SPELL_TEXT_CONFIG so missing/extra keys are tolerated.
// ---------------------------------------------------------------------------

/** The persisted spell-text config, merged over DEFAULT_SPELL_TEXT_CONFIG. */
export function getSpellTextConfig(): SpellTextConfig {
  const row = getDb()
    .prepare("SELECT data FROM spell_text_config WHERE id = 1")
    .get() as { data: string } | undefined;
  if (!row) return DEFAULT_SPELL_TEXT_CONFIG;
  try {
    const parsed = JSON.parse(row.data) as Partial<SpellTextConfig>;
    return { ...DEFAULT_SPELL_TEXT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_SPELL_TEXT_CONFIG;
  }
}

/** Idempotent upsert of the single spell-text config row (id=1). */
export function saveSpellTextConfig(cfg: SpellTextConfig): void {
  getDb()
    .prepare(
      `INSERT INTO spell_text_config (id, data) VALUES (1, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run({ data: JSON.stringify(cfg) });
}

// ---------------------------------------------------------------------------
// Spells (/studio/mock-battle) — a global spell catalog (`spells`) + per-character
// ownership (`character_spells`). Surfaced read-only via GET /api/config
// (spells / characterSpells); the catalog is authored through POST/DELETE
// /api/config/spell, and ownership through POST /api/config/battle. Mirrors the
// listAnimations / upsertRoleMap style above.
// ---------------------------------------------------------------------------

/** The global spell catalog, ordered by sort_order then id. */
export function listSpells(): SpellDef[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, animation_key, type, power, cooldown, fps, scale, scale_x, scale_y, loop, duration, offset_x, offset_y, rotation, transition_in, transition_out
         FROM spells ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: string;
    name: string;
    animation_key: string | null;
    type: string;
    power: number;
    cooldown: number;
    fps: number | null;
    scale: number | null;
    scale_x: number | null;
    scale_y: number | null;
    loop: number | null;
    duration: number | null;
    offset_x: number | null;
    offset_y: number | null;
    rotation: number | null;
    transition_in: string | null;
    transition_out: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    animationKey: r.animation_key ?? "",
    type: r.type as SpellType,
    power: r.power,
    cooldown: r.cooldown,
    fps: r.fps ?? undefined,
    scaleX: r.scale_x ?? r.scale ?? undefined,
    scaleY: r.scale_y ?? r.scale ?? undefined,
    loop: r.loop == null ? undefined : !!r.loop,
    duration: r.duration ?? undefined,
    offsetX: r.offset_x ?? undefined,
    offsetY: r.offset_y ?? undefined,
    rotation: r.rotation ?? undefined,
    transitionIn: (r.transition_in as SpellTransition) ?? undefined,
    transitionOut: (r.transition_out as SpellTransition) ?? undefined,
  }));
}

/** Per-character owned spell-id lists, keyed by character id (ordered). */
export function getCharacterSpells(): Record<string, string[]> {
  const rows = getDb()
    .prepare(
      `SELECT character_id, spell_id
         FROM character_spells ORDER BY character_id, sort_order, spell_id`,
    )
    .all() as Array<{ character_id: string; spell_id: string }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.character_id] ??= []).push(r.spell_id);
  return out;
}

/** Idempotent upsert of one spell-catalog entry (defaults: attack / power 1 / cd 0). */
export function upsertSpell(s: {
  id: string;
  name: string;
  animationKey?: string | null;
  type?: SpellType;
  power?: number;
  cooldown?: number;
  fps?: number;
  scaleX?: number;
  scaleY?: number;
  loop?: boolean;
  duration?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  transitionIn?: SpellTransition;
  transitionOut?: SpellTransition;
  sortOrder?: number;
}): void {
  const db = getDb();
  const sortOrder =
    s.sortOrder ??
    (
      db
        .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM spells")
        .get() as { n: number }
    ).n;
  db.prepare(
    `INSERT INTO spells (id, name, animation_key, type, power, cooldown, fps, scale, scale_x, scale_y, loop, duration, offset_x, offset_y, rotation, transition_in, transition_out, sort_order)
       VALUES (@id, @name, @animation_key, @type, @power, @cooldown, @fps, @scale, @scale_x, @scale_y, @loop, @duration, @offset_x, @offset_y, @rotation, @transition_in, @transition_out, @sort_order)
     ON CONFLICT(id) DO UPDATE SET
       name          = excluded.name,
       animation_key = excluded.animation_key,
       type          = excluded.type,
       power         = excluded.power,
       cooldown      = excluded.cooldown,
       fps           = excluded.fps,
       scale         = excluded.scale,
       scale_x       = excluded.scale_x,
       scale_y       = excluded.scale_y,
       loop          = excluded.loop,
       duration      = excluded.duration,
       offset_x      = excluded.offset_x,
       offset_y      = excluded.offset_y,
       rotation      = excluded.rotation,
       transition_in = excluded.transition_in,
       transition_out = excluded.transition_out`,
  ).run({
    id: s.id,
    name: s.name,
    animation_key: s.animationKey ?? null,
    type: s.type ?? "attack",
    power: s.power ?? 1,
    cooldown: s.cooldown ?? 0,
    fps: s.fps ?? null,
    scale: s.scaleX ?? null,
    scale_x: s.scaleX ?? null,
    scale_y: s.scaleY ?? null,
    loop: s.loop == null ? null : s.loop ? 1 : 0,
    duration: s.duration ?? null,
    offset_x: s.offsetX ?? null,
    offset_y: s.offsetY ?? null,
    rotation: s.rotation ?? null,
    transition_in: s.transitionIn === "fade" || s.transitionIn === "none" ? s.transitionIn : null,
    transition_out: s.transitionOut === "fade" || s.transitionOut === "none" ? s.transitionOut : null,
    sort_order: sortOrder,
  });
}

/** Deletes a spell from the catalog AND from every character that owns it. */
export function deleteSpell(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM spells WHERE id = ?").run(id);
    db.prepare("DELETE FROM character_spells WHERE spell_id = ?").run(id);
  })();
}

// ---------------------------------------------------------------------------
// Campaigns — the /camp consecutive-wave runner config. Each row is a named
// campaign (id, name, wave count, monster pool). Exactly one campaign may be
// active at a time, enforced by a partial unique index on is_active.
// ---------------------------------------------------------------------------

/** All campaigns, ordered by name then id (monsterPool parsed to string[]). */
export function listCampaigns(): CampaignDef[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, wave_count, monster_pool, is_active
         FROM campaigns ORDER BY name, id`,
    )
    .all() as Array<{
    id: string;
    name: string;
    wave_count: number;
    monster_pool: string | null;
    is_active: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    waveCount: r.wave_count,
    monsterPool: parseMonsterPool(r.monster_pool),
    isActive: !!r.is_active,
  }));
}

function parseMonsterPool(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/** Idempotent upsert of a campaign. Does NOT touch is_active. */
export function upsertCampaign(c: {
  id: string;
  name: string;
  waveCount: number;
  monsterPool: string[];
}): void {
  const waveCount = Math.min(50, Math.max(1, Math.floor(Number(c.waveCount) || 1)));
  const monsterPool = JSON.stringify(
    Array.isArray(c.monsterPool)
      ? c.monsterPool.filter((x) => typeof x === "string")
      : [],
  );
  getDb()
    .prepare(
      `INSERT INTO campaigns (id, name, wave_count, monster_pool)
         VALUES (@id, @name, @wave_count, @monster_pool)
       ON CONFLICT(id) DO UPDATE SET
         name        = excluded.name,
         wave_count  = excluded.wave_count,
         monster_pool = excluded.monster_pool`,
    )
    .run({
      id: c.id,
      name: c.name,
      wave_count: waveCount,
      monster_pool: monsterPool,
    });
}

/**
 * Activates exactly one campaign (deactivates all others first, inside a
 * transaction). Pass null to clear the active campaign entirely. This is the
 * ONLY writer that sets is_active = 1; the partial unique index ensures at
 * most one active row at all times.
 */
export function setActiveCampaign(id: string | null): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE campaigns SET is_active = 0 WHERE is_active = 1").run();
    if (id != null) {
      db.prepare("UPDATE campaigns SET is_active = 1 WHERE id = ?").run(id);
    }
  })();
}

/** Deletes a campaign by id. (No child tables; deleting the active campaign is valid.) */
export function deleteCampaign(id: string): void {
  getDb().prepare("DELETE FROM campaigns WHERE id = ?").run(id);
}

/** Replace-all set of a character's owned spell ids (sort_order = array index). */
export function setCharacterSpells(
  characterId: string,
  spellIds: string[],
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO character_spells (character_id, spell_id, sort_order)
       VALUES (@character_id, @spell_id, @sort_order)
     ON CONFLICT(character_id, spell_id) DO UPDATE SET sort_order = excluded.sort_order`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM character_spells WHERE character_id = ?").run(
      characterId,
    );
    spellIds.forEach((spellId, i) => {
      insert.run({ character_id: characterId, spell_id: spellId, sort_order: i });
    });
  })();
}

// ---------------------------------------------------------------------------
// Mock-battle party roster (/studio/mock-battle) — a single-row (id=1) table
// holding the party-builder state as an OPAQUE JSON blob (no typed schema), so
// the client-owned shape can evolve without a migration. Read via GET
// /api/config (roster) and written through POST /api/config/roster. Mirrors the
// readUserState / writeUserState blob style; the server never inspects the shape.
// ---------------------------------------------------------------------------

/** The persisted party-roster blob, or null when nothing has been saved yet. */
export function getRoster(): unknown | null {
  const row = getDb()
    .prepare("SELECT data FROM mock_battle_roster WHERE id = 1")
    .get() as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

/** Idempotent upsert of the single party-roster row (id=1). */
export function setRoster(data: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO mock_battle_roster (id, data) VALUES (1, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run({ data: JSON.stringify(data) });
}

// ---------------------------------------------------------------------------
// Battle rewards — campaign wave-reward cards. Surfaced read-only via
// GET /api/config (battleRewards) and authored through POST/DELETE
// /api/config/reward. Mirrors the spells CRUD style.
// ---------------------------------------------------------------------------

/** The global battle-reward catalog, ordered by sort_order then id. */
export function listBattleRewards(): BattleRewardDef[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, description, rarity, effect, effect_value
         FROM battle_rewards ORDER BY sort_order, id`,
    )
    .all() as Array<{
    id: string;
    name: string;
    description: string;
    rarity: string;
    effect: string;
    effect_value: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    rarity: (["common", "uncommon", "rare"].includes(r.rarity)
      ? r.rarity
      : "common") as BattleRewardRarity,
    effect: (["atkPercent", "restoreHp", "defFlat"].includes(r.effect)
      ? r.effect
      : "atkPercent") as BattleRewardEffect,
    effectValue: r.effect_value,
  }));
}

/** Idempotent upsert of one battle-reward entry. */
export function upsertBattleReward(r: {
  id: string;
  name: string;
  description?: string;
  rarity?: BattleRewardRarity;
  effect?: BattleRewardEffect;
  effectValue?: number;
  sortOrder?: number;
}): void {
  const db = getDb();
  const sortOrder =
    r.sortOrder ??
    (
      db
        .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM battle_rewards")
        .get() as { n: number }
    ).n;
  db.prepare(
    `INSERT INTO battle_rewards (id, name, description, rarity, effect, effect_value, sort_order)
       VALUES (@id, @name, @description, @rarity, @effect, @effect_value, @sort_order)
     ON CONFLICT(id) DO UPDATE SET
       name          = excluded.name,
       description   = excluded.description,
       rarity        = excluded.rarity,
       effect        = excluded.effect,
       effect_value  = excluded.effect_value`,
  ).run({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    rarity: r.rarity ?? "common",
    effect: r.effect ?? "atkPercent",
    effect_value: r.effectValue ?? 10,
    sort_order: sortOrder,
  });
}

/** Deletes a battle reward by id. */
export function deleteBattleReward(id: string): void {
  getDb().prepare("DELETE FROM battle_rewards WHERE id = ?").run(id);
}

/** Prunes battle rewards to an allowed id set (used by the idempotent seed script). */
export function pruneBattleRewards(keepIds: string[]): void {
  const db = getDb();
  if (keepIds.length === 0) {
    db.prepare("DELETE FROM battle_rewards").run();
    return;
  }
  const placeholders = keepIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM battle_rewards WHERE id NOT IN (${placeholders})`).run(...keepIds);
}
