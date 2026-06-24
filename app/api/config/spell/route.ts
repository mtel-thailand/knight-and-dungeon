import { NextRequest, NextResponse } from "next/server";
import { upsertSpell, deleteSpell } from "../db";
import type { SpellDef } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CMS write endpoint for the GLOBAL spell catalog (`spells`). Per-character
// ownership is written via POST /api/config/battle; both are surfaced read-only
// by GET /api/config. POST { spell: SpellDef } upserts a catalog entry;
// DELETE ?id=<id> removes it from the catalog and from every character owning it.
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
  const { spell } = body as { spell?: Partial<SpellDef> };
  if (
    !spell ||
    typeof spell.id !== "string" ||
    !spell.id ||
    typeof spell.name !== "string" ||
    !spell.name
  ) {
    return NextResponse.json(
      { ok: false, error: "spell.id and spell.name are required strings" },
      { status: 400 },
    );
  }
  // Coerce to a finite number (NaN/±Infinity → undefined → upsertSpell default/NULL).
  const fin = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  // Forward the FULL spell incl. the visual playback config. upsertSpell does an
  // ON CONFLICT replace of fps/scale/loop/duration/offsets/rotation, so omitting
  // any here NULLs out that saved field on every save — which silently dropped the
  // whole playback config (the "save doesn't persist" bug).
  upsertSpell({
    id: spell.id,
    name: spell.name,
    animationKey: typeof spell.animationKey === "string" ? spell.animationKey : null,
    type: spell.type === "attack" ? "attack" : undefined,
    power: fin(spell.power),
    cooldown: fin(spell.cooldown),
    fps: fin(spell.fps),
    scale: fin(spell.scale),
    loop: typeof spell.loop === "boolean" ? spell.loop : undefined,
    duration: fin(spell.duration),
    offsetX: fin(spell.offsetX),
    offsetY: fin(spell.offsetY),
    rotation: fin(spell.rotation),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing spell id" },
      { status: 400 },
    );
  }
  deleteSpell(id);
  return NextResponse.json({ ok: true });
}
