import { NextRequest, NextResponse } from "next/server";
import { getUserStats } from "@/lib/db";
import { getDb } from "@/lib/db/client";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/user/stats?userId=<uid> — Read a user's meta stats.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "missing userId" }, { status: 400 });
  }
  try {
    const stats = await getUserStats(userId);
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/user/stats — Upsert a user's meta stats (e.g. totalExp).
 * Body: { userId, totalExp?, totalWins?, totalLosses?, totalKills? }
 * Only provided fields are updated.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { userId, totalExp, totalWins, totalLosses, totalKills, totalMana } = body as {
    userId?: string;
    totalExp?: number;
    totalWins?: number;
    totalLosses?: number;
    totalKills?: number;
    totalMana?: number;
  };
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ ok: false, error: "userId required" }, { status: 400 });
  }
  try {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (typeof totalExp === "number") updates.total_exp = totalExp;
    if (typeof totalWins === "number") updates.total_wins = totalWins;
    if (typeof totalLosses === "number") updates.total_losses = totalLosses;
    if (typeof totalKills === "number") updates.total_kills = totalKills;
    if (typeof totalMana === "number") updates.total_mana = totalMana;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });
    }
    const values = { userId, ...updates } as any;
    await db
      .insert(schema.userStats)
      .values(values)
      .onConflictDoUpdate({ target: schema.userStats.userId, set: updates as any });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
