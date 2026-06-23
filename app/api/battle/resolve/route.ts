import { NextRequest, NextResponse } from "next/server";
import { resolveBattle } from "@/lib/battle/engine";
import { isValidHex } from "@/lib/battle/hex";
import {
  STAT_BOUNDS,
  BOARD,
  DEFAULT_ATTACK_TYPE,
  SPELL_BOUNDS,
  MAX_SPELLS_PER_UNIT,
} from "@/lib/battle/types";
import type {
  AttackType,
  HexPosition,
  PartyMemberInput,
  ResolveRequest,
  SpellInput,
  UnitStats,
} from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE: accepting stats in the payload is a SANDBOX-only convenience (the party
// builder edits stats live). For production, send only characterIds + positions and
// look up authoritative stats server-side from character_battle_stats.

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

type StatKey = keyof typeof STAT_BOUNDS; // hp | attack | defense | actionSpeed | range

// Validate + clamp one numeric stat. Rejects non-finite / negative (NaN, Infinity,
// -1, ...); clamps in-range — notably capping actionSpeed (the `while (gauge>=100)`
// hang vector) at STAT_BOUNDS.actionSpeed.max.
function sanitizeStat(value: unknown, key: StatKey): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const { min, max } = STAT_BOUNDS[key];
  return clamp(value, min, max);
}

// Deploy hex must be an integer axial coord that exists on the board.
function sanitizePosition(pos: unknown): HexPosition | null {
  if (typeof pos !== "object" || pos === null) return null;
  const { q, r } = pos as Record<string, unknown>;
  if (typeof q !== "number" || !Number.isInteger(q)) return null;
  if (typeof r !== "number" || !Number.isInteger(r)) return null;
  const hex = { q, r };
  return isValidHex(hex) ? hex : null;
}

// Validate a member's spell list: drop invalid entries, dedupe by id, clamp
// power/cooldown, cap at MAX_SPELLS_PER_UNIT. Never throws / never fails the
// request — bad spells are simply omitted (mirrors the skills handling).
function sanitizeSpells(raw: unknown): SpellInput[] {
  if (!Array.isArray(raw)) return [];
  const out: SpellInput[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (out.length >= MAX_SPELLS_PER_UNIT) break;
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id || seen.has(o.id)) continue;
    if (o.type !== "attack") continue;
    if (typeof o.power !== "number" || !Number.isFinite(o.power)) continue;
    if (typeof o.cooldown !== "number" || !Number.isFinite(o.cooldown)) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      type: "attack",
      power: clamp(o.power, SPELL_BOUNDS.power.min, SPELL_BOUNDS.power.max),
      cooldown: clamp(o.cooldown, SPELL_BOUNDS.cooldown.min, SPELL_BOUNDS.cooldown.max),
      animationKey: typeof o.animationKey === "string" ? o.animationKey : "",
    });
  }
  return out;
}

// Returns a sanitized member, or an error string describing the rejection.
function sanitizeMember(raw: unknown): PartyMemberInput | string {
  if (typeof raw !== "object" || raw === null) return "member must be an object";
  const m = raw as Record<string, unknown>;

  if (typeof m.characterId !== "string" || m.characterId.length === 0) {
    return "member.characterId must be a non-empty string";
  }

  const position = sanitizePosition(m.position);
  if (!position) return `invalid deploy hex for ${m.characterId}`;

  if (typeof m.stats !== "object" || m.stats === null) {
    return `missing stats for ${m.characterId}`;
  }
  const s = m.stats as Record<string, unknown>;

  const hp = sanitizeStat(s.hp, "hp");
  const attack = sanitizeStat(s.attack, "attack");
  const defense = sanitizeStat(s.defense, "defense");
  const actionSpeed = sanitizeStat(s.actionSpeed, "actionSpeed");
  const range = sanitizeStat(s.range, "range");
  if (
    hp === null ||
    attack === null ||
    defense === null ||
    actionSpeed === null ||
    range === null
  ) {
    return `invalid stat (NaN/negative) for ${m.characterId}`;
  }

  const skills = Array.isArray(s.skills)
    ? s.skills.filter((x): x is string => typeof x === "string")
    : [];

  // attackType is the only non-numeric stat: accept the two valid literals;
  // anything missing/invalid defaults to melee (matches the engine's buildUnit).
  const attackType: AttackType =
    s.attackType === "melee" || s.attackType === "ranged"
      ? s.attackType
      : DEFAULT_ATTACK_TYPE;

  const stats: UnitStats = { hp, attack, defense, actionSpeed, range, skills, attackType };
  return {
    characterId: m.characterId,
    stats,
    position,
    spells: sanitizeSpells(m.spells),
  };
}

function sanitizeParty(
  raw: unknown,
  label: string,
  requiredRow: number,
): PartyMemberInput[] | string {
  if (!Array.isArray(raw)) return `${label} must be an array`;
  if (raw.length === 0) return `${label} party must not be empty`;
  if (raw.length > BOARD.maxPerSide) {
    return `${label} party exceeds ${BOARD.maxPerSide} units`;
  }
  const out: PartyMemberInput[] = [];
  for (const m of raw) {
    const member = sanitizeMember(m);
    if (typeof member === "string") return member;
    // Enforce deployment zones: players on BOARD.playerRow, enemies on BOARD.enemyRow.
    if (member.position.r !== requiredRow) {
      return `${label} unit ${member.characterId} must deploy on row ${requiredRow} (got r=${member.position.r})`;
    }
    out.push(member);
  }
  return out;
}

// Canonical order: by deploy hex, row (r) then column (q). Player-first ordering is
// applied by the engine (createBattle concatenates players before enemies), so a
// logically-identical request always resolves to the same ids and events.
function canonicalize(members: PartyMemberInput[]): PartyMemberInput[] {
  return [...members].sort((a, b) =>
    a.position.r !== b.position.r
      ? a.position.r - b.position.r
      : a.position.q - b.position.q,
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "expected an object" }, { status: 400 });
  }
  const { players: rawPlayers, enemies: rawEnemies } = body as Record<string, unknown>;

  const players = sanitizeParty(rawPlayers, "players", BOARD.playerRow);
  if (typeof players === "string") {
    return NextResponse.json({ error: players }, { status: 400 });
  }
  const enemies = sanitizeParty(rawEnemies, "enemies", BOARD.enemyRow);
  if (typeof enemies === "string") {
    return NextResponse.json({ error: enemies }, { status: 400 });
  }

  // Occupancy invariant at setup: no two units may share a deploy hex.
  const seen = new Set<string>();
  for (const m of [...players, ...enemies]) {
    const key = `${m.position.q},${m.position.r}`;
    if (seen.has(key)) {
      return NextResponse.json({ error: `duplicate deploy hex ${key}` }, { status: 400 });
    }
    seen.add(key);
  }

  const request: ResolveRequest = {
    players: canonicalize(players),
    enemies: canonicalize(enemies),
  };

  const result = resolveBattle(request);
  return NextResponse.json(result);
}
