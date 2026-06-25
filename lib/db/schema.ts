import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// app_config — single-row JSON blob for mutable user state
// ---------------------------------------------------------------------------
export const appConfig = pgTable(
  "app_config",
  {
    id: integer("id").primaryKey().notNull(),
    data: text("data").notNull(),
  },
  (t) => [check("app_config_id_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// animations — the animation catalog (spritesheet frame data + metadata)
// ---------------------------------------------------------------------------
export const animations = pgTable("animations", {
  key: text("key").primaryKey().notNull(),
  label: text("label").notNull(),
  image: text("image"),
  frameData: text("frame_data"),
  deriveFrom: text("derive_from"),
  reverse: integer("reverse").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// character_animations — per-character animation seed rows
// ---------------------------------------------------------------------------
export const characterAnimations = pgTable(
  "character_animations",
  {
    characterId: text("character_id").notNull(),
    animationKey: text("animation_key").notNull(),
    duration: doublePrecision("duration"),
    loop: integer("loop").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.animationKey] })],
);

// ---------------------------------------------------------------------------
// character_battle_stats — per-character combat stats
// ---------------------------------------------------------------------------
export const characterBattleStats = pgTable("character_battle_stats", {
  characterId: text("character_id").primaryKey().notNull(),
  hp: integer("hp").notNull(),
  attack: integer("attack").notNull(),
  defense: integer("defense").notNull(),
  actionSpeed: doublePrecision("action_speed").notNull(),
  range: integer("range").notNull(),
  skills: text("skills").notNull().default("[]"),
  attackType: text("attack_type").notNull().default("melee"),
});

// ---------------------------------------------------------------------------
// character_event_roles — per-character battle event → action mapping
// ---------------------------------------------------------------------------
export const characterEventRoles = pgTable(
  "character_event_roles",
  {
    characterId: text("character_id").notNull(),
    role: text("role").notNull(),
    actionId: text("action_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.role] })],
);

// ---------------------------------------------------------------------------
// battle_map_config — single-row board layout config
// ---------------------------------------------------------------------------
export const battleMapConfig = pgTable(
  "battle_map_config",
  {
    id: integer("id").primaryKey().notNull(),
    tileWidth: doublePrecision("tile_width"),
    tileHeightRatio: doublePrecision("tile_height_ratio"),
    scale: doublePrecision("scale"),
    rotation: doublePrecision("rotation"),
    rotationX: doublePrecision("rotation_x").notNull().default(0),
    rotationY: doublePrecision("rotation_y").notNull().default(0),
  },
  (t) => [check("map_config_id_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// damage_config — single-row floating-damage config blob
// ---------------------------------------------------------------------------
export const damageConfig = pgTable(
  "damage_config",
  {
    id: integer("id").primaryKey().notNull(),
    data: text("data").notNull(),
  },
  (t) => [check("damage_config_id_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// spell_text_config — single-row spell-name callout config blob
// ---------------------------------------------------------------------------
export const spellTextConfig = pgTable(
  "spell_text_config",
  {
    id: integer("id").primaryKey().notNull(),
    data: text("data").notNull(),
  },
  (t) => [check("spell_text_config_id_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// spells — global spell catalog
// ---------------------------------------------------------------------------
export const spells = pgTable("spells", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  animationKey: text("animation_key"),
  type: text("type").notNull().default("attack"),
  power: doublePrecision("power").notNull().default(1),
  cooldown: doublePrecision("cooldown").notNull().default(0),
  fps: doublePrecision("fps"),
  scale: doublePrecision("scale"),
  scaleX: doublePrecision("scale_x"),
  scaleY: doublePrecision("scale_y"),
  loop: integer("loop"),
  duration: doublePrecision("duration"),
  offsetX: doublePrecision("offset_x"),
  offsetY: doublePrecision("offset_y"),
  rotation: doublePrecision("rotation"),
  transitionIn: text("transition_in"),
  transitionOut: text("transition_out"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// campaigns — wave-runner campaign definitions
// ---------------------------------------------------------------------------
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    waveCount: integer("wave_count").notNull().default(1),
    monsterPool: text("monster_pool").notNull().default("[]"),
    isActive: integer("is_active").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_campaigns_one_active")
      .on(t.isActive)
      .where(sql`${t.isActive} = 1`),
  ],
);

// ---------------------------------------------------------------------------
// character_spells — per-character owned-spell list
// ---------------------------------------------------------------------------
export const characterSpells = pgTable(
  "character_spells",
  {
    characterId: text("character_id").notNull(),
    spellId: text("spell_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.spellId] })],
);

// ---------------------------------------------------------------------------
// mock_battle_roster — single-row party roster blob
// ---------------------------------------------------------------------------
export const mockBattleRoster = pgTable(
  "mock_battle_roster",
  {
    id: integer("id").primaryKey().notNull(),
    data: text("data").notNull(),
  },
  (t) => [check("roster_id_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// battle_rewards — catalog of campaign wave-reward cards
// ---------------------------------------------------------------------------
export const battleRewards = pgTable("battle_rewards", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  rarity: text("rarity").notNull().default("common"),
  effect: text("effect").notNull().default("atkPercent"),
  effectValue: doublePrecision("effect_value").notNull().default(10),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// user_characters — per-user owned character roster (persists across battles)
// ---------------------------------------------------------------------------
export const userCharacters = pgTable(
  "user_characters",
  {
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    level: integer("level").notNull().default(1),
    exp: integer("exp").notNull().default(0),
    hp: integer("hp").notNull(),
    attack: integer("attack").notNull(),
    defense: integer("defense").notNull(),
    actionSpeed: doublePrecision("action_speed").notNull(),
    range: integer("range").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

// ---------------------------------------------------------------------------
// user_stats — meta progression (wins, losses, total exp)
// ---------------------------------------------------------------------------
export const userStats = pgTable(
  "user_stats",
  {
    userId: text("user_id").primaryKey().notNull(),
    totalWins: integer("total_wins").notNull().default(0),
    totalLosses: integer("total_losses").notNull().default(0),
    totalExp: integer("total_exp").notNull().default(0),
    totalKills: integer("total_kills").notNull().default(0),
  },
);
