/**
 * SQLite adapter — thin async wrappers around the synchronous db.ts functions.
 *
 * This is the DEFAULT backend (used when DB_BACKEND is unset or not "postgres").
 * Every function simply calls the matching sync export from app/api/config/db and
 * returns the result wrapped in a resolved promise (so the GET handler can always
 * `await` the adapter regardless of backend).
 */

import type { AnimationRow, CharacterSeed } from "@/app/api/config/db";
import type {
  UnitStats,
  CharacterRoleMap,
  MapConfig,
  DamageConfig,
  SpellTextConfig,
  SpellDef,
  CampaignDef,
  BattleRewardDef,
} from "@/lib/battle/types";

// Dynamic import inside the functions so better-sqlite3 is never loaded when
// DB_BACKEND=postgres (the module-level import is replaced by these wrappers).
let _db: typeof import("@/app/api/config/db") | null = null;
async function db(): Promise<typeof import("@/app/api/config/db")> {
  if (!_db) _db = await import("@/app/api/config/db");
  return _db;
}

export async function readUserState<T = unknown>(): Promise<T | null> {
  return (await db()).readUserState<T>();
}

export async function listAnimations(): Promise<AnimationRow[]> {
  return (await db()).listAnimations();
}

export async function getCharacterSeed(): Promise<CharacterSeed> {
  return (await db()).getCharacterSeed();
}

export async function getBattleStats(): Promise<Record<string, UnitStats>> {
  return (await db()).getBattleStats();
}

export async function getCharacterRoleMaps(): Promise<Record<string, CharacterRoleMap>> {
  return (await db()).getCharacterRoleMaps();
}

export async function getMapConfig(): Promise<MapConfig> {
  return (await db()).getMapConfig();
}

export async function getDamageConfig(): Promise<DamageConfig> {
  return (await db()).getDamageConfig();
}

export async function getSpellTextConfig(): Promise<SpellTextConfig> {
  return (await db()).getSpellTextConfig();
}

export async function listSpells(): Promise<SpellDef[]> {
  return (await db()).listSpells();
}

export async function getCharacterSpells(): Promise<Record<string, string[]>> {
  return (await db()).getCharacterSpells();
}

export async function listCampaigns(): Promise<CampaignDef[]> {
  return (await db()).listCampaigns();
}

export async function getRoster(): Promise<unknown> {
  return (await db()).getRoster();
}

export async function listBattleRewards(): Promise<BattleRewardDef[]> {
  return (await db()).listBattleRewards();
}
