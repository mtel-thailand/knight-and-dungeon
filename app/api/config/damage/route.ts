import { NextRequest, NextResponse } from "next/server";
import { saveDamageConfig } from "../db";
import { DEFAULT_DAMAGE_CONFIG, DAMAGE_BOUNDS } from "@/lib/battle/types";
import type { DamageConfig } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Persist the mock-battle floating damage-number config. Body is a partial/full
// DamageConfig JSON object; each known field is taken from the body when it's a
// finite number (clamped to DAMAGE_BOUNDS), else falls back to the default — so
// missing/unknown fields can't corrupt the stored config. Mirrors the writer
// style of POST /api/config/map.
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
      { ok: false, error: "expected a DamageConfig object" },
      { status: 400 },
    );
  }
  const raw = body as Record<string, unknown>;
  const cfg = {} as DamageConfig;
  for (const key of Object.keys(DEFAULT_DAMAGE_CONFIG) as (keyof DamageConfig)[]) {
    const value = raw[key];
    const [min, max] = DAMAGE_BOUNDS[key];
    cfg[key] =
      typeof value === "number" && Number.isFinite(value)
        ? clamp(value, min, max)
        : DEFAULT_DAMAGE_CONFIG[key];
  }
  saveDamageConfig(cfg);
  return NextResponse.json({ ok: true });
}
