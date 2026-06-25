/**
 * Drizzle ORM adapter — replaces the raw-pg and SQLite adapters with
 * type-safe Drizzle queries against the Postgres schema.
 *
 * Exports the exact same function signatures as the old postgres-adapter.ts
 * so all callers (routes, seed scripts) import from @/lib/db without changes.
 */

import { eq, sql, inArray, notInArray, and } from "drizzle-orm";
import { getDb } from "./client";
import * as schema from "./schema";
import type {
  UnitStats,
  CharacterRoleMap,
  BattleEventRole,
  MapConfig,
  DamageConfig,
  SpellTextConfig,
  SpellDef,
  SpellType,
  SpellTransition,
  CampaignDef,
  BattleRewardDef,
  BattleRewardEffect,
  BattleRewardRarity,
} from "@/lib/battle/types";
import type { AnimationRow, CharacterSeed } from "./types";
import { DEFAULT_MAP_CONFIG, DEFAULT_DAMAGE_CONFIG, DEFAULT_SPELL_TEXT_CONFIG, DEFAULT_BATTLE_REWARDS } from "@/lib/battle/types";

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
// Read API
// ---------------------------------------------------------------------------

/** Read the JSON blob from the single-row `app_config` table, or null. */
export async function readUserState<T = unknown>(): Promise<T | null> {
  const db = getDb();
  const rows = await db.select().from(schema.appConfig).where(eq(schema.appConfig.id, 1));
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].data) as T;
}

/** All animation catalog rows, ordered by sort_order then key. */
export async function listAnimations(): Promise<AnimationRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.animations)
    .orderBy(schema.animations.sortOrder, schema.animations.key);
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    image: r.image,
    frameData: r.frameData ? JSON.parse(r.frameData) : null,
    deriveFrom: r.deriveFrom,
    reverse: !!r.reverse,
  }));
}

/** Per-character animation seed (character_animations). */
export async function getCharacterSeed(): Promise<CharacterSeed> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.characterAnimations)
    .orderBy(schema.characterAnimations.characterId, schema.characterAnimations.sortOrder, schema.characterAnimations.animationKey);
  const out: CharacterSeed = {};
  for (const r of rows) {
    (out[r.characterId] ??= { animations: {} }).animations[r.animationKey] = {
      duration: r.duration ?? 0,
      loop: !!r.loop,
    };
  }
  return out;
}

/** All per-character battle stats, keyed by character id. */
export async function getBattleStats(): Promise<Record<string, UnitStats>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.characterBattleStats)
    .orderBy(schema.characterBattleStats.characterId);
  const out: Record<string, UnitStats> = {};
  for (const r of rows) {
    out[r.characterId] = {
      hp: r.hp,
      attack: r.attack,
      defense: r.defense,
      actionSpeed: r.actionSpeed,
      range: r.range,
      skills: parseSkills(r.skills),
      attackType: (r.attackType as "melee" | "ranged" | null) ?? "melee",
    };
  }
  return out;
}

/** Per-character event-role → Action-id maps, keyed by character id. */
export async function getCharacterRoleMaps(): Promise<Record<string, CharacterRoleMap>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.characterEventRoles)
    .orderBy(schema.characterEventRoles.characterId, schema.characterEventRoles.role);
  const out: Record<string, CharacterRoleMap> = {};
  for (const r of rows) {
    (out[r.characterId] ??= {})[r.role as BattleEventRole] = r.actionId;
  }
  return out;
}

/** The persisted board layout, or DEFAULT_MAP_CONFIG when no row is saved yet. */
export async function getMapConfig(): Promise<MapConfig> {
  const db = getDb();
  const rows = await db.select().from(schema.battleMapConfig).where(eq(schema.battleMapConfig.id, 1));
  if (rows.length === 0) return DEFAULT_MAP_CONFIG;
  const r = rows[0];
  return {
    tileWidth: r.tileWidth!,
    tileHeightRatio: r.tileHeightRatio!,
    scale: r.scale!,
    rotation: r.rotation!,
    rotationX: r.rotationX ?? 0,
    rotationY: r.rotationY ?? 0,
  };
}

/** The persisted damage-number config, merged over DEFAULT_DAMAGE_CONFIG. */
export async function getDamageConfig(): Promise<DamageConfig> {
  const db = getDb();
  const rows = await db.select().from(schema.damageConfig).where(eq(schema.damageConfig.id, 1));
  if (rows.length === 0) return DEFAULT_DAMAGE_CONFIG;
  try {
    const parsed = JSON.parse(rows[0].data) as Partial<DamageConfig>;
    return { ...DEFAULT_DAMAGE_CONFIG, ...parsed };
  } catch {
    return DEFAULT_DAMAGE_CONFIG;
  }
}

