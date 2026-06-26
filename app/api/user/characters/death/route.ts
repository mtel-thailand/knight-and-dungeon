import { NextRequest, NextResponse } from "next/server";
import { markCharacterDeadAndForfeit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/user/characters/death — Mark a character as dead and forfeit their spells.
 * Body: { userId, characterId }
 * Atomic: sets is_dead=1 AND deletes all user_character_spells for this (userId, characterId).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { userId, characterId } = body as {
    userId?: string;
    characterId?: string;
  };
  if (!userId || !characterId) {
    return NextResponse.json(
      { ok: false, error: "userId and characterId are required" },
      { status: 400 },
    );
  }
  if (typeof userId !== "string" || typeof characterId !== "string") {
    return NextResponse.json(
      { ok: false, error: "userId and characterId must be strings" },
      { status: 400 },
    );
  }
  try {
    await markCharacterDeadAndForfeit(userId, characterId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
