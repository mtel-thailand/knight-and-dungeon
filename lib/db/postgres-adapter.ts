/**
 * Postgres adapter — async read-only implementations of the same functions
 * exported by app/api/config/db.ts, querying the Postgres schema defined in
 * data/schema.postgres.sql via a `pg.Pool` singleton.
 *
 * READS ONLY this phase — writers (POST /api/config, /api/config/battle, etc.)
 * remain on the synchronous db.ts. The pool uses `max: 3` (serverless pooler
 * friendly) and plain `$1` parameterized queries (no prepared-statement caching
 * — transaction-mode poolers reject named prepares).
 *
 * Guarded by `DB_BACKEND=postgres` — the caller in lib/db/index.ts chooses this
 * module dynamically, so better-sqlite3 never loads on the Postgres path.
 */

import { Pool } from "pg";
import type {
  UnitStats,
  BattleEventRole,
  CharacterRoleMap,
  MapConfig,
  DamageConfig,
  SpellTextConfig,
  SpellDef,
  SpellType,
  SpellTransition,
  CampaignDef,
  BattleRewardDef,
  BattleRewardEffect,
} from "@/lib/battle/types";
import type { AnimationRow, CharacterSeed } from "@/app/api/config/db";
import { DEFAULT_MAP_CONFIG, DEFAULT_DAMAGE_CONFIG, DEFAULT_SPELL_TEXT_CONFIG } from "@/lib/battle/types";

// ---------------------------------------------------------------------------
// Pool singleton (same pattern as app/api/config/db.ts)
// ---------------------------------------------------------------------------
const globalForPg = globalThis as unknown as { __pgAdapterPool?: Pool };

function getPool(): Pool {
  if (!globalForPg.__pgAdapterPool) {
    globalForPg.__pgAdapterPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
  }
  return globalForPg.__pgAdapterPool;
}

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Read API — matches the return types of the db.ts exports exactly.
// ---------------------------------------------------------------------------

/** Read the JSON blob from the single-row `app_config` table, or null. */
export async function readUserState<T = unknown>(): Promise<T | null> {
  const pool = getPool();
  const result = await pool.query<{ data: string }>(
    `SELECT data FROM app_config WHERE id = 1`,
  );
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].data) as T;
}

/** All animation catalog rows, ordered by sort_order then key. */
export async function listAnimations(): Promise<AnimationRow[]> {
  const pool = getPool();
  const result = await pool.query<{
    key: string;
    label: string;
    image: string | null;
    frame_data: string | null;
    derive_from: string | null;
    reverse: number;
  }>(
    `SELECT key, label, image, frame_data, derive_from, "reverse"
     FROM animations ORDER BY sort_order, key`,
  );
  return result.rows.map((r) => ({
    key: r.key,
    label: r.label,
    image: r.image,
    frameData: r.frame_data ? JSON.parse(r.frame_data) : null,
    deriveFrom: r.derive_from,
    reverse: !!r.reverse,
  }));
}

/** Per-character animation seed (character_animations). */
export async function getCharacterSeed(): Promise<CharacterSeed> {
  const pool = getPool();
  const result = await pool.query<{
    character_id: string;
    animation_key: string;
    duration: number | null;
    loop: number;
  }>(
    `SELECT character_id, animation_key, duration, loop
     FROM character_animations ORDER BY character_id, sort_order, animation_key`,
  );
  const out: CharacterSeed = {};
  for (const r of result.rows) {
    (out[r.character_id] ??= { animations: {} }).animations[r.animation_key] = {
      duration: r.duration ?? 0,
      loop: !!r.loop,
    };
  }
  return out;
}

