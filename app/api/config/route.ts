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
  // battle data (battleStats + roleMaps), and board layout (mapConfig) are
  // server-managed and must never be written back from the client.
  // battleStats/roleMaps are edited via POST /api/config/battle; mapConfig via
  // POST /api/config/map.
  const userState = { ...body };
  delete userState.animations;
  delete userState.characterSeed;
  delete userState.battleStats;
  delete userState.roleMaps;
  delete userState.mapConfig;
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