/** The persisted spell-name callout config, merged over DEFAULT_SPELL_TEXT_CONFIG. */
export async function getSpellTextConfig(): Promise<SpellTextConfig> {
  const db = getDb();
  const rows = await db.select().from(schema.spellTextConfig).where(eq(schema.spellTextConfig.id, 1));
  if (rows.length === 0) return DEFAULT_SPELL_TEXT_CONFIG;
  try {
    const parsed = JSON.parse(rows[0].data) as Partial<SpellTextConfig>;
    return { ...DEFAULT_SPELL_TEXT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_SPELL_TEXT_CONFIG;
  }
}

/** The global spell catalog, ordered by sort_order then id. */
export async function listSpells(): Promise<SpellDef[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.spells)
    .orderBy(schema.spells.sortOrder, schema.spells.id);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    animationKey: r.animationKey ?? "",
    type: r.type as SpellType,
    power: r.power,
    cooldown: r.cooldown,
    fps: r.fps ?? undefined,
    scaleX: r.scaleX ?? r.scale ?? undefined,
    scaleY: r.scaleY ?? r.scale ?? undefined,
    loop: r.loop == null ? undefined : !!r.loop,
    duration: r.duration ?? undefined,
    offsetX: r.offsetX ?? undefined,
    offsetY: r.offsetY ?? undefined,
    rotation: r.rotation ?? undefined,
    transitionIn: (r.transitionIn as SpellTransition) ?? undefined,
    transitionOut: (r.transitionOut as SpellTransition) ?? undefined,
  }));
}

/** Per-character owned spell-id lists, keyed by character id. */
export async function getCharacterSpells(): Promise<Record<string, string[]>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.characterSpells)
    .orderBy(schema.characterSpells.characterId, schema.characterSpells.sortOrder, schema.characterSpells.spellId);
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    (out[r.characterId] ??= []).push(r.spellId);
  }
  return out;
}

/** All campaigns, ordered by name then id. */
export async function listCampaigns(): Promise<CampaignDef[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaigns)
    .orderBy(schema.campaigns.name, schema.campaigns.id);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    waveCount: r.waveCount,
    monsterPool: parseMonsterPool(r.monsterPool),
    isActive: !!r.isActive,
  }));
}

/** The persisted party-roster blob, or null when nothing has been saved yet. */
export async function getRoster(): Promise<unknown> {
  const db = getDb();
  const rows = await db.select().from(schema.mockBattleRoster).where(eq(schema.mockBattleRoster.id, 1));
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].data);
}

/** The global battle-reward catalog, ordered by sort_order then id. */
export async function listBattleRewards(): Promise<BattleRewardDef[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.battleRewards)
    .orderBy(schema.battleRewards.sortOrder, schema.battleRewards.id);
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
    effectValue: r.effectValue,
  }));
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

// ---- app_config (single-row JSON blob) ----

/** Upsert the whole user-state blob into the single-row app_config table. */
export async function writeUserState(json: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.appConfig)
    .values({ id: 1, data: JSON.stringify(json) })
    .onConflictDoUpdate({ target: schema.appConfig.id, set: { data: sql`excluded.data` } });
}

const BLOB_CHAR_MAPS = [
  "animationConfigs",
  "actions",
  "characterConfigs",
  "characterAnimations",
] as const;

/** Delete a character from the blob AND from seed/ownership tables. */
export async function deleteCharacter(id: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.characterAnimations).where(eq(schema.characterAnimations.characterId, id));
    await tx.delete(schema.characterSpells).where(eq(schema.characterSpells.characterId, id));
    const rows = await tx.select().from(schema.appConfig).where(eq(schema.appConfig.id, 1));
    if (rows.length > 0) {
      const cfg = JSON.parse(rows[0].data) as Record<string, unknown>;
      if (Array.isArray(cfg.characters)) {
        cfg.characters = (cfg.characters as Array<{ id: string }>).filter(
          (c) => c.id !== id,
        );
      }
      for (const k of BLOB_CHAR_MAPS) {
        if (cfg[k] && typeof cfg[k] === "object") delete cfg[k];
      }
      if (cfg.activeCharacter === id) {
        const chars = cfg.characters as Array<{ id: string }> | undefined;
        cfg.activeCharacter = chars?.[0]?.id ?? "";
      }
      await tx
        .update(schema.appConfig)
        .set({ data: JSON.stringify(cfg) })
        .where(eq(schema.appConfig.id, 1));
    }
  });
}

// ---- animations catalog ----

