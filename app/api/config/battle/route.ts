import { NextRequest, NextResponse } from "next/server";
import { upsertBattleStats, upsertRoleMap, setCharacterSpells } from "@/lib/db";
import type { UnitStats, CharacterRoleMap } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CMS write endpoint for per-character battle data (Lane E calls this).
// Stats + role maps are otherwise server-managed and surfaced read-only by
// GET /api/config. Body: { characterId, stats?, roles? } — at least one of
// stats/roles should be present; both upserts are idempotent.
//
// NOTE: stats are stored as authored (unclamped). STAT_BOUNDS clamping is the
// resolve route's job at simulation time (Lane C), not the CMS's.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "expected an object" },
      { status: 400 },
    );
  }
  const { characterId, stats, roles, spells } = body as {
    characterId?: string;
    stats?: UnitStats;
    roles?: CharacterRoleMap;
    spells?: string[];
  };
  if (typeof characterId !== "string" || !characterId) {
    return NextResponse.json(
      { ok: false, error: "missing characterId" },
      { status: 400 },
    );
  }
  if (stats) await upsertBattleStats(characterId, stats);
  if (roles) await upsertRoleMap(characterId, roles);
  // Replace-all owned-spell list. Array.isArray (not truthy) so `spells: []`
  // correctly clears ownership and a non-array can't reach setCharacterSpells.
  if (Array.isArray(spells)) await setCharacterSpells(characterId, spells);
  return NextResponse.json({ ok: true });
}
