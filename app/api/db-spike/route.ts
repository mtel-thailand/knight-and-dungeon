import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/db-spike — DB connectivity probe.
 * Writes a timestamp to app_config and reads it back.
 */
export async function GET() {
  try {
    const { readUserState, writeUserState } = await import("@/lib/db");

    const probe = { probe: Date.now(), ts: new Date().toISOString() };
    await writeUserState(probe);
    const readback = await readUserState();

    return NextResponse.json({
      ok: true,
      roundTrip: readback,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