/** Upsert one animation catalog entry. */
export async function upsertAnimation(a: {
  key: string;
  label: string;
  image?: string | null;
  frameData?: unknown;
  deriveFrom?: string | null;
  reverse?: boolean;
  sortOrder?: number;
}): Promise<void> {
  const db = getDb();
  let sortOrder = a.sortOrder;
  if (sortOrder == null) {
    const [row] = await db
      .select({ n: sql<number | null>`COALESCE(MAX(sort_order), -1) + 1` })
      .from(schema.animations);
    sortOrder = row?.n ?? 0;
  }
  await db
    .insert(schema.animations)
    .values({
      key: a.key,
      label: a.label,
      image: a.image ?? null,
      frameData: a.frameData != null ? JSON.stringify(a.frameData) : null,
      deriveFrom: a.deriveFrom ?? null,
      reverse: a.reverse ? 1 : 0,
      sortOrder,
    })
    .onConflictDoUpdate({
      target: schema.animations.key,
      set: {
        label: sql`excluded.label`,
        image: sql`excluded.image`,
        frameData: sql`excluded.frame_data`,
        deriveFrom: sql`excluded.derive_from`,
        reverse: sql`excluded.reverse`,
      },
    });
}

/** Update only the `image` column of an existing animation row. */
export async function updateAnimationImage(key: string, image: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.animations)
    .set({ image })
    .where(eq(schema.animations.key, key));
}

/** Idempotent upsert of a character-animation seed row. */
export async function upsertCharacterAnimation(c: {
  characterId: string;
  animationKey: string;
  duration?: number | null;
  loop?: boolean;
  sortOrder?: number;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.characterAnimations)
    .values({
      characterId: c.characterId,
      animationKey: c.animationKey,
      duration: c.duration ?? null,
      loop: c.loop === false ? 0 : 1,
      sortOrder: c.sortOrder ?? 0,
    })
    .onConflictDoUpdate({
      target: [schema.characterAnimations.characterId, schema.characterAnimations.animationKey],
      set: {
        duration: sql`excluded.duration`,
        loop: sql`excluded.loop`,
        sortOrder: sql`excluded.sort_order`,
      },
    });
}

// ---- battle data ----

/** Idempotent upsert of one character's battle stats. */
export async function upsertBattleStats(characterId: string, stats: UnitStats): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.characterBattleStats)
    .values({
      characterId,
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      actionSpeed: stats.actionSpeed,
      range: stats.range,
      skills: JSON.stringify(stats.skills ?? []),
      attackType: stats.attackType ?? "melee",
    })
    .onConflictDoUpdate({
      target: schema.characterBattleStats.characterId,
      set: {
        hp: sql`excluded.hp`,
        attack: sql`excluded.attack`,
        defense: sql`excluded.defense`,
        actionSpeed: sql`excluded.action_speed`,
        range: sql`excluded.range`,
        skills: sql`excluded.skills`,
        attackType: sql`excluded.attack_type`,
      },
    });
}

/** Idempotent upsert of one character's event-role map. */
export async function upsertRoleMap(
  characterId: string,
  roleMap: CharacterRoleMap,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [role, actionId] of Object.entries(roleMap)) {
      if (!actionId) continue;
      await tx
        .insert(schema.characterEventRoles)
        .values({ characterId, role, actionId })
        .onConflictDoUpdate({
          target: [schema.characterEventRoles.characterId, schema.characterEventRoles.role],
          set: { actionId: sql`excluded.action_id` },
      });
    }
  });
}

// ---- user data (auth) ----

/** Seed a new user with starter character "blue" and empty stats. */
export async function initUser(userId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Insert starter character
    await tx.insert(schema.userCharacters).values({
      userId,
      characterId: "blue",
      level: 1,
      exp: 0,
      hp: 200,
      attack: 20,
      defense: 0,
      actionSpeed: 100,
      range: 1,
      sortOrder: 0,
    }).onConflictDoNothing({ target: [schema.userCharacters.userId, schema.userCharacters.characterId] });
    // Insert stats row
    await tx.insert(schema.userStats).values({
      userId,
      totalWins: 0,
      totalLosses: 0,
      totalExp: 0,
      totalKills: 0,
    }).onConflictDoNothing({ target: schema.userStats.userId });
  });
}

/** Get all characters owned by a user. */
export async function getUserCharacters(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.userCharacters)
    .where(eq(schema.userCharacters.userId, userId))
    .orderBy(schema.userCharacters.sortOrder);
}

/** Get meta stats for a user. */
export async function getUserStats(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.userStats)
    .where(eq(schema.userStats.userId, userId));
  return rows[0] ?? null;
}