/** All per-character battle stats, keyed by character id. */
export async function getBattleStats(): Promise<Record<string, UnitStats>> {
  const pool = getPool();
  const result = await pool.query<{
    character_id: string;
    hp: number;
    attack: number;
    defense: number;
    action_speed: number;
    range: number;
    skills: string | null;
    attack_type: string | null;
  }>(
    `SELECT character_id, hp, attack, defense, action_speed, "range", skills, attack_type
     FROM character_battle_stats ORDER BY character_id`,
  );
  const out: Record<string, UnitStats> = {};
  for (const r of result.rows) {
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

/** Per-character event-role → Action-id maps, keyed by character id. */
export async function getCharacterRoleMaps(): Promise<Record<string, CharacterRoleMap>> {
  const pool = getPool();
  const result = await pool.query<{
    character_id: string;
    role: string;
    action_id: string;
  }>(
    `SELECT character_id, role, action_id
     FROM character_event_roles ORDER BY character_id, role`,
  );
  const out: Record<string, CharacterRoleMap> = {};
  for (const r of result.rows) {
    (out[r.character_id] ??= {})[r.role as BattleEventRole] = r.action_id;
  }
  return out;
}

/** The persisted board layout, or DEFAULT_MAP_CONFIG when no row is saved yet. */
export async function getMapConfig(): Promise<MapConfig> {
  const pool = getPool();
  const result = await pool.query<{
    tile_width: number;
    tile_height_ratio: number;
    scale: number;
    rotation: number;
    rotation_x: number | null;
    rotation_y: number | null;
  }>(
    `SELECT tile_width, tile_height_ratio, scale, rotation, rotation_x, rotation_y
     FROM battle_map_config WHERE id = 1`,
  );
  if (result.rows.length === 0) return DEFAULT_MAP_CONFIG;
  const r = result.rows[0];
  return {
    tileWidth: r.tile_width,
    tileHeightRatio: r.tile_height_ratio,
    scale: r.scale,
    rotation: r.rotation,
    rotationX: r.rotation_x ?? 0,
    rotationY: r.rotation_y ?? 0,
  };
}

/** The persisted damage-number config, merged over DEFAULT_DAMAGE_CONFIG. */
export async function getDamageConfig(): Promise<DamageConfig> {
  const pool = getPool();
  const result = await pool.query<{ data: string }>(
    `SELECT data FROM damage_config WHERE id = 1`,
  );
  if (result.rows.length === 0) return DEFAULT_DAMAGE_CONFIG;
  try {
    const parsed = JSON.parse(result.rows[0].data) as Partial<DamageConfig>;
    return { ...DEFAULT_DAMAGE_CONFIG, ...parsed };
  } catch {
    return DEFAULT_DAMAGE_CONFIG;
  }
}

/** The persisted spell-name callout config, merged over DEFAULT_SPELL_TEXT_CONFIG. */
export async function getSpellTextConfig(): Promise<SpellTextConfig> {
  const pool = getPool();
  const result = await pool.query<{ data: string }>(
    `SELECT data FROM spell_text_config WHERE id = 1`,
  );
  if (result.rows.length === 0) return DEFAULT_SPELL_TEXT_CONFIG;
  try {
    const parsed = JSON.parse(result.rows[0].data) as Partial<SpellTextConfig>;
    return { ...DEFAULT_SPELL_TEXT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_SPELL_TEXT_CONFIG;
  }
}

/** The global spell catalog, ordered by sort_order then id. */
export async function listSpells(): Promise<SpellDef[]> {
  const pool = getPool();
  const result = await pool.query<{
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
  }>(
    `SELECT id, name, animation_key, type, power, cooldown,
            fps, scale, scale_x, scale_y, loop, duration,
            offset_x, offset_y, rotation,
            transition_in, transition_out
     FROM spells ORDER BY sort_order, id`,
  );
  return result.rows.map((r) => ({
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

/** Per-character owned spell-id lists, keyed by character id. */
export async function getCharacterSpells(): Promise<Record<string, string[]>> {
  const pool = getPool();
  const result = await pool.query<{
    character_id: string;
    spell_id: string;
  }>(
    `SELECT character_id, spell_id
     FROM character_spells ORDER BY character_id, sort_order, spell_id`,
  );
  const out: Record<string, string[]> = {};
  for (const r of result.rows) {
    (out[r.character_id] ??= []).push(r.spell_id);
  }
  return out;
}

/** All campaigns, ordered by name then id. */
export async function listCampaigns(): Promise<CampaignDef[]> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    name: string;
    wave_count: number;
    monster_pool: string | null;
    is_active: number;
  }>(
    `SELECT id, name, wave_count, monster_pool, is_active
     FROM campaigns ORDER BY name, id`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    waveCount: r.wave_count,
    monsterPool: parseMonsterPool(r.monster_pool),
    isActive: !!r.is_active,
  }));
}

/**
 * Upsert the JSON blob into the single-row `app_config` table.
 * (Spike-only writer — the real writers remain on the sync db.ts path.)
 */
export async function setAppConfig(json: unknown): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO app_config (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
    [JSON.stringify(json)],
  );
}

/** The persisted party-roster blob, or null when nothing has been saved. */
export async function getRoster(): Promise<unknown> {
  const pool = getPool();
  const result = await pool.query<{ data: string }>(
    `SELECT data FROM mock_battle_roster WHERE id = 1`,
  );
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].data);
}

/** The global battle-reward catalog, ordered by sort_order then id. */
export async function listBattleRewards(): Promise<BattleRewardDef[]> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    name: string;
    description: string;
    effect: string;
    effect_value: number;
  }>(
    `SELECT id, name, description, effect, effect_value
     FROM battle_rewards ORDER BY sort_order, id`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    effect: (["atkPercent", "restoreHp", "defFlat"].includes(r.effect)
      ? r.effect
      : "atkPercent") as BattleRewardEffect,
    effectValue: r.effect_value,
  }));
}
