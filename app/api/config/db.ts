import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { DEFAULT_MAP_CONFIG, DEFAULT_DAMAGE_CONFIG } from "@/lib/battle/types";
import type {
  UnitStats,
  CharacterRoleMap,
  BattleEventRole,
  MapConfig,
  DamageConfig,
} from "@/lib/battle/types";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "app.db");

// Cache the connection on globalThis so Next.js dev hot-reload doesn't open a
// new handle / re-run setup on every request.
const globalForDb = globalThis as unknown as {
  __studioDb?: Database.Database;
};

function createDb(): Database.Database {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
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
      skills        TEXT    NOT NULL DEFAULT '[]'
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
      `SELECT character_id, hp, attack, defense, action_speed, "range", skills
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
         (character_id, hp, attack, defense, action_speed, "range", skills)
         VALUES (@character_id, @hp, @attack, @defense, @action_speed, @range, @skills)
       ON CONFLICT(character_id) DO UPDATE SET
         hp           = excluded.hp,
         attack       = excluded.attack,
         defense      = excluded.defense,
         action_speed = excluded.action_speed,
         "range"      = excluded."range",
         skills       = excluded.skills`,
    )
    .run({
      character_id: characterId,
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      action_speed: stats.actionSpeed,
      range: stats.range,
      skills: JSON.stringify(stats.skills ?? []),
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
      return;
    }
    const placeholders = keepIds.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM character_battle_stats WHERE character_id NOT IN (${placeholders})`,
    ).run(...keepIds);
    db.prepare(
      `DELETE FROM character_event_roles WHERE character_id NOT IN (${placeholders})`,
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
