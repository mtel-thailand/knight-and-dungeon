/**
 * DB adapter entry point — re-exports from the Drizzle adapter.
 *
 * All callers (routes, seed scripts) import from @/lib/db and get the
 * correct implementation regardless of backend.
 */

export {
  // Reads
  readUserState,
  listAnimations,
  getCharacterSeed,
  getBattleStats,
  getCharacterRoleMaps,
  getMapConfig,
  getDamageConfig,
  getSpellTextConfig,
  listSpells,
  getCharacterSpells,
  listCampaigns,
  getRoster,
  listBattleRewards,
  saveBattleLog,

  // Writes
  writeUserState,
  deleteCharacter,
  upsertAnimation,
  updateAnimationImage,
  upsertCharacterAnimation,
  upsertBattleStats,
  upsertRoleMap,
  pruneBattleData,
  saveMapConfig,
  saveDamageConfig,
  saveSpellTextConfig,
  upsertSpell,
  deleteSpell,
  setCharacterSpells,
  upsertCampaign,
  setActiveCampaign,
  deleteCampaign,
  setRoster,
  upsertBattleReward,
  deleteBattleReward,
  pruneBattleRewards,
  initUser,
  getUserCharacters,
  getUserStats,
} from "./adapter";

export type {
  AnimationRow,
  CharacterSeed,
} from "./types";
