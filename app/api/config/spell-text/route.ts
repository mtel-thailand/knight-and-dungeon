import { NextRequest, NextResponse } from "next/server";
import { saveSpellTextConfig } from "@/lib/db";
import { DEFAULT_SPELL_TEXT_CONFIG, SPELL_TEXT_BOUNDS } from "@/lib/battle/types";
import type { SpellTextConfig } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
      { ok: false, error: "expected a SpellTextConfig object" },
      { status: 400 },
    );
  }
  const raw = body as Record<string, unknown>;
  const cfg = {} as SpellTextConfig;
  for (const key of Object.keys(DEFAULT_SPELL_TEXT_CONFIG) as (keyof SpellTextConfig)[]) {
    const value = raw[key];
    const [min, max] = SPELL_TEXT_BOUNDS[key];
    cfg[key] =
      typeof value === "number" && Number.isFinite(value)
        ? clamp(value, min, max)
        : DEFAULT_SPELL_TEXT_CONFIG[key];
  }
  await saveSpellTextConfig(cfg);
  return NextResponse.json({ ok: true });
}
