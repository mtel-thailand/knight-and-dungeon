import { NextRequest, NextResponse } from "next/server";
import { initUser, getUserCharacters, getUserStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/user/init — Initialize a new user's account.
 * Seeds "blue" as the starter character and creates an empty stats row.
 * Idempotent: safe to call multiple times (uses ON CONFLICT DO NOTHING).
 */
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
  const { userId } = body as { userId?: string };
  if (!userId || typeof userId !== "string") {
    return NextResponse.json(
      { ok: false, error: "userId is required" },
      { status: 400 },
    );
  }

  try {
    await initUser(userId);
    const [characters, stats] = await Promise.all([
      getUserCharacters(userId),
      getUserStats(userId),
    ]);
    return NextResponse.json({ ok: true, characters, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
