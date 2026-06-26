import { NextRequest, NextResponse } from "next/server";
import { getUserStats, creditMana } from "@/lib/db";
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
 * POST /api/user/stats — Upsert a user's meta stats.
 * Body: { userId, totalExp?, totalWins?, totalLosses?, totalKills?, manaCredit? }
 * Only provided fields are updated. manaCredit is additive (creditMana), NOT absolute.
 * Returns { ok, balance } when manaCredit is provided.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { userId, totalExp, totalWins, totalLosses, totalKills, manaCredit } = body as {
    userId?: string;
    totalExp?: number;
    totalWins?: number;
    totalLosses?: number;
    totalKills?: number;
    manaCredit?: number;
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
    // Handle additive mana credit (NOT absolute totalMana)
    const manaDelta = typeof manaCredit === "number" && Number.isFinite(manaCredit) ? Math.floor(manaCredit) : 0;
    if (Object.keys(updates).length === 0 && manaDelta === 0) {
      return NextResponse.json({ ok: false, error: "no fields to update" }, { status: 400 });
    }
    if (Object.keys(updates).length > 0) {
      const values = { userId, ...updates } as any;
      await db
        .insert(schema.userStats)
        .values(values)
        .onConflictDoUpdate({ target: schema.userStats.userId, set: updates as any });
    }
    // Apply mana credit after other updates
    const balance = manaDelta !== 0 ? await creditMana(userId, manaDelta) : undefined;
    return NextResponse.json({ ok: true, ...(balance !== undefined ? { balance } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