/** Remove battle rows for any character NOT in keepIds. Empty keepIds clears all. */
export async function pruneBattleData(keepIds: string[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (keepIds.length === 0) {
      await tx.delete(schema.characterBattleStats);
      await tx.delete(schema.characterEventRoles);
      await tx.delete(schema.characterSpells);
    } else {
      await tx.delete(schema.characterBattleStats).where(notInArray(schema.characterBattleStats.characterId, keepIds));
      await tx.delete(schema.characterEventRoles).where(notInArray(schema.characterEventRoles.characterId, keepIds));
      await tx.delete(schema.characterSpells).where(notInArray(schema.characterSpells.characterId, keepIds));
    }
  });
}

// ---- board map config ----

/** Idempotent upsert of the single board-layout row (id=1). */
export async function saveMapConfig(cfg: MapConfig): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.battleMapConfig)
    .values({
      id: 1,
      tileWidth: cfg.tileWidth,
      tileHeightRatio: cfg.tileHeightRatio,
      scale: cfg.scale,
      rotation: cfg.rotation,
      rotationX: cfg.rotationX,
      rotationY: cfg.rotationY,
    })
    .onConflictDoUpdate({
      target: schema.battleMapConfig.id,
      set: {
        tileWidth: sql`excluded.tile_width`,
        tileHeightRatio: sql`excluded.tile_height_ratio`,
        scale: sql`excluded.scale`,
        rotation: sql`excluded.rotation`,
        rotationX: sql`excluded.rotation_x`,
        rotationY: sql`excluded.rotation_y`,
      },
    });
}

// ---- damage config ----

/** Idempotent upsert of the single damage-number config row (id=1). */
export async function saveDamageConfig(cfg: DamageConfig): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.damageConfig)
    .values({ id: 1, data: JSON.stringify(cfg) })
    .onConflictDoUpdate({ target: schema.damageConfig.id, set: { data: sql`excluded.data` } });
}

// ---- spell text config ----

/** Idempotent upsert of the single spell-text config row (id=1). */
export async function saveSpellTextConfig(cfg: SpellTextConfig): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.spellTextConfig)
    .values({ id: 1, data: JSON.stringify(cfg) })
    .onConflictDoUpdate({ target: schema.spellTextConfig.id, set: { data: sql`excluded.data` } });
}

// ---- spells catalog ----

/** Idempotent upsert of one spell-catalog entry. */
export async function upsertSpell(s: {
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
}): Promise<void> {
  const db = getDb();
  let sortOrder = s.sortOrder;
  if (sortOrder == null) {
    const [row] = await db
      .select({ n: sql<number | null>`COALESCE(MAX(sort_order), -1) + 1` })
      .from(schema.spells);
    sortOrder = row?.n ?? 0;
  }
  await db
    .insert(schema.spells)
    .values({
      id: s.id,
      name: s.name,
      animationKey: s.animationKey ?? null,
      type: s.type ?? "attack",
      power: s.power ?? 1,
      cooldown: s.cooldown ?? 0,
      fps: s.fps ?? null,
      scale: s.scaleX ?? null,
      scaleX: s.scaleX ?? null,
      scaleY: s.scaleY ?? null,
      loop: s.loop == null ? null : s.loop ? 1 : 0,
      duration: s.duration ?? null,
      offsetX: s.offsetX ?? null,
      offsetY: s.offsetY ?? null,
      rotation: s.rotation ?? null,
      transitionIn: s.transitionIn === "fade" || s.transitionIn === "none" ? s.transitionIn : null,
      transitionOut: s.transitionOut === "fade" || s.transitionOut === "none" ? s.transitionOut : null,
      sortOrder,
    })
    .onConflictDoUpdate({
      target: schema.spells.id,
      set: {
        name: sql`excluded.name`,
        animationKey: sql`excluded.animation_key`,
        type: sql`excluded.type`,
        power: sql`excluded.power`,
        cooldown: sql`excluded.cooldown`,
        fps: sql`excluded.fps`,
        scale: sql`excluded.scale`,
        scaleX: sql`excluded.scale_x`,
        scaleY: sql`excluded.scale_y`,
        loop: sql`excluded.loop`,
        duration: sql`excluded.duration`,
        offsetX: sql`excluded.offset_x`,
        offsetY: sql`excluded.offset_y`,
        rotation: sql`excluded.rotation`,
        transitionIn: sql`excluded.transition_in`,
        transitionOut: sql`excluded.transition_out`,
      },
    });
}

