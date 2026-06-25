import { NextRequest, NextResponse } from "next/server";
import { upsertBattleReward, deleteBattleReward } from "../db";
import type { BattleRewardDef, BattleRewardEffect } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CMS write endpoint for the battle-reward catalog (`battle_rewards`).
// POST { reward: BattleRewardDef } upserts a catalog entry;
// DELETE ?id=<id> removes it.
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
  const { reward } = body as { reward?: Partial<BattleRewardDef> };
  if (
    !reward ||
    typeof reward.id !== "string" ||
    !reward.id ||
    typeof reward.name !== "string" ||
    !reward.name
  ) {
    return NextResponse.json(
      { ok: false, error: "reward.id and reward.name are required strings" },
      { status: 400 },
    );
  }
  const validEffects: BattleRewardEffect[] = ["atkPercent", "restoreHp", "defFlat"];
  const effect: BattleRewardEffect = validEffects.includes(reward.effect as BattleRewardEffect)
    ? (reward.effect as BattleRewardEffect)
    : "atkPercent";
  const effectValue =
    typeof reward.effectValue === "number" && Number.isFinite(reward.effectValue)
      ? Math.max(1, Math.min(10000, Math.floor(reward.effectValue)))
      : 10;
  upsertBattleReward({
    id: reward.id,
    name: reward.name,
    description: typeof reward.description === "string" ? reward.description : "",
    effect,
    effectValue,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing reward id" },
      { status: 400 },
    );
  }
  deleteBattleReward(id);
  return NextResponse.json({ ok: true });
}
