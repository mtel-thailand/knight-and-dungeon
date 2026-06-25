import { NextRequest, NextResponse } from "next/server";
import { getUserCharacters } from "@/lib/db";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user/characters?userId=<uid> — Read all characters for a user.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "missing userId" }, { status: 400 });
  }
  try {
    const characters = await getUserCharacters(userId);
    return NextResponse.json({ ok: true, characters });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/user/characters — Upsert a character's EXP (and optionally stats).
 * Body: { userId, characterId, exp, level?, hp?, attack?, defense?, actionSpeed? }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { userId, characterId, exp, level } = body as {
    userId?: string;
    characterId?: string;
    exp?: number;
    level?: number;
  };
  if (!userId || !characterId) {
    return NextResponse.json({ ok: false, error: "userId and characterId required" }, { status: 400 });
  }
  try {
    const db = getDb();
    // Upsert: on conflict, update exp + optional level
    const setFields: Record<string, unknown> = {};
    if (typeof exp === "number") setFields.exp = exp;
    if (typeof level === "number") setFields.level = level;
    await db
      .insert(schema.userCharacters)
      .values({ userId, characterId, level: level ?? 1, exp: exp ?? 0, hp: 200, attack: 20, defense: 0, actionSpeed: 100, range: 1 })
      .onConflictDoUpdate({
        target: [schema.userCharacters.userId, schema.userCharacters.characterId],
        set: setFields as any,
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
