import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/db-spike — Postgres migration probe.
 *
 * When DB_BACKEND=postgres, writes a timestamp to app_config via the new
 * lib/db/postgres pool, reads it back, and returns the round-tripped value.
 * Otherwise returns a no-op SQLite skip indicator.
 */
export async function GET() {
  if (process.env.DB_BACKEND !== "postgres") {
    return NextResponse.json({ backend: "sqlite", skipped: true });
  }

  try {
    const { readUserState: readConfig } = await import("@/lib/db");
    // Use postgres-adapter directly for the upsert (lib/db/index is read-only).
    const { setAppConfig } = await import("@/lib/db/postgres-adapter");

    const probe = { probe: Date.now(), ts: new Date().toISOString() };
    await setAppConfig(probe);
    const readback = await readConfig();

    return NextResponse.json({
      backend: "postgres",
      ok: true,
      roundTrip: readback,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
