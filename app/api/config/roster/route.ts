import { NextRequest, NextResponse } from "next/server";
import { getRoster, setRoster } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persistence for the mock-battle party builder. The roster is an OPAQUE JSON
// blob owned entirely by the client — the server stores it verbatim (no shape
// validation) and surfaces it via GET /api/config (roster). Mirrors the
// single-row blob writer style of POST /api/config/damage.
export async function GET() {
  return NextResponse.json({ roster: await getRoster() });
}

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
  // Store the client-owned blob verbatim. `?? null` guards the absent-key case.
  const { roster } = body as { roster?: unknown };
  await setRoster(roster ?? null);
  return NextResponse.json({ ok: true });
}