/** Deletes a spell from the catalog AND from every character that owns it. */
export async function deleteSpell(id: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.spells).where(eq(schema.spells.id, id));
    await tx.delete(schema.characterSpells).where(eq(schema.characterSpells.spellId, id));
  });
}

// ---- character spell ownership ----

/** Replace-all set of a character's owned spell ids. */
export async function setCharacterSpells(
  characterId: string,
  spellIds: string[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.characterSpells).where(eq(schema.characterSpells.characterId, characterId));
    for (let i = 0; i < spellIds.length; i++) {
      await tx.insert(schema.characterSpells).values({
        characterId,
        spellId: spellIds[i],
        sortOrder: i,
      });
    }
  });
}

// ---- campaigns ----

/** Idempotent upsert of a campaign. Does NOT touch is_active. */
export async function upsertCampaign(c: {
  id: string;
  name: string;
  waveCount: number;
  monsterPool: string[];
}): Promise<void> {
  const db = getDb();
  const waveCount = Math.min(50, Math.max(1, Math.floor(Number(c.waveCount) || 1)));
  const monsterPool = JSON.stringify(
    Array.isArray(c.monsterPool)
      ? c.monsterPool.filter((x) => typeof x === "string")
      : [],
  );
  await db
    .insert(schema.campaigns)
    .values({ id: c.id, name: c.name, waveCount, monsterPool })
    .onConflictDoUpdate({
      target: schema.campaigns.id,
      set: {
        name: sql`excluded.name`,
        waveCount: sql`excluded.wave_count`,
        monsterPool: sql`excluded.monster_pool`,
      },
    });
}

/** Activate exactly one campaign (deactivates all others first). Pass null to clear. */
export async function setActiveCampaign(id: string | null): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.campaigns)
      .set({ isActive: 0 })
      .where(eq(schema.campaigns.isActive, 1));
    if (id != null) {
      await tx
        .update(schema.campaigns)
        .set({ isActive: 1 })
        .where(eq(schema.campaigns.id, id));
    }
  });
}

/** Deletes a campaign by id. */
export async function deleteCampaign(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.campaigns).where(eq(schema.campaigns.id, id));
}

// ---- party roster ----

/** Idempotent upsert of the single party-roster row (id=1). */
export async function setRoster(data: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.mockBattleRoster)
    .values({ id: 1, data: JSON.stringify(data) })
    .onConflictDoUpdate({ target: schema.mockBattleRoster.id, set: { data: sql`excluded.data` } });
}

// ---- battle rewards ----

/** Idempotent upsert of one battle-reward entry. */
export async function upsertBattleReward(r: {
  id: string;
  name: string;
  description?: string;
  rarity?: BattleRewardRarity;
  effect?: BattleRewardEffect;
  effectValue?: number;
  sortOrder?: number;
}): Promise<void> {
  const db = getDb();
  let sortOrder = r.sortOrder;
  if (sortOrder == null) {
    const [row] = await db
      .select({ n: sql<number | null>`COALESCE(MAX(sort_order), -1) + 1` })
      .from(schema.battleRewards);
    sortOrder = row?.n ?? 0;
  }
  await db
    .insert(schema.battleRewards)
    .values({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      rarity: r.rarity ?? "common",
      effect: r.effect ?? "atkPercent",
      effectValue: r.effectValue ?? 10,
      sortOrder,
    })
    .onConflictDoUpdate({
      target: schema.battleRewards.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        rarity: sql`excluded.rarity`,
        effect: sql`excluded.effect`,
        effectValue: sql`excluded.effect_value`,
      },
    });
}

/** Deletes a battle reward by id. */
export async function deleteBattleReward(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.battleRewards).where(eq(schema.battleRewards.id, id));
}

/** Prunes battle rewards to an allowed id set. */
export async function pruneBattleRewards(keepIds: string[]): Promise<void> {
  const db = getDb();
  if (keepIds.length === 0) {
    await db.delete(schema.battleRewards);
    return;
  }
  await db.delete(schema.battleRewards).where(notInArray(schema.battleRewards.id, keepIds));
}

// ---- seeding convenience ----

/** Seed the default battle rewards if the table is empty. */
export async function seedDefaultBattleRewards(): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.battleRewards);
  if ((row?.n ?? 0) > 0) return;
  await db.transaction(async (tx) => {
    for (let i = 0; i < DEFAULT_BATTLE_REWARDS.length; i++) {
      const rew = DEFAULT_BATTLE_REWARDS[i];
      await tx.insert(schema.battleRewards).values({
        id: rew.id,
        name: rew.name,
        description: rew.description,
        rarity: rew.rarity,
        effect: rew.effect,
        effectValue: rew.effectValue,
        sortOrder: i,
      });
    }
  });
}
