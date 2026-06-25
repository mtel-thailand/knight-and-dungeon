import { NextRequest, NextResponse } from "next/server";
import { saveMapConfig } from "@/lib/db";
import type { MapConfig } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Validation bounds for the persisted board layout. In-range values are clamped;
// non-numeric / non-finite fields are rejected with 400.
const MAP_BOUNDS = {
  tileWidth: { min: 16, max: 400 },
  tileHeightRatio: { min: 0.1, max: 1 },
  scale: { min: 0.25, max: 4 },
  rotation: { min: -180, max: 180 },
  rotationX: { min: -80, max: 80 },
  rotationY: { min: -80, max: 80 },
} as const;

const FIELDS = [
  "tileWidth",
  "tileHeightRatio",
  "scale",
  "rotation",
  "rotationX",
  "rotationY",
] as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Persist the mock-battle board layout. Body is a full MapConfig JSON object;
// each field is validated then clamped before upserting the id=1 row.
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
      { ok: false, error: "expected a MapConfig object" },
      { status: 400 },
    );
  }
  const raw = body as Record<string, unknown>;
  const cfg = {} as MapConfig;
  for (const field of FIELDS) {
    const value = raw[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return NextResponse.json(
        { ok: false, error: `invalid ${field}: expected a finite number` },
        { status: 400 },
      );
    }
    cfg[field] = clamp(value, MAP_BOUNDS[field].min, MAP_BOUNDS[field].max);
  }
  await saveMapConfig(cfg);
  return NextResponse.json({ ok: true });
}
