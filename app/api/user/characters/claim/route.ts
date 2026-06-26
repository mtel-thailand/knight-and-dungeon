import { NextRequest, NextResponse } from "next/server";
import { claimCharacter } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/user/characters/claim — Claim a free character.
 * Body: { userId, characterId }
 * Succeeds only when the user has NO living character.
 * Returns 200 { ok: true } on success.
 * Returns 409 { ok: false, reason } on business-logic failure:
 *   - "already_owned" — the character is already owned and alive
 *   - "has_living_character" — the user already has a living character
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
    const result = await claimCharacter(userId, characterId);
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
