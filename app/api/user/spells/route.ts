import { NextRequest, NextResponse } from "next/server";
import { purchaseSpell, getUserCharacterSpells } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user/spells?userId=<uid> — List all spell purchases for a user.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "missing userId" }, { status: 400 });
  }
  try {
    const spells = await getUserCharacterSpells(userId);
    return NextResponse.json({ ok: true, spells });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/user/spells — Purchase a spell for a character.
 * Body: { userId, characterId, spellId }
 * Returns 200 { ok: true, balance } on success, 409 with reason on failure.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { userId, characterId, spellId } = body as {
    userId?: string;
    characterId?: string;
    spellId?: string;
  };
  if (!userId || !characterId || !spellId) {
    return NextResponse.json(
      { ok: false, error: "userId, characterId, and spellId are required" },
      { status: 400 },
    );
  }
  if (
    typeof userId !== "string" ||
    typeof characterId !== "string" ||
    typeof spellId !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "userId, characterId, and spellId must be strings" },
      { status: 400 },
    );
  }
  try {
    const result = await purchaseSpell(userId, characterId, spellId);
    if (!result.ok) {
      const status = result.reason === "already_owned" ? 409 : 409;
      return NextResponse.json({ ok: false, reason: result.reason }, { status });
    }
    return NextResponse.json({ ok: true, balance: result.balance });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
