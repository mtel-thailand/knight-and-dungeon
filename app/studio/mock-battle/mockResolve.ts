import type {
  BattleEvent,
  HexPosition,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
  Team,
  UnitStats,
} from "@/lib/battle/types";
import { BATTLE_TICK, BOARD, MAX_BATTLE_TIME, STAT_BOUNDS } from "@/lib/battle/types";
import { getHexRowsFromCounts } from "../studioHelpers";

// =============================================================================
// SECTION > mockResolve: offline deterministic fallback simulator
// Seam (Phase 1 -> mockResolve.ts): mockResolve
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

function clampStats(s: UnitStats): UnitStats {
  const B = STAT_BOUNDS;
  return {
    hp: clamp(Math.round(s.hp), B.hp.min, B.hp.max),
    attack: clamp(Math.round(s.attack), B.attack.min, B.attack.max),
    defense: clamp(Math.round(s.defense), B.defense.min, B.defense.max),
    actionSpeed: clamp(s.actionSpeed, B.actionSpeed.min, B.actionSpeed.max),
    range: clamp(Math.round(s.range), B.range.min, B.range.max),
    skills: Array.isArray(s.skills) ? s.skills : [],
  };
}

const BOARD_ROWS = getHexRowsFromCounts([...BOARD.rowCounts]);

function genHexes(): HexPosition[] {
  const cR = (BOARD_ROWS.length - 1) / 2;
  const out: HexPosition[] = [];
  BOARD_ROWS.forEach((cols, ri) => {
    const r = ri - cR;
    cols.forEach((q) => out.push({ q, r }));
  });
  return out;
}

/**
 * Deterministic stand-in for the engine (Lane A/C). Gauge-based ticks: faster
 * units act more often; melee closes the gap then trades blows; shield_bash adds
 * a push. Emits move/attack/skill/death/end and intentionally shares one `t`
 * across an attack and the death it causes — exercising the replayer's
 * "preserve emitted order within equal t" path.
 */
export function mockResolve(req: ResolveRequest): ResolveResult {
  type SU = {
    id: string;
    team: Team;
    characterId: string;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    actionSpeed: number;
    range: number;
    skills: string[];
    q: number;
    r: number;
    gauge: number;
    cd: Record<string, number>;
    dead: boolean;
  };

  const mk = (m: PartyMemberInput, team: Team, i: number): SU => {
    const s = clampStats(m.stats);
    return {
      id: `${team === "player" ? "p" : "e"}${i}`,
      team,
      characterId: m.characterId,
      hp: s.hp,
      maxHp: s.hp,
      attack: s.attack,
      defense: s.defense,
      actionSpeed: s.actionSpeed,
      range: s.range,
      skills: s.skills,
      q: m.position.q,
      r: m.position.r,
      gauge: 0,
      cd: {},
      dead: false,
    };
  };

  const units: SU[] = [
    ...req.players.map((m, i) => mk(m, "player", i)),
    ...req.enemies.map((m, i) => mk(m, "enemy", i)),
  ];

  const initialUnits = units.map((u) => ({
    id: u.id,
    team: u.team,
    characterId: u.characterId,
    position: { q: u.q, r: u.r },
    hp: u.hp,
    maxHp: u.maxHp,
  }));

  const events: BattleEvent[] = [];
  const dist = (a: SU, b: SU) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
  const aliveOf = (team: Team) => units.filter((u) => !u.dead && u.team === team);

  let t = 0;
  let guard = 0;
  while (
    t < MAX_BATTLE_TIME &&
    aliveOf("player").length > 0 &&
    aliveOf("enemy").length > 0 &&
    guard < 600
  ) {
    for (const u of units) if (!u.dead) u.gauge += u.actionSpeed * BATTLE_TICK;

    for (const u of units) {
      if (u.dead || u.gauge < 100) continue;
      if (aliveOf("player").length === 0 || aliveOf("enemy").length === 0) break;
      u.gauge -= 100;

      const foes = units
        .filter((f) => !f.dead && f.team !== u.team)
        .sort((a, b) => dist(u, a) - dist(u, b) || (a.id < b.id ? -1 : 1));
      const target = foes[0];
      if (!target) break;

      if (dist(u, target) <= u.range) {
        const useSkill =
          u.skills.includes("shield_bash") && (u.cd["shield_bash"] ?? 0) <= t;
        if (useSkill) {
          const dmg = Math.max(1, Math.round(u.attack * 1.6 - target.defense));
          target.hp = Math.max(0, target.hp - dmg);
          u.cd["shield_bash"] = t + 3;
          const from = { q: target.q, r: target.r };
          const backRow = target.team === "enemy" ? BOARD.enemyRow : BOARD.playerRow;
          target.r = clamp(
            target.r + Math.sign(backRow - target.r || 1),
            BOARD.enemyRow,
            BOARD.playerRow,
          );
          const to = { q: target.q, r: target.r };
          const moved = from.q !== to.q || from.r !== to.r;
          events.push({
            t,
            kind: "skill",
            skillId: "shield_bash",
            sourceId: u.id,
            targetId: target.id,
            damage: dmg,
            targetHp: target.hp,
            push: moved ? { from, to } : undefined,
          });
        } else {
          const dmg = Math.max(1, Math.round(u.attack - target.defense));
          target.hp = Math.max(0, target.hp - dmg);
          events.push({
            t,
            kind: "attack",
            sourceId: u.id,
            targetId: target.id,
            damage: dmg,
            targetHp: target.hp,
          });
        }
        if (target.hp <= 0 && !target.dead) {
          target.dead = true;
          // Same `t` as the blow above — emitted AFTER it on purpose.
          events.push({ t, kind: "death", unitId: target.id });
        }
      } else {
        const from = { q: u.q, r: u.r };
        if (u.r !== target.r) u.r += Math.sign(target.r - u.r);
        else if (u.q !== target.q) u.q += Math.sign(target.q - u.q);
        const to = { q: u.q, r: u.r };
        if (from.q !== to.q || from.r !== to.r)
          events.push({ t, kind: "move", unitId: u.id, from, to });
      }
    }

    t = Math.round((t + BATTLE_TICK) * 1000) / 1000;
    guard++;
  }

  const pAlive = aliveOf("player").length;
  const eAlive = aliveOf("enemy").length;
  let result: "win" | "lose" | "draw";
  if (pAlive > 0 && eAlive === 0) result = "win";
  else if (pAlive === 0 && eAlive > 0) result = "lose";
  else {
    const pHp = units
      .filter((u) => u.team === "player")
      .reduce((n, u) => n + u.hp, 0);
    const eHp = units
      .filter((u) => u.team === "enemy")
      .reduce((n, u) => n + u.hp, 0);
    result = pHp > eHp ? "win" : eHp > pHp ? "lose" : "draw";
  }
  events.push({ t, kind: "end", result });

  return {
    result,
    initialState: { hexes: genHexes(), units: initialUnits },
    events,
  };
}
