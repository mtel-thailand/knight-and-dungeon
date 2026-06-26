import { NextRequest, NextResponse } from "next/server";
import {
  upsertCampaign,
  deleteCampaign,
  setActiveCampaign,
} from "@/lib/db";
import { CAMPAIGN_BOUNDS } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CMS write endpoint for the campaign catalog (`campaigns`).
// POST { campaign: { id, name, waveCount, monsterPool } } upserts a campaign
// (does NOT touch is_active).
// POST { activeId: string | null } sets the active campaign (deactivates all
// others first — pass null to clear).
// DELETE ?id=<id> removes a campaign.
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

  const b = body as Record<string, unknown>;

  // Activation toggle — distinct from campaign upsert.
  if (b.activeId !== undefined) {
    await setActiveCampaign(
      b.activeId === null ? null : String(b.activeId),
    );
    return NextResponse.json({ ok: true });
  }

  // Campaign upsert.
  const { campaign } = b as { campaign?: Record<string, unknown> };
  if (
    !campaign ||
    typeof campaign.id !== "string" ||
    !campaign.id ||
    typeof campaign.name !== "string" ||
    !campaign.name
  ) {
    return NextResponse.json(
      { ok: false, error: "campaign.id and campaign.name are required strings" },
      { status: 400 },
    );
  }

  const waveCount = Math.min(
    CAMPAIGN_BOUNDS.waveCount.max,
    Math.max(
      CAMPAIGN_BOUNDS.waveCount.min,
      Math.floor(Number(campaign.waveCount) || 1),
    ),
  );

  const monsterPool = Array.isArray(campaign.monsterPool)
    ? (campaign.monsterPool as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  await upsertCampaign({
    id: campaign.id,
    name: campaign.name,
    waveCount,
    monsterPool,
    spawnCount:
      typeof campaign.spawnCount === "number"
        ? Math.max(0, Math.min(20, Math.floor(campaign.spawnCount)))
        : undefined,
    difficulty:
      typeof campaign.difficulty === "number"
        ? Math.max(1, Math.min(3, Math.floor(campaign.difficulty)))
        : undefined,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing campaign id" },
      { status: 400 },
    );
  }
  await deleteCampaign(id);
  return NextResponse.json({ ok: true });
}
