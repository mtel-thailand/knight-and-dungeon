// Shared types for the Animation Studio (StudioClient.tsx).
//
// Pixi types are imported with `import type`, which TypeScript erases at compile
// time — no runtime `pixi.js` import is emitted, so Pixi stays out of module /
// server scope (it is still loaded lazily via `await import("pixi.js")` inside
// the client effect).

import type { Texture, SpritesheetData } from "pixi.js";
import type { UnitStats, CharacterRoleMap, MapConfig, SpellDef, CampaignDef } from "@/lib/battle/types";

/** Per-animation playback config (the DB stores {duration,loop}; the client widens it with alpha/rotation). */
export type AnimConfig = {
  duration: number;
  loop: boolean;
  alpha: number;
  rotation: number;
};

/** A catalog row as delivered by GET /api/config (manifest + raw spritesheet frame data). */
export type CatalogEntry = {
  key: string;
  label: string;
  image: string | null;
  frameData: SpritesheetData | null;
  deriveFrom: string | null;
  reverse: boolean;
};

/** A runtime animation: a catalog row resolved to actual frame textures + live config. */
export type AnimationRow = {
  label: string;
  configKey: string;
  frames: Texture[];
  config: AnimConfig;
};

/** An action step that plays an animation (optionally trimmed to a frame range). */
export type AnimStep = {
  type: "animation";
  animationKey: string;
  duration: number;
  startFrame?: number;
  endFrame?: number;
};
/** An action step that holds the current frame for `duration` seconds. */
export type FreezeStep = { type: "freeze"; duration: number };
export type ActionStep = AnimStep | FreezeStep;

/** A polished, per-character playable motion built from ordered steps. */
export type Action = { id: string; name: string; steps: ActionStep[]; sound?: string };

/** A stored action as persisted in the user-state blob (pre- or post-migration shape). */
export type StoredAction = {
  id: string;
  name: string;
  steps?: ActionStep[];
  animationKeys?: string[];
  sound?: string;
};

/** Per-character transform applied to the previewed sprite. */
export type CharConfigData = {
  scaleX: number;
  scaleY: number;
  anchorX: number;
  anchorY: number;
  tint: number;
};

/** The mutable user-state blob round-tripped through GET/POST /api/config. */
export type ServerConfig = {
  activeCharacter: string;
  characters: Array<{ id: string; name: string }>;
  animationConfigs: Record<string, Record<string, Partial<AnimConfig>>>;
  actions: Record<string, StoredAction[]>;
  characterConfigs?: Record<string, CharConfigData>;
  characterAnimations?: Record<string, string[]>;
};

/** Per-character animation seed (db.ts getCharacterSeed): which keys a character owns + defaults. */
export type CharacterSeed = Record<
  string,
  { animations: Record<string, { duration: number; loop: boolean }> }
>;

/** Full GET /api/config payload: mutable user state + server-managed catalog/seed/battle data. */
export type BootstrapPayload = {
  activeCharacter?: string;
  characters?: Array<{ id: string; name: string }>;
  animationConfigs?: Record<string, Record<string, Partial<AnimConfig>>>;
  actions?: Record<string, StoredAction[]>;
  characterConfigs?: Record<string, CharConfigData>;
  characterAnimations?: Record<string, string[]>;
  animations?: CatalogEntry[];
  characterSeed?: CharacterSeed;
  battleStats?: Record<string, UnitStats>;
  roleMaps?: Record<string, CharacterRoleMap>;
  spells?: SpellDef[];
  characterSpells?: Record<string, string[]>;
  mapConfig?: MapConfig;
  campaigns?: CampaignDef[];
};
