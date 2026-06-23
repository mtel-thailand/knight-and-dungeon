import { NextRequest, NextResponse } from "next/server";
import {
  readUserState,
  writeUserState,
  listAnimations,
  getCharacterSeed,
  deleteCharacter,
  getBattleStats,
  getCharacterRoleMaps,
  getMapConfig,
  getDamageConfig,
  listSpells,
  getCharacterSpells,
  getRoster,
} from "./db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_USER_STATE = {
  activeCharacter: "knight",
  characters: [{ id: "knight", name: "Knight" }],
  animationConfigs: {},
  actions: {},
};

export async function GET() {
  const userState = readUserState() ?? DEFAULT_USER_STATE;
  return NextResponse.json({
    ...userState,
    animations: listAnimations(),
    characterSeed: getCharacterSeed(),
    battleStats: getBattleStats(),
    roleMaps: getCharacterRoleMaps(),
    mapConfig: getMapConfig(),
    damageConfig: getDamageConfig(),
    spells: listSpells(),
    characterSpells: getCharacterSpells(),
    roster: getRoster(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "expected an object" },
      { status: 400 },
    );
  }
  // Persist only mutable user state; the catalog (animations + characterSeed),
  // battle data (battleStats + roleMaps + spells + characterSpells), board
  // layout (mapConfig), the damage-number config (damageConfig), and the
  // mock-battle roster (roster) are server-managed and must never be written
  // back from the client. battleStats/roleMaps/characterSpells are edited via
  // POST /api/config/battle; the spell catalog via POST/DELETE /api/config/spell;
  // mapConfig via POST /api/config/map; damageConfig via POST /api/config/damage;
  // roster via POST /api/config/roster.
  const userState = { ...body };
  delete userState.animations;
  delete userState.characterSeed;
  delete userState.battleStats;
  delete userState.roleMaps;
  delete userState.mapConfig;
  delete userState.damageConfig;
  delete userState.spells;
  delete userState.characterSpells;
  delete userState.roster;
  writeUserState(userState);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("character");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing character id" },
      { status: 400 },
    );
  }
  deleteCharacter(id);
  return NextResponse.json({ ok: true });
}
