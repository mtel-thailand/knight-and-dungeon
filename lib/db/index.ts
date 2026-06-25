/**
 * DB backend selector — DYNAMIC import so the unused backend is never loaded.
 *
 * Default (DB_BACKEND unset or not "postgres") → sqlite-adapter (async wrappers
 * around the existing synchronous db.ts).
 * DB_BACKEND=postgres                          → postgres-adapter (pg.Pool queries).
 *
 * Every exported function is an async thin wrapper that lazily resolves the
 * backend once (cached in module scope). The GET handler in
 * app/api/config/route.ts `await`s each function directly — the code path is
 * identical for both backends.
 */

import type {
  AnimationRow,
  CharacterSeed,
} from "@/app/api/config/db";
import type {
  UnitStats,
  CharacterRoleMap,
  MapConfig,
  DamageConfig,
  SpellTextConfig,
  SpellDef,
  CampaignDef,
} from "@/lib/battle/types";

// ---------------------------------------------------------------------------
// Lazy-resolved backend implementation.
// ---------------------------------------------------------------------------

type DbReadAdapter = {
  readUserState<T = unknown>(): Promise<T | null>;
  listAnimations(): Promise<AnimationRow[]>;
  getCharacterSeed(): Promise<CharacterSeed>;
  getBattleStats(): Promise<Record<string, UnitStats>>;
  getCharacterRoleMaps(): Promise<Record<string, CharacterRoleMap>>;
  getMapConfig(): Promise<MapConfig>;
  getDamageConfig(): Promise<DamageConfig>;
  getSpellTextConfig(): Promise<SpellTextConfig>;
  listSpells(): Promise<SpellDef[]>;
  getCharacterSpells(): Promise<Record<string, string[]>>;
  listCampaigns(): Promise<CampaignDef[]>;
  getRoster(): Promise<unknown>;
};

let _impl: DbReadAdapter | null = null;

async function impl(): Promise<DbReadAdapter> {
  if (!_impl) {
    _impl = (
      process.env.DB_BACKEND === "postgres"
        ? await import("./postgres-adapter")
        : await import("./sqlite-adapter")
    ) as unknown as DbReadAdapter;
  }
  return _impl;
}

// ---------------------------------------------------------------------------
// Exported read API — matches the function names & return types from db.ts.
// ---------------------------------------------------------------------------

export async function readUserState<T = unknown>(): Promise<T | null> {
  return (await impl()).readUserState<T>();
}

export async function listAnimations(): Promise<AnimationRow[]> {
  return (await impl()).listAnimations();
}

export async function getCharacterSeed(): Promise<CharacterSeed> {
  return (await impl()).getCharacterSeed();
}

export async function getBattleStats(): Promise<Record<string, UnitStats>> {
  return (await impl()).getBattleStats();
}

export async function getCharacterRoleMaps(): Promise<Record<string, CharacterRoleMap>> {
  return (await impl()).getCharacterRoleMaps();
}

export async function getMapConfig(): Promise<MapConfig> {
  return (await impl()).getMapConfig();
}

export async function getDamageConfig(): Promise<DamageConfig> {
  return (await impl()).getDamageConfig();
}

export async function getSpellTextConfig(): Promise<SpellTextConfig> {
  return (await impl()).getSpellTextConfig();
}

export async function listSpells(): Promise<SpellDef[]> {
  return (await impl()).listSpells();
}

export async function getCharacterSpells(): Promise<Record<string, string[]>> {
  return (await impl()).getCharacterSpells();
}

export async function listCampaigns(): Promise<CampaignDef[]> {
  return (await impl()).listCampaigns();
}

export async function getRoster(): Promise<unknown> {
  return (await impl()).getRoster();
}
