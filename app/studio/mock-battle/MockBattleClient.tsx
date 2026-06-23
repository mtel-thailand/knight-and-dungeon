"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BattleEvent,
  BattleEventRole,
  CharacterRoleMap,
  DamageConfig as DamageCfg,
  HexPosition,
  MapConfig,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
  Team,
  UnitStats,
} from "@/lib/battle/types";
import { BATTLE_TICK, BOARD, DEFAULT_DAMAGE_CONFIG, MAX_BATTLE_TIME, STAT_BOUNDS } from "@/lib/battle/types";
import { isoPos, isoHex, getHexRowsFromCounts } from "../studioHelpers";
import GameScreenShell from "./GameScreenShell";
import { Jersey_25 } from "next/font/google";

// Pixel display font for the floating damage numbers (self-hosted via next/font,
// so no external request). next/font hashes the family name — always reference it
// through `dmgFont.style.fontFamily`, never a literal "Jersey 25".
const dmgFont = Jersey_25({ weight: "400", subsets: ["latin"], display: "swap" });

/* ------------------------------------------------------------------ *
 * Constants & small helpers
 * ------------------------------------------------------------------ */

/** Pixi ticker FPS — AnimatedSprite.animationSpeed is frames-per-tick (mirrors StudioClient). */
const TICKER_FPS = 60;
/** Looping idle clip length in seconds. */
const IDLE_DUR = 0.9;
// Awaited gameplay beats are bound under the ~0.25s action cadence; gaps are separate.
const MOVE_MS = 240;
const ATTACK_MS = 220;
const HIT_MS = 180;
const DEATH_MS = 260;
const KNOCKBACK_MS = 200;
const HPBAR_MS = 180;
const INTER_BEAT_MS = 80; // breathing room between equal-`t` beats

/** 2:1 isometric tile ratio (tile height = tile width * ISO_RATIO), matching the studio iso grid. */
const ISO_RATIO = 0.5;

// The floating damage-number config (DamageCfg) + its defaults now live in the
// shared contract (lib/battle/types.ts) so the server can persist them; the
// live values are read from `dmgCfgRef` by `spawnDamage` at spawn time (the
// size/offset fields are × the live tile size — see DEFAULT_DAMAGE_CONFIG).

/** Map-config defaults (mirror the server's GET /api/config fallback). */
const DEFAULT_MAP: MapConfig = {
  tileWidth: 72,
  tileHeightRatio: 0.5,
  scale: 1,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
};
/** Server-enforced bounds; UI ranges align so input isn't silently clamped. */
const MAP_BOUNDS = {
  tileWidth: { min: 16, max: 400 },
  tileHeightRatio: { min: 0.1, max: 1 },
  scale: { min: 0.25, max: 4 },
  rotation: { min: -180, max: 180 },
  rotationX: { min: -80, max: 80 },
  rotationY: { min: -80, max: 80 },
} as const;

const KNOWN_SKILLS: { id: string; name: string }[] = [
  { id: "shield_bash", name: "Shield Bash" },
];

const DEFAULT_STATS: UnitStats = {
  hp: 120,
  attack: 24,
  defense: 6,
  actionSpeed: 100,
  range: 1,
  skills: [],
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutQuad = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

function lerpColor(a: number, b: number, t: number): number {
  t = clamp(t, 0, 1);
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/** HP-bar color ramps red -> amber -> green as the ratio rises. */
function hpColor(r: number): number {
  r = clamp(r, 0, 1);
  return r > 0.5
    ? lerpColor(0xe0c84a, 0x57e08a, (r - 0.5) * 2)
    : lerpColor(0xe05a5a, 0xe0c84a, r * 2);
}

// Board deploy geometry, derived once from the shared [5,6,7,6,5] shape. A builder
// `slot` is a 0..maxPerSide-1 INDEX into a side's deploy row, NOT a raw q — the
// hexagon's two outer rows sit at different q-ranges, so each side maps its slots
// through its own row here.
const BOARD_ROWS = getHexRowsFromCounts([...BOARD.rowCounts]);
const DEPLOY_QS: Record<Team, number[]> = {
  player: BOARD_ROWS[BOARD_ROWS.length - 1],
  enemy: BOARD_ROWS[0],
};
const deployHex = (team: Team, slot: number): HexPosition => ({
  q: DEPLOY_QS[team][slot],
  r: team === "player" ? BOARD.playerRow : BOARD.enemyRow,
});

/** Every deploy/transit hex on the board, used when a snapshot omits `hexes`. */
function genHexes(): HexPosition[] {
  const cR = (BOARD_ROWS.length - 1) / 2;
  const out: HexPosition[] = [];
  BOARD_ROWS.forEach((cols, ri) => {
    const r = ri - cR;
    cols.forEach((q) => out.push({ q, r }));
  });
  return out;
}

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

/* ------------------------------------------------------------------ *
 * Bootstrap config shape (from GET /api/config). battleStats/roleMaps
 * are read defensively — they may not be surfaced yet (Lane B).
 * ------------------------------------------------------------------ */

type RosterChar = { id: string; name: string };

type BootstrapConfig = {
  characters: RosterChar[];
  animations: any[]; // catalog rows {key,label,image,frameData,deriveFrom,reverse}
  actions: Record<string, any[]>; // per-character authored Actions
  characterAnimations?: Record<string, string[]>;
  characterSeed?: Record<string, { animations: Record<string, unknown> }>;
  characterConfigs?: Record<
    string,
    { tint?: number; scaleX?: number; scaleY?: number }
  >;
  battleStats?: Record<string, UnitStats>;
  roleMaps?: Record<string, CharacterRoleMap>;
  mapConfig?: MapConfig;
  damageConfig?: DamageCfg;
};

function normalizeConfig(data: any): BootstrapConfig {
  return {
    characters: Array.isArray(data?.characters) ? data.characters : [],
    animations: Array.isArray(data?.animations) ? data.animations : [],
    actions: data?.actions ?? {},
    characterAnimations: data?.characterAnimations ?? {},
    characterSeed: data?.characterSeed ?? {},
    characterConfigs: data?.characterConfigs ?? {},
    battleStats: data?.battleStats ?? {},
    roleMaps: data?.roleMaps ?? {},
    mapConfig: data?.mapConfig ?? { ...DEFAULT_MAP },
    damageConfig: data?.damageConfig ?? { ...DEFAULT_DAMAGE_CONFIG },
  };
}

/** Display name for a character id with no roster entry (e.g. "knight" -> "Knight"). */
function prettifyId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Playable roster = characters that have seeded battle stats (knight, john, ...).
 * Names come from the roster blob when present, else are derived from the id.
 * Falls back to the plain character list if no battle stats are surfaced yet.
 */
function buildRoster(cfg: BootstrapConfig): RosterChar[] {
  const statIds = Object.keys(cfg.battleStats ?? {});
  const ids = statIds.length ? statIds : cfg.characters.map((c) => c.id);
  return ids.map((id) => ({
    id,
    name: cfg.characters.find((c) => c.id === id)?.name ?? prettifyId(id),
  }));
}

/* ------------------------------------------------------------------ *
 * Resolve: live POST with a local mock fallback (scaffold + resilience).
 * ------------------------------------------------------------------ */

type ResolveOutcome =
  | { ok: true; result: ResolveResult; mocked: boolean }
  | { ok: false; error: string };

async function requestResolve(req: ResolveRequest): Promise<ResolveOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/battle/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    // Network failure / route unreachable -> deterministic mock so the replayer
    // still demonstrates end-to-end.
    return { ok: true, result: mockResolve(req), mocked: true };
  }
  if (res.ok) {
    return { ok: true, result: (await res.json()) as ResolveResult, mocked: false };
  }
  if (res.status >= 400 && res.status < 500) {
    // Validation / client error -> surface the route's message (no silent mock).
    let error = `Battle request rejected (${res.status}).`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") error = body.error;
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, error };
  }
  // 5xx server error -> mock fallback.
  return { ok: true, result: mockResolve(req), mocked: true };
}

/**
 * Deterministic stand-in for the engine (Lane A/C). Gauge-based ticks: faster
 * units act more often; melee closes the gap then trades blows; shield_bash adds
 * a push. Emits move/attack/skill/death/end and intentionally shares one `t`
 * across an attack and the death it causes — exercising the replayer's
 * "preserve emitted order within equal t" path.
 */
function mockResolve(req: ResolveRequest): ResolveResult {
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

/* ------------------------------------------------------------------ *
 * BattleStage — the PixiJS replayer.
 *
 * Reuses the StudioClient lifecycle contract: `await import('pixi.js')` +
 * Application.init (StudioClient:46-67), the Spritesheet/frames loader with
 * deriveFrom/reverse (122-159), the previewGenId generation-cancel pattern
 * (1094/1110/1114/1157) for re-fight, the AnimatedSprite play/onComplete pattern
 * from previewAction (1107-1193), and the destroyed-guard + cleanup (2092-2107).
 * ------------------------------------------------------------------ */

const ROLE_PATTERNS: Record<BattleEventRole, RegExp> = {
  idle: /idle|ready|stand|breath/i,
  move: /move|run|walk|jump|dash|step|advance/i,
  attack: /attack|swing|slash|chop|thrust|stab|spell|cast|bash|shoot|punch|strike/i,
  hit: /\bhit\b|hurt|flinch|stagger|damage|take/i,
  death: /death|defeat|die|dead|\bko\b|fall|collapse/i,
};

type SpriteUnit = {
  id: string;
  team: Team;
  characterId: string;
  node: any; // Container
  body: any; // AnimatedSprite | Graphics
  hasArt: boolean;
  absScale: number;
  baseTint: number;
  dispH: number;
  barBg: any;
  accent: any;
  hpFill: any;
  maxHp: number;
  hp: number;
  q: number;
  r: number;
  dead: boolean;
};

type StageProps = {
  result: ResolveResult;
  config: BootstrapConfig;
  controlsRef: React.MutableRefObject<{ replay: () => void } | null>;
  // Live damage-number config. A stable ref (never in the effect deps) so the
  // panel can retune numbers mid-battle without tearing down the Pixi app.
  dmgCfgRef: React.MutableRefObject<DamageCfg>;
  // Repaint hook: the effect points this at its redrawHealthBars() so the panel
  // can re-geometry the HP bars live (same stable-ref pattern as dmgCfgRef).
  redrawHealthBarsRef: React.MutableRefObject<() => void>;
  // Live board-view config + the effect's apply hook (same bridge pattern): the
  // panel mutates mapCfgRef and calls applyMapRef() to re-layout the board live,
  // without tearing down the Pixi app.
  mapCfgRef: React.MutableRefObject<MapConfig>;
  applyMapRef: React.MutableRefObject<() => void>;
  // Show-grid bridge: showGridRef seeds grid.visible on (re)build; gridVisibleRef
  // is the effect's live setter the panel calls to toggle the hex floor.
  showGridRef: React.MutableRefObject<boolean>;
  gridVisibleRef: React.MutableRefObject<((v: boolean) => void) | null>;
  onReady: () => void;
  onEnd: (r: "win" | "lose" | "draw") => void;
};

function BattleStage({
  result,
  config,
  controlsRef,
  dmgCfgRef,
  redrawHealthBarsRef,
  mapCfgRef,
  applyMapRef,
  showGridRef,
  gridVisibleRef,
  onReady,
  onEnd,
}: StageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;
    let pixiApp: any = null;
    let wrapper: HTMLDivElement | null = null;
    let destroyed = false;
    let genId = 0; // previewGenId-style cancel token
    const cleanups: Array<() => void> = [];

    async function init() {
      const { Application, Assets, AnimatedSprite, Graphics, Spritesheet, Text, Container } =
        (await import("pixi.js")) as any;
      if (destroyed) return;

      wrapper = document.createElement("div");
      wrapper.style.cssText = "position:absolute; inset:0;";
      container.appendChild(wrapper);

      pixiApp = new Application();
      await pixiApp.init({
        resizeTo: wrapper,
        backgroundAlpha: 0,
        antialias: true,
        // Render at the device pixel ratio (crisp text/vectors on HiDPI); without
        // this the canvas rasterizes at 1x and is CSS-upscaled -> blurry.
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (destroyed) {
        pixiApp.destroy();
        return;
      }
      wrapper.appendChild(pixiApp.canvas);

      // Load the pixel display font before any Pixi text is rasterized — canvas
      // text doesn't trigger the CSS @font-face fetch, so without this the first
      // damage numbers would flash in the fallback font (and never re-render).
      try {
        await document.fonts.load(`400 32px ${dmgFont.style.fontFamily}`);
      } catch {
        /* fall back to the default font */
      }
      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      // ---- Frames: build once, share Texture[] across every unit (122-159) ----
      const catalog: any[] = config.animations ?? [];
      const framesByKey: Record<string, any[]> = {};
      // Load every sheet's PNG + parse its frames CONCURRENTLY. Pixi's Assets
      // queue de-dupes/parallelizes the network+decode, so this overlaps what
      // used to be a strictly sequential await-per-row — the slow part of the
      // pre-battle load. Failures stay isolated per row.
      await Promise.all(
        catalog.map(async (c) => {
          if (!c.image || !c.frameData) return;
          try {
            const texture = await Assets.load(`/assets/${c.image}`);
            if (destroyed) return;
            const sheet = new Spritesheet(texture, c.frameData);
            await sheet.parse();
            framesByKey[c.key] = Object.keys(sheet.data.frames).map(
              (n: string) => sheet.textures[n],
            );
          } catch (err) {
            console.error(`mock-battle: spritesheet "${c.key}" failed`, err);
          }
        }),
      );
      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      const derivedCache: Record<string, any[]> = {};
      function framesForKey(key: string): any[] {
        if (framesByKey[key]) return framesByKey[key];
        if (derivedCache[key]) return derivedCache[key];
        const c = catalog.find((x) => x.key === key);
        if (c?.deriveFrom) {
          const base = framesByKey[c.deriveFrom] ?? [];
          const f = c.reverse ? [...base].reverse() : base.slice();
          derivedCache[key] = f;
          return f;
        }
        return [];
      }

      // ---- Action resolution (the core binding) ----
      // An Action = { id, name, steps[] }; an animation step references a base
      // animation by key and trims [startFrame..endFrame] (StudioClient:180-189,
      // played exactly like previewAction 1107-1193).
      function migrateAction(raw: any): {
        id: string;
        name: string;
        steps: any[];
      } {
        if (Array.isArray(raw?.steps)) return raw;
        return {
          id: raw?.id,
          name: raw?.name,
          steps: (raw?.animationKeys ?? []).map((k: string) => ({
            type: "animation",
            animationKey: k,
            duration: 1,
          })),
        };
      }
      const actionsFor = (charId: string) =>
        (config.actions?.[charId] ?? []).map(migrateAction);

      function ownedKeys(charId: string): string[] {
        const fromBlob = config.characterAnimations?.[charId];
        const fromSeed = config.characterSeed?.[charId]?.animations
          ? Object.keys(config.characterSeed[charId].animations)
          : [];
        const keys = fromBlob && fromBlob.length ? fromBlob : fromSeed;
        return keys.filter((k) => framesForKey(k).length > 0);
      }
      // First resolvable frame from an explicit role-map value (Action id or raw
      // animation key) — lets a character whose art is reachable only via the
      // role map (e.g. knight) still produce a base pose / count as having art.
      function firstFrameOfMapped(charId: string): any | null {
        const rm = config.roleMaps?.[charId];
        if (!rm) return null;
        for (const role of [
          "idle",
          "move",
          "attack",
          "hit",
          "death",
        ] as BattleEventRole[]) {
          const v = rm[role];
          if (!v) continue;
          const action = actionsFor(charId).find((a) => a.id === v);
          if (action) {
            const f = flattenAction(action);
            if (f.length) return f[0];
          }
          const all = framesForKey(v);
          if (all.length) return all[0];
        }
        return null;
      }
      const basePoseCache: Record<string, any | null> = {};
      function basePose(charId: string): any | null {
        if (charId in basePoseCache) return basePoseCache[charId];
        const k = ownedKeys(charId)[0];
        let frame = k ? framesForKey(k)[0] ?? null : null;
        if (!frame) frame = firstFrameOfMapped(charId);
        basePoseCache[charId] = frame;
        return frame;
      }

      function flattenAction(action: { steps: any[] }): any[] {
        const out: any[] = [];
        for (const step of action.steps) {
          if (step?.type !== "animation") continue;
          const all = framesForKey(step.animationKey);
          if (!all.length) continue;
          const sf = clamp(step.startFrame ?? 0, 0, all.length - 1);
          const ef = clamp(step.endFrame ?? all.length - 1, sf, all.length - 1);
          for (let i = sf; i <= ef; i++) out.push(all[i]);
        }
        return out;
      }

      const clipCache: Record<string, Partial<Record<BattleEventRole, any[]>>> = {};
      function clipForRole(charId: string, role: BattleEventRole): any[] {
        const cc = (clipCache[charId] ??= {});
        if (cc[role]) return cc[role]!;
        let frames: any[] = [];

        // An explicit role-map value may be an authored Action id OR a raw
        // animation catalog key — honor whichever it is before falling back to
        // inference, then base-pose.
        const mappedId = config.roleMaps?.[charId]?.[role];

        // (a) value -> an authored Action id in actions[charId]
        if (mappedId) {
          const action = actionsFor(charId).find((a) => a.id === mappedId);
          if (action) frames = flattenAction(action);
        }
        // (b) value -> a raw animation catalog key (CMS can map a role straight
        //     to an animation; that explicit choice must be played, not inferred)
        if (!frames.length && mappedId) {
          const all = framesForKey(mappedId);
          if (all.length) frames = all;
        }
        // (c) infer an Action by name/id
        if (!frames.length) {
          const pat = ROLE_PATTERNS[role];
          const action = actionsFor(charId).find(
            (a) => pat.test(a.name ?? "") || pat.test(a.id ?? ""),
          );
          if (action) frames = flattenAction(action);
        }
        // (c cont.) infer a raw animation key for the role
        if (!frames.length) {
          const pat = ROLE_PATTERNS[role];
          const key =
            ownedKeys(charId).find((k) => pat.test(k)) ??
            (role === "idle" || role === "move" || role === "attack"
              ? ownedKeys(charId)[0]
              : undefined);
          if (key) {
            const all = framesForKey(key);
            if (all.length)
              frames = role === "idle" || role === "move" ? [all[0]] : all;
          }
        }
        // (d) base-pose freeze for idle/move
        if (!frames.length && (role === "idle" || role === "move")) {
          const bp = basePose(charId);
          if (bp) frames = [bp];
        }
        cc[role] = frames;
        return frames;
      }

      // ---- Board layout (axial -> pixel), centered & fit to canvas ----
      const hexes =
        result.initialState?.hexes && result.initialState.hexes.length
          ? result.initialState.hexes
          : genHexes();
      // ---- Board layout: isometric HEX tiles, live-configurable W / H / Scale ----
      // The logical grid is the fixed [5,6,7,6,5] hex arena (engine BOARD + deploy rows). W reshapes tile
      // width, H the vertical squash; Scale zooms the whole board. Sprite sizing is
      // pinned to the initial fit (TW0) so units stay readable while tweaking.
      const fitW = (() => {
        let nX = Infinity,
          xX = -Infinity,
          nY = Infinity,
          xY = -Infinity;
        for (const h of hexes) {
          const p = isoPos(h.q, h.r, 1, ISO_RATIO);
          nX = Math.min(nX, p.x - 0.5);
          xX = Math.max(xX, p.x + 0.5);
          nY = Math.min(nY, p.y - ISO_RATIO / 2);
          xY = Math.max(xY, p.y + ISO_RATIO / 2);
        }
        return clamp(
          Math.min(
            (pixiApp.screen.width * 0.9) / (xX - nX),
            (pixiApp.screen.height * 0.58) / (xY - nY),
          ),
          48,
          190,
        );
      })();
      const TW0 = fitW; // sprite-build reference (units scaled to live tileW)
      const BODY_H = TW0 * 1.3;
      // HP-bar height/gap and the damage stroke are authored in px at the default
      // tile (DEFAULT_MAP.tileWidth). Scale them into the TW0 build-frame so, after
      // the node's k = tileW/TW0 scale, they track the board zoom uniformly (like
      // the ×TW0 sizes) instead of riding k — which distorted them once the board
      // no longer fit ~1:1 (e.g. inside the portrait shell's smaller center band).
      const pxScale = TW0 / DEFAULT_MAP.tileWidth;

      // Live, persisted view config (loaded from GET /api/config -> mapConfig).
      const mc = config.mapConfig ?? DEFAULT_MAP;
      let tileW = clamp(mc.tileWidth, MAP_BOUNDS.tileWidth.min, MAP_BOUNDS.tileWidth.max);
      let ratio = clamp(
        mc.tileHeightRatio,
        MAP_BOUNDS.tileHeightRatio.min,
        MAP_BOUNDS.tileHeightRatio.max,
      );
      let boardScale = clamp(mc.scale, MAP_BOUNDS.scale.min, MAP_BOUNDS.scale.max);
      let rotDeg = clamp(mc.rotation, MAP_BOUNDS.rotation.min, MAP_BOUNDS.rotation.max);
      let rotRad = (rotDeg * Math.PI) / 180;
      let rotXDeg = clamp(mc.rotationX, MAP_BOUNDS.rotationX.min, MAP_BOUNDS.rotationX.max);
      let rotYDeg = clamp(mc.rotationY, MAP_BOUNDS.rotationY.min, MAP_BOUNDS.rotationY.max);
      let rotXRad = (rotXDeg * Math.PI) / 180;
      let rotYRad = (rotYDeg * Math.PI) / 180;

      // Outer viewport applies the pseudo-3D tilt (pitch/yaw foreshorten) + zoom
      // OUTSIDE the in-plane Z-rotation, so units can counter just rotation +
      // foreshorten (no shear) and read as upright billboards.
      const viewport = new Container();
      pixiApp.stage.addChild(viewport);
      const board = new Container();
      viewport.addChild(board);
      const sprites: Record<string, SpriteUnit> = {};
      const initialById: Record<string, { q: number; r: number }> = {};

      const pixelOf = (q: number, r: number) =>
        isoPos(q, r, tileW, tileW * ratio);

      function centerBoard() {
        const hw = tileW / 2;
        const hh = (tileW * ratio) / 2;
        let nX = Infinity,
          xX = -Infinity,
          nY = Infinity,
          xY = -Infinity;
        for (const h of hexes) {
          const p = pixelOf(h.q, h.r);
          nX = Math.min(nX, p.x - hw);
          xX = Math.max(xX, p.x + hw);
          nY = Math.min(nY, p.y - hh);
          xY = Math.max(xY, p.y + hh);
        }
        // Board: in-plane Z-rotation around its local center (the ground plane).
        board.pivot.set((nX + xX) / 2, (nY + xY) / 2);
        board.position.set(0, 0);
        board.scale.set(1);
        board.rotation = rotRad;
        // Viewport: overall zoom + pitch/yaw foreshorten, around the screen center.
        viewport.pivot.set(0, 0);
        viewport.rotation = 0;
        viewport.scale.set(
          boardScale * Math.cos(rotYRad),
          boardScale * Math.cos(rotXRad),
        );
        // Bottom-anchor the board to the center band: drop it so the front-most
        // tile edge rests just inside the bottom border (the Pixi host fills
        // .gss-center-field, so screen.height === that band's bottom), leaving
        // the headroom above for the upright units instead of dead space below.
        // The board's lowest point lies (|halfW·sinθ| + |halfH·cosθ|) below its
        // pivot in board space (θ = the in-plane Z-rotation); the viewport's
        // vertical zoom (boardScale·cos(pitch), matching scale.y above) converts
        // that to screen px.
        const halfW = (xX - nX) / 2;
        const halfH = (xY - nY) / 2;
        const bottomDrop =
          (Math.abs(halfW * Math.sin(rotRad)) +
            Math.abs(halfH * Math.cos(rotRad))) *
          boardScale *
          Math.cos(rotXRad);
        const BOTTOM_INSET = 8; // so the inner ring/vignette doesn't clip the edge
        viewport.position.set(
          pixiApp.screen.width / 2,
          pixiApp.screen.height - BOTTOM_INSET - bottomDrop,
        );
      }

      // Iso hex floor — player row cool, enemy row warm, transit rows neutral.
      // `grid` is a sibling of `unitsLayer` under `board`, so toggling its
      // visibility hides ONLY the tiles — units/HP bars/damage numbers stay.
      const grid = new Graphics();
      board.addChild(grid);
      grid.visible = showGridRef.current; // seed from the live toggle on (re)build
      gridVisibleRef.current = (v: boolean) => {
        grid.visible = v;
      };
      function drawGrid() {
        const th = tileW * ratio;
        grid.clear();
        for (const h of hexes) {
          const { x, y } = pixelOf(h.q, h.r);
          grid.poly(isoHex(x, y, tileW * 0.94, th * 0.94).flat());
          const fill =
            h.r === BOARD.playerRow
              ? 0x163a4a
              : h.r === BOARD.enemyRow
                ? 0x46202e
                : 0x1a2030;
          grid.fill({ color: fill, alpha: 0.55 });
          grid.stroke({ color: 0x6fb7d6, width: 1.5, alpha: 0.2 });
        }
      }
      drawGrid();

      // Depth-sorted unit layer (farther rows render behind nearer ones).
      const unitsLayer = new Container();
      unitsLayer.sortableChildren = true;
      board.addChild(unitsLayer);
      // Depth by SCREEN-y (project the board-local position through the current
      // rotation) so stacking stays correct at any view angle.
      const depthTick = () => {
        if (destroyed) return;
        const cs = Math.cos(rotRad);
        const sn = Math.sin(rotRad);
        const px = board.pivot.x;
        const py = board.pivot.y;
        for (const id of Object.keys(sprites)) {
          const su = sprites[id];
          su.node.zIndex = (su.node.x - px) * sn + (su.node.y - py) * cs;
        }
      };
      pixiApp.ticker.add(depthTick);

      // Re-fit + re-place units for the current W/H/Rotation. Units are uniformly
      // scaled to the live tile and counter-rotated so sprites/HP bars stay upright.
      function relayout() {
        drawGrid();
        const k = tileW / TW0;
        const isx = 1 / Math.cos(rotYRad); // counter yaw foreshorten
        const isy = 1 / Math.cos(rotXRad); // counter pitch foreshorten
        for (const id of Object.keys(sprites)) {
          const su = sprites[id];
          const p = pixelOf(su.q, su.r);
          su.node.position.set(p.x, p.y);
          su.node.rotation = -rotRad;
          su.node.scale.set(k * isx, k * isy); // upright, unsquashed billboard
        }
        centerBoard();
      }
      centerBoard();

      // Paint/repaint a unit's three HP-bar graphics (bg, team accent, fill)
      // from the LIVE display config (dmgCfgRef). Defaults reproduce the
      // original bar exactly: barW = TW0*0.95, barH = 6, barY = -dispH - 12.
      // Called at build time and by redrawHealthBars() on a panel retune.
      function drawHealthBar(su: SpriteUnit) {
        const cfg = dmgCfgRef.current;
        const barW = TW0 * cfg.barWidth;
        const barH = cfg.barHeight * pxScale;
        const barY = -su.dispH - cfg.barGap * pxScale;
        su.barBg.clear();
        su.barBg
          .roundRect(-barW / 2 - 1, barY - 1, barW + 2, barH + 2, 3)
          .fill({ color: 0x05070b, alpha: 0.7 });
        su.accent.clear();
        su.accent
          .roundRect(-barW / 2 - 1, barY - 1, barW + 2, 2, 2)
          .fill({ color: su.team === "player" ? 0x38e0c4 : 0xff5d73, alpha: 0.8 });
        const ratio = Math.max(0.0001, Math.min(1, su.hp / su.maxHp));
        su.hpFill.clear();
        su.hpFill.roundRect(0, barY, barW, barH, 2).fill({ color: 0xffffff });
        su.hpFill.position.x = -barW / 2;
        su.hpFill.scale.x = ratio;
        su.hpFill.tint = hpColor(ratio);
        su.hpFill.visible = !su.dead;
      }
      // Re-geometry every unit's HP bar (driven by the panel "Health bar" sliders).
      function redrawHealthBars() {
        for (const id in sprites) drawHealthBar(sprites[id]);
      }

      // ---- Build one unit visual per snapshot unit ----

      for (const u of result.initialState.units) {
        const charId = u.characterId;
        const cfg = config.characterConfigs?.[charId] ?? {};
        const baseTint = typeof cfg.tint === "number" ? cfg.tint : 0xffffff;

        // Art if an idle clip resolves (incl. via role-map animation keys) or a
        // base pose exists; otherwise a placeholder token.
        const idleClip = clipForRole(charId, "idle");
        const bp = basePose(charId);
        const seed: any[] = idleClip.length ? idleClip : bp ? [bp] : [];
        const hasArt = seed.length > 0;

        let body: any;
        let dispH: number;
        if (hasArt) {
          body = new AnimatedSprite(seed);
          body.anchor.set(0.5, 0.9);
          const s = BODY_H / (body.height || BODY_H);
          body.scale.set(s, s);
          dispH = BODY_H;
          body.tint = baseTint;
          body.loop = true;
          body.animationSpeed = seed.length / (IDLE_DUR * TICKER_FPS);
          body.play();
        } else {
          // Resilient placeholder token for a character with stats but no art.
          const rad = TW0 * 0.42;
          body = new Graphics();
          body
            .circle(0, -rad, rad)
            .fill({
              color: u.team === "player" ? 0x2a6f7a : 0x7a2a3a,
              alpha: 0.95,
            })
            .stroke({ color: 0xffffff, width: 2, alpha: 0.45 });
          const letter = new Text({
            text: (charId[0] || "?").toUpperCase(),
            style: {
              fontFamily: "system-ui, sans-serif",
              fontSize: rad,
              fontWeight: "700",
              fill: 0xffffff,
            },
          });
          letter.anchor.set(0.5);
          letter.position.set(0, -rad);
          body.addChild(letter);
          dispH = rad * 2;
        }

        const absScale = Math.abs(body.scale.x) || 1;
        body.scale.x = absScale * (u.team === "enemy" ? -1 : 1); // face inward

        const barBg = new Graphics();
        const accent = new Graphics();
        const hpFill = new Graphics();

        const node = new Container();
        node.addChild(body, barBg, accent, hpFill);
        const p = pixelOf(u.position.q, u.position.r);
        node.position.set(p.x, p.y);
        node.zIndex = p.y;
        unitsLayer.addChild(node);

        sprites[u.id] = {
          id: u.id,
          team: u.team,
          characterId: charId,
          node,
          body,
          hasArt,
          absScale,
          baseTint,
          dispH,
          barBg,
          accent,
          hpFill,
          maxHp: u.maxHp,
          hp: u.hp,
          q: u.position.q,
          r: u.position.r,
          dead: false,
        };
        // Paint the bar from the live config now that the SpriteUnit exists
        // (defaults reproduce the original geometry exactly).
        drawHealthBar(sprites[u.id]);
        initialById[u.id] = { q: u.position.q, r: u.position.r };
      }

      // Apply the loaded view config to the freshly-built units (scale to the live
      // tile + counter-rotate upright).
      relayout();

      // Expose the HP-bar repaint to the panel (stable-ref bridge, like dmgCfgRef);
      // reset to a no-op in cleanup so a stale closure can't paint a dead app.
      redrawHealthBarsRef.current = redrawHealthBars;

      // Live board-view bridge. The Display panel mutates mapCfgRef and calls
      // applyMapRef(); applyMap re-derives the effect-local view vars from the
      // ref (same clamps/derivations as the setup above) and relayouts. There's
      // no on-canvas overlay anymore — board-view tuning + its debounced
      // /api/config/map persistence both live in the React Display panel.
      function applyMap() {
        const m = mapCfgRef.current;
        tileW = clamp(m.tileWidth, MAP_BOUNDS.tileWidth.min, MAP_BOUNDS.tileWidth.max);
        ratio = clamp(
          m.tileHeightRatio,
          MAP_BOUNDS.tileHeightRatio.min,
          MAP_BOUNDS.tileHeightRatio.max,
        );
        boardScale = clamp(m.scale, MAP_BOUNDS.scale.min, MAP_BOUNDS.scale.max);
        rotRad = (m.rotation * Math.PI) / 180;
        rotXRad = (m.rotationX * Math.PI) / 180;
        rotYRad = (m.rotationY * Math.PI) / 180;
        relayout();
      }
      applyMapRef.current = applyMap;

      // ---- Playback primitives (all genId/destroyed-aware) ----
      function wait(ms: number): Promise<void> {
        return new Promise((res) => {
          const id = setTimeout(res, ms);
          cleanups.push(() => clearTimeout(id));
        });
      }
      function tween(
        ms: number,
        fn: (p: number) => void,
        myId: number,
      ): Promise<void> {
        return new Promise((res) => {
          const start = performance.now();
          let raf = 0;
          const step = (now: number) => {
            if (destroyed || genId !== myId) {
              res();
              return;
            }
            const p = Math.min(1, (now - start) / ms);
            fn(p);
            if (p < 1) raf = requestAnimationFrame(step);
            else res();
          };
          raf = requestAnimationFrame(step);
          cleanups.push(() => cancelAnimationFrame(raf));
        });
      }

      function setIdle(su: SpriteUnit) {
        if (su.dead || !su.hasArt) return;
        const idle = clipForRole(su.characterId, "idle");
        const f = idle.length ? idle : [basePose(su.characterId)];
        if (!f.length || !f[0]) return;
        su.body.stop();
        su.body.textures = f;
        su.body.loop = true;
        su.body.animationSpeed = f.length / (IDLE_DUR * TICKER_FPS);
        su.body.play();
      }

      // One-shot clip with onComplete + safety timeout (previewAction 1139-1147).
      function playOnce(
        su: SpriteUnit,
        role: BattleEventRole,
        durSec: number,
      ): Promise<void> {
        return new Promise((res) => {
          const frames = su.hasArt ? clipForRole(su.characterId, role) : [];
          if (!su.hasArt || !frames.length) {
            const id = setTimeout(res, durSec * 1000);
            cleanups.push(() => clearTimeout(id));
            return;
          }
          su.body.stop();
          su.body.textures = frames;
          su.body.loop = false;
          su.body.animationSpeed = frames.length / (durSec * TICKER_FPS);
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            su.body.onComplete = null;
            res();
          };
          su.body.onComplete = finish;
          su.body.play();
          const safety = setTimeout(finish, durSec * 1000 + 90);
          cleanups.push(() => clearTimeout(safety));
        });
      }

      function spawnDamage(
        su: SpriteUnit,
        amount: number,
        kind: "attack" | "skill",
        myId: number,
      ) {
        // Read the live config at spawn time — the panel mutates this ref, so
        // each new number reflects the latest knobs without an effect rebuild.
        const cfg = dmgCfgRef.current;
        const t = new Text({
          text: kind === "skill" ? `${amount}!` : `${amount}`,
          style: {
            fontFamily: dmgFont.style.fontFamily,
            fontSize: (kind === "skill" ? cfg.sizeSkill : cfg.sizeNormal) * TW0,
            fontWeight: "400",
            fill: kind === "skill" ? 0xffd36b : 0xffffff,
            stroke: { color: 0x05070b, width: cfg.stroke * pxScale },
          },
        });
        // The text is rasterized at its (small) local fontSize, then the unit node
        // magnifies it by k = tileW/TW0 (+ board zoom). Rasterize fine enough to
        // stay crisp through that upscale (capped to avoid huge glyph textures).
        t.resolution = Math.min(
          4,
          (window.devicePixelRatio || 1) * Math.max(1, (tileW / TW0) * boardScale),
        );
        t.anchor.set(0.5);
        // Parent the number to the unit node (like the HP bar) so it tracks the
        // char as it moves/knocks back. node already counter-rotates + unsquashes
        // + scales to the live tile each frame (relayout), so the text needs no
        // manual billboard transform — fontSize/offsets are in TW0 (local) units.
        // Offset X flips with the body so + always reads as "toward the facing".
        const facing = su.team === "enemy" ? -1 : 1;
        const baseX = TW0 * cfg.offsetX * facing;
        const baseY = -su.dispH - TW0 * cfg.height - TW0 * cfg.offsetY;
        t.position.set(baseX, baseY);
        su.node.addChild(t);
        tween(
          cfg.durationMs,
          (p) => {
            t.position.y = baseY - TW0 * cfg.rise * easeOutCubic(p);
            t.alpha = 1 - p * p;
            const sc = 1 + 0.18 * easeOutCubic(p);
            t.scale.set(sc, sc);
          },
          myId,
        ).then(() => {
          try {
            t.destroy();
          } catch {
            /* already torn down */
          }
        });
      }

      function updateHp(su: SpriteUnit, newHp: number, myId: number) {
        const from = su.hp / su.maxHp;
        const to = clamp(newHp / su.maxHp, 0, 1);
        su.hp = newHp;
        return tween(
          HPBAR_MS,
          (p) => {
            const r = lerp(from, to, p);
            su.hpFill.scale.x = Math.max(0.0001, r);
            su.hpFill.tint = hpColor(r);
          },
          myId,
        );
      }

      // hit has NO event — inferred from an attack/skill's target. Use an
      // authored hit Action if present, else a quick tint/alpha flash.
      function flashHit(su: SpriteUnit, myId: number): Promise<void> {
        if (su.dead) return Promise.resolve();
        const hit = su.hasArt ? clipForRole(su.characterId, "hit") : [];
        if (hit.length) {
          return playOnce(su, "hit", HIT_MS / 1000).then(() => {
            if (!su.dead) setIdle(su);
          });
        }
        const orig = su.baseTint;
        return tween(
          HIT_MS,
          (p) => {
            const k = Math.sin(p * Math.PI);
            su.body.tint = lerpColor(orig, 0xff5a5a, k);
            su.body.alpha = 1 - 0.25 * k;
          },
          myId,
        ).then(() => {
          su.body.tint = orig;
          su.body.alpha = 1;
        });
      }

      function knockback(
        su: SpriteUnit,
        from: HexPosition,
        to: HexPosition,
        myId: number,
      ) {
        const a = pixelOf(from.q, from.r);
        const b = pixelOf(to.q, to.r);
        su.q = to.q;
        su.r = to.r;
        return tween(
          KNOCKBACK_MS,
          (p) => {
            const e = easeOutCubic(p);
            su.node.position.set(lerp(a.x, b.x, e), lerp(a.y, b.y, e));
          },
          myId,
        );
      }

      async function doMove(
        su: SpriteUnit,
        from: HexPosition,
        to: HexPosition,
        myId: number,
      ) {
        if (su.hasArt) {
          const mv = clipForRole(su.characterId, "move");
          if (mv.length > 1) {
            su.body.stop();
            su.body.textures = mv;
            su.body.loop = true;
            su.body.animationSpeed = mv.length / (0.5 * TICKER_FPS);
            su.body.play();
          }
        }
        const a = pixelOf(from.q, from.r);
        const b = pixelOf(to.q, to.r);
        await tween(
          MOVE_MS,
          (p) => {
            const e = easeInOutQuad(p);
            su.node.position.set(lerp(a.x, b.x, e), lerp(a.y, b.y, e));
          },
          myId,
        );
        su.q = to.q;
        su.r = to.r;
        if (!su.dead) setIdle(su);
      }

      async function doAttack(
        su: SpriteUnit,
        target: SpriteUnit | undefined,
        myId: number,
      ) {
        const dir = target
          ? Math.sign(target.node.x - su.node.x) || (su.team === "player" ? 1 : -1)
          : su.team === "player"
            ? 1
            : -1;
        const ox = su.node.x;
        await Promise.all([
          playOnce(su, "attack", ATTACK_MS / 1000),
          tween(
            ATTACK_MS,
            (p) => {
              su.node.x = ox + dir * tileW * 0.28 * Math.sin(p * Math.PI);
            },
            myId,
          ),
        ]);
        su.node.x = ox;
        if (!su.dead) setIdle(su);
      }

      async function doDeath(su: SpriteUnit, myId: number) {
        su.dead = true;
        su.hpFill.visible = false;
        const death = su.hasArt ? clipForRole(su.characterId, "death") : [];
        if (death.length) {
          await playOnce(su, "death", DEATH_MS / 1000);
          await tween(160, (p) => (su.body.alpha = 1 - 0.8 * p), myId);
        } else {
          const dir = su.team === "player" ? -1 : 1;
          await tween(
            DEATH_MS,
            (p) => {
              const e = easeOutCubic(p);
              su.body.alpha = 1 - 0.85 * e;
              su.body.rotation = dir * 0.5 * e;
            },
            myId,
          );
        }
      }

      // ---- Beat dispatch: events that share one `t`, in EMITTED ORDER ----
      // Distinct units animate concurrently; events touching the SAME unit are
      // chained so emitted order holds and their tweens never race (e.g. a
      // shield-bash push followed by that same unit's move on the same tick).
      async function runBeat(beat: BattleEvent[], myId: number) {
        const chains: Record<string, Promise<void>> = {};
        const schedule = (ids: string[], task: () => Promise<void>) => {
          const prev = Promise.all(ids.map((id) => chains[id] ?? Promise.resolve()));
          const run = prev.then(() =>
            destroyed || genId !== myId ? undefined : task(),
          );
          const settled = run.then(
            () => {},
            () => {},
          );
          for (const id of ids) chains[id] = settled;
          return run;
        };

        const tasks: Promise<unknown>[] = [];
        for (const ev of beat) {
          if (ev.kind === "move") {
            const su = sprites[ev.unitId];
            if (su && !su.dead)
              tasks.push(schedule([ev.unitId], () => doMove(su, ev.from, ev.to, myId)));
          } else if (ev.kind === "attack" || ev.kind === "skill") {
            const src = sprites[ev.sourceId];
            const tgt = sprites[ev.targetId];
            const ids = [ev.sourceId, ev.targetId].filter((id) => sprites[id]);
            tasks.push(
              schedule(ids, async () => {
                const sub: Promise<unknown>[] = [];
                const attackDone =
                  src && !src.dead ? doAttack(src, tgt, myId) : Promise.resolve();
                sub.push(attackDone);
                if (tgt) {
                  sub.push(updateHp(tgt, ev.targetHp, myId));
                  sub.push(flashHit(tgt, myId));
                  if (ev.kind === "skill" && ev.push)
                    sub.push(knockback(tgt, ev.push.from, ev.push.to, myId));
                  // Damage number appears only AFTER the attacker's swing finishes
                  // (impact), not during the wind-up. Fire-and-forget like before,
                  // but gated on the live replay id so a restart/teardown cancels it.
                  void attackDone.then(() => {
                    if (destroyed || genId !== myId) return;
                    spawnDamage(
                      tgt,
                      ev.damage,
                      ev.kind === "skill" ? "skill" : "attack",
                      myId,
                    );
                  });
                }
                await Promise.all(sub);
              }),
            );
          } else if (ev.kind === "death") {
            const su = sprites[ev.unitId];
            if (su)
              tasks.push(
                schedule([ev.unitId], () =>
                  su.dead ? Promise.resolve() : doDeath(su, myId),
                ),
              );
          }
          // "end" is handled by the replay loop (triggers the result screen).
        }
        await Promise.all(tasks);
      }

      function resetAll() {
        for (const id of Object.keys(sprites)) {
          const su = sprites[id];
          const init = initialById[id];
          su.dead = false;
          su.hp = su.maxHp;
          su.q = init.q;
          su.r = init.r;
          const p = pixelOf(init.q, init.r);
          su.node.position.set(p.x, p.y);
          su.node.visible = true;
          su.node.alpha = 1;
          su.body.alpha = 1;
          su.body.rotation = 0;
          su.body.tint = su.baseTint;
          su.body.scale.x = su.absScale * (su.team === "enemy" ? -1 : 1);
          su.hpFill.visible = true;
          su.hpFill.scale.x = 1;
          su.hpFill.tint = hpColor(1);
          setIdle(su);
        }
      }

      async function runReplay() {
        const myId = ++genId; // cancels any in-flight replay
        resetAll();
        await wait(260);
        if (destroyed || genId !== myId) return;

        const events = result.events ?? [];
        let i = 0;
        while (i < events.length) {
          if (destroyed || genId !== myId) return;
          const t = events[i].t;
          const beat: BattleEvent[] = [];
          // group equal-`t` events IN EMITTED ORDER (never sort by t)
          while (i < events.length && events[i].t === t) {
            beat.push(events[i]);
            i++;
          }
          await runBeat(beat, myId);
          if (destroyed || genId !== myId) return;
          await wait(INTER_BEAT_MS);
        }
        if (destroyed || genId !== myId) return;
        onEnd(result.result);
      }

      const onResize = () => {
        if (!destroyed) centerBoard();
      };
      window.addEventListener("resize", onResize);
      (container as unknown as Record<string, unknown>).__resizeHandler = onResize;

      controlsRef.current = {
        replay: () => {
          runReplay().catch(console.error);
        },
      };
      onReady();
      runReplay().catch(console.error);
    }

    init().catch(console.error);

    return () => {
      destroyed = true;
      genId++;
      const handler = (container as unknown as Record<string, unknown>)
        .__resizeHandler as (() => void) | undefined;
      if (handler) window.removeEventListener("resize", handler);
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* ignore */
        }
      }
      controlsRef.current = null;
      redrawHealthBarsRef.current = () => {};
      applyMapRef.current = () => {};
      gridVisibleRef.current = null;
      if (pixiApp) {
        try {
          pixiApp.destroy();
        } catch {
          /* ignore */
        }
      }
      if (wrapper?.parentNode) wrapper.parentNode.removeChild(wrapper);
      container.innerHTML = "";
    };
    // Re-fight passes a fresh `result` object -> teardown + rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return <div ref={containerRef} className="mb-stage" />;
}

/* ------------------------------------------------------------------ *
 * Party builder helpers + board schematic
 * ------------------------------------------------------------------ */

type BuildUnit = {
  uid: string;
  characterId: string;
  slot: number; // deploy index 0..maxPerSide-1 (NOT a raw q)
  stats: UnitStats;
};

const genUid = () => Math.random().toString(36).slice(2, 9);

function BoardPreview({
  players,
  enemies,
  nameOf,
}: {
  players: BuildUnit[];
  enemies: BuildUnit[];
  nameOf: (id: string) => string;
}) {
  const PV = 34; // iso tile width for the schematic
  const PVH = PV * ISO_RATIO;
  const cells = genHexes();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const h of cells) {
    const p = isoPos(h.q, h.r, PV, PVH);
    minX = Math.min(minX, p.x - PV / 2);
    maxX = Math.max(maxX, p.x + PV / 2);
    minY = Math.min(minY, p.y - PVH / 2);
    maxY = Math.max(maxY, p.y + PVH / 2);
  }
  const occupied = (team: Team, q: number) =>
    (team === "player" ? players : enemies).find(
      (u) => DEPLOY_QS[team][u.slot] === q,
    );

  return (
    <svg
      className="mb-preview"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="img"
      aria-label="Deploy positions"
    >
      {cells.map((h, idx) => {
        const { x, y } = isoPos(h.q, h.r, PV, PVH);
        const pts = isoHex(x, y, PV * 0.94, PVH * 0.94)
          .map((p) => p.join(","))
          .join(" ");
        const isPlayer = h.r === BOARD.playerRow;
        const isEnemy = h.r === BOARD.enemyRow;
        const occ = isPlayer
          ? occupied("player", h.q)
          : isEnemy
            ? occupied("enemy", h.q)
            : undefined;
        const fill = isPlayer
          ? "rgba(56,224,196,0.10)"
          : isEnemy
            ? "rgba(255,93,115,0.10)"
            : "rgba(255,255,255,0.03)";
        return (
          <g key={idx}>
            <polygon
              points={pts}
              fill={occ ? (isPlayer ? "rgba(56,224,196,0.32)" : "rgba(255,93,115,0.32)") : fill}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
            />
            {occ && (
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={PV * 0.9}
                fontWeight={700}
                fill="#fff"
              >
                {nameOf(occ.characterId).charAt(0).toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * MockBattleClient — top-level page client
 * ------------------------------------------------------------------ */

export default function MockBattleClient() {
  const [config, setConfig] = useState<BootstrapConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [players, setPlayers] = useState<BuildUnit[]>([]);
  const [enemies, setEnemies] = useState<BuildUnit[]>([]);
  const [phase, setPhase] = useState<"build" | "resolving" | "replay">("build");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [mocked, setMocked] = useState(false);
  const [outcome, setOutcome] = useState<"win" | "lose" | "draw" | null>(null);
  const [stageReady, setStageReady] = useState(false);
  const [battleKey, setBattleKey] = useState(0);
  const [fightError, setFightError] = useState<string | null>(null);
  // Auto-rewatch: when ON, a finished replay loops back into the same battle.
  // In-memory only (not persisted) — a viewing preference for this round.
  const [autoRewatch, setAutoRewatch] = useState(false);
  // Show-grid: hex tile floor visibility. Default ON is mock-battle-specific
  // (the dev sandbox wants the board visible); a future /play port would default
  // this OFF — not built here. In-memory only (not persisted).
  const [showGrid, setShowGrid] = useState(true);

  const controlsRef = useRef<{ replay: () => void } | null>(null);
  // Bridge: BattleStage points this at its live HP-bar repaint; the Display
  // panel calls it so "Health bar" slider tweaks re-geometry bars immediately.
  const redrawHealthBarsRef = useRef<() => void>(() => {});
  // Show-grid bridge (imperative, like the refs above). showGridRef lets a
  // freshly-built battle seed grid.visible correctly; gridVisibleRef is the
  // effect's live setter (BattleStage populates it, clears it on teardown).
  // Both are threaded into <BattleStage> like the other *Ref props.
  const showGridRef = useRef(showGrid);
  const gridVisibleRef = useRef<((v: boolean) => void) | null>(null);
  useEffect(() => {
    showGridRef.current = showGrid;
    gridVisibleRef.current?.(showGrid);
  }, [showGrid]);

  // Display panel — live damage-number knobs. `dmgCfg` drives the inputs; the
  // ref mirrors it so the once-built spawnDamage closure reads fresh values
  // without the canvas effect re-running. Setting state re-renders, and the
  // assignment below repoints the ref — no extra effect, no Pixi rebuild.
  const [uiPanelOpen, setUiPanelOpen] = useState(false);
  const [dmgCfg, setDmgCfg] = useState<DamageCfg>(() => ({ ...DEFAULT_DAMAGE_CONFIG }));
  const dmgCfgRef = useRef<DamageCfg>(dmgCfg);
  dmgCfgRef.current = dmgCfg;
  // Persist damage-number tweaks server-side, debounced (~400ms trailing) so a
  // slider drag doesn't spam the writer route. The timer reads the live ref at
  // fire time (mirrors the map-config save), so the latest value is always sent.
  const dmgSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleDmgSave = useCallback(() => {
    if (dmgSaveTimer.current) clearTimeout(dmgSaveTimer.current);
    dmgSaveTimer.current = setTimeout(() => {
      fetch("/api/config/damage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dmgCfgRef.current),
      }).catch(() => {});
    }, 400);
  }, []);
  useEffect(
    () => () => {
      if (dmgSaveTimer.current) clearTimeout(dmgSaveTimer.current);
    },
    [],
  );
  const setDmgField = useCallback(
    (key: keyof DamageCfg, value: number) => {
      setDmgCfg((prev) => ({ ...prev, [key]: value }));
      // Keep the live ref fresh synchronously (render reassigns it too) so the
      // immediate HP-bar repaint below reads the new value, not last render's.
      dmgCfgRef.current = { ...dmgCfgRef.current, [key]: value };
      scheduleDmgSave();
      redrawHealthBarsRef.current(); // live HP-bar geometry (no-op for number knobs)
    },
    [scheduleDmgSave],
  );
  const resetDmgCfg = useCallback(() => {
    setDmgCfg({ ...DEFAULT_DAMAGE_CONFIG });
    dmgCfgRef.current = { ...DEFAULT_DAMAGE_CONFIG };
    scheduleDmgSave();
    redrawHealthBarsRef.current();
  }, [scheduleDmgSave]);

  // Board-view config — same bridge pattern as dmgCfg. `mapCfg` drives the
  // panel's Board-view sliders; `mapCfgRef` mirrors it for the effect; the
  // effect points `applyMapRef` at its live re-layout, so a slider tweak
  // refreshes the board immediately with no Pixi rebuild. Persisted (debounced)
  // to /api/config/map and hydrated on load (below), just like dmgCfg.
  const [mapCfg, setMapCfg] = useState<MapConfig>(() => ({ ...DEFAULT_MAP }));
  const mapCfgRef = useRef<MapConfig>(mapCfg);
  mapCfgRef.current = mapCfg;
  const applyMapRef = useRef<() => void>(() => {});
  // Top-down is a transient preset: snapshot the iso view, flatten (overhead
  // ratio, no rotation), restore on toggle off. While it's on, saves are
  // suppressed so the persisted iso config is never clobbered (reload returns
  // to it) — mirroring the old overlay's behavior.
  const [topDown, setTopDown] = useState(false);
  const topDownRef = useRef(topDown);
  topDownRef.current = topDown;
  const isoSnapshotRef = useRef<MapConfig | null>(null);
  const mapSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMapSave = useCallback(() => {
    if (topDownRef.current) return; // transient view — don't persist the preset
    if (mapSaveTimer.current) clearTimeout(mapSaveTimer.current);
    mapSaveTimer.current = setTimeout(() => {
      fetch("/api/config/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapCfgRef.current),
      }).catch(() => {});
    }, 400);
  }, []);
  useEffect(
    () => () => {
      if (mapSaveTimer.current) clearTimeout(mapSaveTimer.current);
    },
    [],
  );
  const setMapField = useCallback(
    (key: keyof MapConfig, value: number) => {
      setMapCfg((prev) => ({ ...prev, [key]: value }));
      // Sync the ref synchronously so the immediate applyMap reads the new value.
      mapCfgRef.current = { ...mapCfgRef.current, [key]: value };
      scheduleMapSave();
      applyMapRef.current(); // live board re-layout (effect re-derives + relayouts)
    },
    [scheduleMapSave],
  );
  const toggleTopDown = useCallback(() => {
    if (!topDownRef.current) {
      // iso -> top-down: snapshot, then flatten (keep tile width + scale).
      isoSnapshotRef.current = { ...mapCfgRef.current };
      const td: MapConfig = {
        ...mapCfgRef.current,
        tileHeightRatio: 1,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
      };
      topDownRef.current = true;
      mapCfgRef.current = td;
      setTopDown(true);
      setMapCfg(td);
    } else {
      // top-down -> iso: restore the snapshot exactly (already the saved view).
      const iso = isoSnapshotRef.current ?? { ...DEFAULT_MAP };
      topDownRef.current = false;
      mapCfgRef.current = iso;
      setTopDown(false);
      setMapCfg(iso);
    }
    applyMapRef.current();
  }, []);

  const statsFor = useCallback(
    (cfg: BootstrapConfig, id: string): UnitStats =>
      clampStats(cfg.battleStats?.[id] ?? DEFAULT_STATS),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cfg: BootstrapConfig;
      try {
        const res = await fetch("/api/config");
        cfg = normalizeConfig(res.ok ? await res.json() : {});
      } catch {
        cfg = normalizeConfig({});
      }
      if (cancelled) return;
      setConfig(cfg);
      // Hydrate the live damage-number knobs from the persisted config (dmgCfg
      // was created with defaults before this fetch resolved). Uses setDmgCfg
      // directly — NOT setDmgField — so loading never triggers a re-save.
      setDmgCfg({ ...DEFAULT_DAMAGE_CONFIG, ...(cfg.damageConfig ?? {}) });
      // Same for the board view (drives the panel's Board-view sliders); setMapCfg
      // directly so loading never triggers a re-save.
      setMapCfg({ ...DEFAULT_MAP, ...(cfg.mapConfig ?? {}) });
      // Seed a default matchup from the playable roster — first character vs the
      // next distinct one — so "Start battle" works immediately and stays correct
      // for any roster (no hardcoded ids).
      const seedRoster = buildRoster(cfg);
      if (seedRoster.length > 0) {
        const mid = Math.floor(BOARD.maxPerSide / 2);
        const playerChar = seedRoster[0];
        const enemyChar =
          seedRoster.find((c) => c.id !== playerChar.id) ?? seedRoster[0];
        setPlayers([
          {
            uid: genUid(),
            characterId: playerChar.id,
            slot: mid,
            stats: statsFor(cfg, playerChar.id),
          },
        ]);
        setEnemies([
          {
            uid: genUid(),
            characterId: enemyChar.id,
            slot: mid,
            stats: statsFor(cfg, enemyChar.id),
          },
        ]);
      }
      setLoadingConfig(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [statsFor]);

  const roster = useMemo(() => (config ? buildRoster(config) : []), [config]);

  const nameOf = useCallback(
    (id: string) => roster.find((c) => c.id === id)?.name ?? prettifyId(id),
    [roster],
  );

  const partyOps = (team: Team) => {
    const list = team === "player" ? players : enemies;
    const setList = team === "player" ? setPlayers : setEnemies;
    return { list, setList };
  };

  function nextFreeSlot(list: BuildUnit[]): number {
    for (let i = 0; i < BOARD.maxPerSide; i++)
      if (!list.some((u) => u.slot === i)) return i;
    return list.length % BOARD.maxPerSide;
  }

  function addUnit(team: Team, charId: string) {
    if (!config) return;
    const { list, setList } = partyOps(team);
    if (list.length >= BOARD.maxPerSide) return;
    setList([
      ...list,
      { uid: genUid(), characterId: charId, slot: nextFreeSlot(list), stats: statsFor(config, charId) },
    ]);
  }
  function removeUnit(team: Team, uid: string) {
    const { list, setList } = partyOps(team);
    setList(list.filter((u) => u.uid !== uid));
  }
  function setSlot(team: Team, uid: string, slot: number) {
    const { list, setList } = partyOps(team);
    const occupant = list.find((u) => u.slot === slot && u.uid !== uid);
    const self = list.find((u) => u.uid === uid);
    setList(
      list.map((u) => {
        if (u.uid === uid) return { ...u, slot };
        if (occupant && u.uid === occupant.uid && self) return { ...u, slot: self.slot };
        return u;
      }),
    );
  }
  function setStat(team: Team, uid: string, key: keyof UnitStats, value: number) {
    const { list, setList } = partyOps(team);
    setList(
      list.map((u) =>
        u.uid === uid ? { ...u, stats: { ...u.stats, [key]: value } } : u,
      ),
    );
  }
  function toggleSkill(team: Team, uid: string, skillId: string) {
    const { list, setList } = partyOps(team);
    setList(
      list.map((u) => {
        if (u.uid !== uid) return u;
        const has = u.stats.skills.includes(skillId);
        return {
          ...u,
          stats: {
            ...u.stats,
            skills: has
              ? u.stats.skills.filter((s) => s !== skillId)
              : [...u.stats.skills, skillId],
          },
        };
      }),
    );
  }

  async function startFight() {
    if (!config || players.length === 0 || enemies.length === 0) return;
    const toInput =
      (team: Team) =>
      (u: BuildUnit): PartyMemberInput => ({
        characterId: u.characterId,
        stats: clampStats(u.stats),
        position: deployHex(team, u.slot),
      });
    const req: ResolveRequest = {
      players: players.map(toInput("player")),
      enemies: enemies.map(toInput("enemy")),
    };
    setPhase("resolving");
    setOutcome(null);
    setStageReady(false);
    setFightError(null);
    const outcome = await requestResolve(req);
    if (!outcome.ok) {
      // Validation error from the resolve route — surface it, stay in the builder.
      setFightError(outcome.error);
      setPhase("build");
      return;
    }
    setMocked(outcome.mocked);
    setResult(outcome.result);
    setBattleKey((k) => k + 1);
    setPhase("replay");
  }

  const onStageReady = useCallback(() => setStageReady(true), []);
  const onStageEnd = useCallback(
    (o: "win" | "lose" | "draw") => setOutcome(o),
    [],
  );

  function watchAgain() {
    setOutcome(null);
    controlsRef.current?.replay();
  }
  function backToBuilder() {
    setPhase("build");
    setResult(null);
    setOutcome(null);
    setStageReady(false);
  }

  // Auto-rewatch loop: once a replay's outcome is in, let the result card flash,
  // then run the SAME restart the "Watch again" button does (setOutcome(null) +
  // controlsRef.replay()). The cleanup cancels a pending rewatch if the user acts
  // (Watch again / Edit parties), toggles it off, leaves replay, or unmounts — so
  // it never double-restarts or fires after teardown.
  useEffect(() => {
    if (phase !== "replay" || !outcome || !autoRewatch) return;
    const id = setTimeout(() => {
      setOutcome(null);
      controlsRef.current?.replay();
    }, 1800);
    return () => clearTimeout(id);
  }, [phase, outcome, autoRewatch]);

  const canFight = players.length > 0 && enemies.length > 0;

  return (
    <div className="mb-root">
      <style>{CSS}</style>

      <nav className="menu-bar">
        <span className="mb-brand">Mock Battle</span>
        <span className="mb-brand-sub">party vs party · auto-resolve</span>
        <span style={{ flex: 1 }} />
        <a className="menu-bar-item" href="/studio">
          Studio
        </a>
      </nav>

      <div className="mb-body">
        {loadingConfig ? (
          <div className="mb-center-msg">Loading roster…</div>
        ) : phase === "build" ? (
          roster.length === 0 ? (
            <div className="mb-center-msg">
              No characters found.
              <br />
              <a href="/studio">Add characters in the Studio</a> first, then come
              back to set up a battle.
            </div>
          ) : (
            <div className="mb-builder">
              <header className="mb-builder-head">
                <h1>Set up the match</h1>
                <p>
                  Pick fighters for each side, place them on a deploy hex, and
                  tweak their stats. Then start the battle and watch it play out.
                </p>
              </header>

              <div className="mb-columns">
                <PartyColumn
                  team="player"
                  title="Your party"
                  list={players}
                  roster={roster}
                  nameOf={nameOf}
                  onAdd={(id) => addUnit("player", id)}
                  onRemove={(uid) => removeUnit("player", uid)}
                  onSlot={(uid, s) => setSlot("player", uid, s)}
                  onStat={(uid, k, v) => setStat("player", uid, k, v)}
                  onSkill={(uid, s) => toggleSkill("player", uid, s)}
                />

                <div className="mb-center-col">
                  <BoardPreview players={players} enemies={enemies} nameOf={nameOf} />
                  <div className="mb-vs">VS</div>
                  <button
                    className="mb-fight-btn"
                    onClick={startFight}
                    disabled={!canFight}
                  >
                    Start battle
                  </button>
                  {!canFight && (
                    <span className="mb-hint">
                      Add at least one fighter to each side.
                    </span>
                  )}
                  {fightError && (
                    <span className="mb-error" role="alert">
                      {fightError}
                    </span>
                  )}
                </div>

                <PartyColumn
                  team="enemy"
                  title="Enemy party"
                  list={enemies}
                  roster={roster}
                  nameOf={nameOf}
                  onAdd={(id) => addUnit("enemy", id)}
                  onRemove={(uid) => removeUnit("enemy", uid)}
                  onSlot={(uid, s) => setSlot("enemy", uid, s)}
                  onStat={(uid, k, v) => setStat("enemy", uid, k, v)}
                  onSkill={(uid, s) => toggleSkill("enemy", uid, s)}
                />
              </div>
            </div>
          )
        ) : phase === "resolving" ? (
          <div className="mb-center-msg">Resolving battle…</div>
        ) : (
          <div className="mb-arena">
            {/* Portrait game frame: BattleStage is the 40% center field; the
                top/bottom 30% zones stay empty (reserved HUD space). The Pixi
                canvas host (.mb-stage, absolute inset:0) fills .gss-center-field
                so resizeTo reads the real band size and the board re-fits. */}
            <GameScreenShell
              centerBg="/assets/dungeon-bg.png"
              centerVideo="/assets/dungeon-bg.mp4"
              center={
                config && result ? (
                  <BattleStage
                    key={battleKey}
                    result={result}
                    config={config}
                    controlsRef={controlsRef}
                    dmgCfgRef={dmgCfgRef}
                    redrawHealthBarsRef={redrawHealthBarsRef}
                    mapCfgRef={mapCfgRef}
                    applyMapRef={applyMapRef}
                    showGridRef={showGridRef}
                    gridVisibleRef={gridVisibleRef}
                    onReady={onStageReady}
                    onEnd={onStageEnd}
                  />
                ) : null
              }
            />

            {/* Dev chrome floats OVER the frame as arena-level siblings (higher
                z-index) — never inside the reserved zones. */}
            <DisplayConfigPanel
              open={uiPanelOpen}
              onToggle={() => setUiPanelOpen((v) => !v)}
              dmgCfg={dmgCfg}
              onDmgChange={setDmgField}
              mapCfg={mapCfg}
              onMapChange={setMapField}
              topDown={topDown}
              onToggleTopDown={toggleTopDown}
              autoRewatch={autoRewatch}
              onAutoRewatchChange={setAutoRewatch}
              showGrid={showGrid}
              onShowGridChange={setShowGrid}
              onReset={resetDmgCfg}
            />

            <button className="mb-back-btn" onClick={backToBuilder}>
              ← Edit parties
            </button>
            {mocked && (
              <div className="mb-mock-badge">
                Demo result — resolve API not running
              </div>
            )}
            {!stageReady && <div className="mb-center-msg overlay">Loading battle…</div>}

            {outcome && (
              <div className="mb-result-scrim">
                <div className={`mb-result-card ${outcome}`}>
                  <div className="mb-result-title">
                    {outcome === "win"
                      ? "Victory"
                      : outcome === "lose"
                        ? "Defeat"
                        : "Draw"}
                  </div>
                  <div className="mb-result-sub">
                    {outcome === "win"
                      ? "Your party won the fight."
                      : outcome === "lose"
                        ? "Your party was defeated."
                        : "Time ran out — decided on remaining HP."}
                  </div>
                  <div className="mb-result-actions">
                    <button className="mb-btn primary" onClick={watchAgain}>
                      Watch again
                    </button>
                    <button className="mb-btn" onClick={backToBuilder}>
                      Edit parties
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Party column (one side of the builder)
 * ------------------------------------------------------------------ */

const STAT_FIELDS: { key: keyof UnitStats; label: string; title: string }[] = [
  { key: "hp", label: "HP", title: "Health" },
  { key: "attack", label: "ATK", title: "Attack" },
  { key: "defense", label: "DEF", title: "Defense" },
  { key: "actionSpeed", label: "SPD", title: "Action speed (higher acts more often)" },
  { key: "range", label: "RNG", title: "Range in hexes" },
];

function PartyColumn({
  team,
  title,
  list,
  roster,
  nameOf,
  onAdd,
  onRemove,
  onSlot,
  onStat,
  onSkill,
}: {
  team: Team;
  title: string;
  list: BuildUnit[];
  roster: RosterChar[];
  nameOf: (id: string) => string;
  onAdd: (charId: string) => void;
  onRemove: (uid: string) => void;
  onSlot: (uid: string, slot: number) => void;
  onStat: (uid: string, key: keyof UnitStats, value: number) => void;
  onSkill: (uid: string, skillId: string) => void;
}) {
  const full = list.length >= BOARD.maxPerSide;
  return (
    <section className={`mb-party ${team}`}>
      <div className="mb-party-head">
        <h2>{title}</h2>
        <span className="mb-count">
          {list.length}/{BOARD.maxPerSide}
        </span>
      </div>

      <div className="mb-add-row">
        <select
          className="mb-select"
          value=""
          disabled={full}
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">{full ? "Party full" : "Add fighter…"}</option>
          {roster.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-unit-list">
        {list.length === 0 && <div className="mb-empty">No fighters yet.</div>}
        {list.map((u) => (
          <div key={u.uid} className="mb-unit-card">
            <div className="mb-unit-top">
              <span className="mb-unit-avatar">
                {nameOf(u.characterId).charAt(0).toUpperCase()}
              </span>
              <span className="mb-unit-name">{nameOf(u.characterId)}</span>
              <button
                className="mb-unit-del"
                onClick={() => onRemove(u.uid)}
                aria-label="Remove fighter"
              >
                ×
              </button>
            </div>

            <div className="mb-slot-row">
              <span className="mb-slot-label">Hex</span>
              {Array.from({ length: BOARD.maxPerSide }).map((_, q) => (
                <button
                  key={q}
                  className={`mb-slot-pill ${u.slot === q ? "on" : ""}`}
                  onClick={() => onSlot(u.uid, q)}
                >
                  {q + 1}
                </button>
              ))}
            </div>

            <div className="mb-stat-grid">
              {STAT_FIELDS.map((f) => (
                <label key={f.key} className="mb-stat" title={f.title}>
                  <span>{f.label}</span>
                  <input
                    type="number"
                    value={u.stats[f.key] as number}
                    onChange={(e) =>
                      onStat(u.uid, f.key, Number(e.target.value) || 0)
                    }
                  />
                </label>
              ))}
            </div>

            <div className="mb-skill-row">
              {KNOWN_SKILLS.map((s) => (
                <label key={s.id} className="mb-skill">
                  <input
                    type="checkbox"
                    checked={u.stats.skills.includes(s.id)}
                    onChange={() => onSkill(u.uid, s.id)}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Display config panel — a right-side slide-in drawer of all live
 * display knobs: floating damage numbers, health bar, AND board view.
 * Data-driven: each section names a config `group` ("damage" -> dmgCfg
 * via onDmgChange; "board" -> mapCfg via onMapChange). Add a group by
 * pushing a section to UI_SECTIONS. Board edits relayout the live Pixi
 * board (applyMapRef) and persist to /api/config/map — no Pixi rebuild.
 * ------------------------------------------------------------------ */

type PanelGroup = "damage" | "board";

type SliderControl = {
  key: string; // a key of the section group's config (DamageCfg | MapConfig)
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  digits?: number; // fixed decimals in the readout (omit -> show as integer)
};

const UI_SECTIONS: { title: string; group: PanelGroup; controls: SliderControl[] }[] = [
  {
    title: "Damage numbers",
    group: "damage",
    controls: [
      { key: "sizeNormal", label: "Damage size", min: 0.1, max: 0.8, step: 0.01, digits: 2 },
      { key: "sizeSkill", label: "Skill size", min: 0.1, max: 0.9, step: 0.01, digits: 2 },
      { key: "height", label: "Height", min: 0, max: 1, step: 0.02, digits: 2 },
      { key: "offsetX", label: "Offset X", min: -1, max: 1, step: 0.02, digits: 2 },
      { key: "offsetY", label: "Offset Y", min: -1, max: 1, step: 0.02, digits: 2 },
      { key: "rise", label: "Rise", min: 0, max: 1.2, step: 0.02, digits: 2 },
      { key: "stroke", label: "Stroke", min: 0, max: 12, step: 1, suffix: "px" },
      { key: "durationMs", label: "Float time", min: 200, max: 1500, step: 20, suffix: "ms" },
    ],
  },
  {
    title: "Health bar",
    group: "damage",
    controls: [
      { key: "barWidth", label: "Bar width", min: 0.2, max: 2, step: 0.05, digits: 2 },
      { key: "barHeight", label: "Bar height", min: 2, max: 20, step: 1, suffix: "px" },
      { key: "barGap", label: "Bar gap", min: -40, max: 60, step: 1, suffix: "px" },
    ],
  },
  {
    title: "Board view",
    group: "board",
    controls: [
      { key: "tileWidth", label: "Tile width", min: MAP_BOUNDS.tileWidth.min, max: MAP_BOUNDS.tileWidth.max, step: 2, suffix: "px" },
      { key: "tileHeightRatio", label: "Height ratio", min: MAP_BOUNDS.tileHeightRatio.min, max: MAP_BOUNDS.tileHeightRatio.max, step: 0.02, digits: 2 },
      { key: "scale", label: "Scale", min: MAP_BOUNDS.scale.min, max: MAP_BOUNDS.scale.max, step: 0.05, digits: 2 },
      { key: "rotation", label: "Rotation", min: MAP_BOUNDS.rotation.min, max: MAP_BOUNDS.rotation.max, step: 5, suffix: "°" },
      { key: "rotationX", label: "Tilt X", min: MAP_BOUNDS.rotationX.min, max: MAP_BOUNDS.rotationX.max, step: 5, suffix: "°" },
      { key: "rotationY", label: "Tilt Y", min: MAP_BOUNDS.rotationY.min, max: MAP_BOUNDS.rotationY.max, step: 5, suffix: "°" },
    ],
  },
];

function DisplayConfigPanel({
  open,
  onToggle,
  dmgCfg,
  onDmgChange,
  mapCfg,
  onMapChange,
  topDown,
  onToggleTopDown,
  autoRewatch,
  onAutoRewatchChange,
  showGrid,
  onShowGridChange,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  dmgCfg: DamageCfg;
  onDmgChange: (key: keyof DamageCfg, value: number) => void;
  mapCfg: MapConfig;
  onMapChange: (key: keyof MapConfig, value: number) => void;
  topDown: boolean;
  onToggleTopDown: () => void;
  autoRewatch: boolean;
  onAutoRewatchChange: (value: boolean) => void;
  showGrid: boolean;
  onShowGridChange: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`mb-ui-toggle ${open ? "open" : ""}`}
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Display settings"
        title="Display settings"
      >
        UI
      </button>

      <aside className={`mb-ui-panel ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="mb-ui-head">
          <span className="mb-ui-title">Display</span>
          <button type="button" className="mb-ui-reset" onClick={onReset}>
            Reset
          </button>
        </div>

        <div className="mb-ui-scroll">
          {UI_SECTIONS.map((section) => {
            const isBoard = section.group === "board";
            return (
              <div key={section.title} className="mb-ui-section">
                <div className="mb-ui-section-title">{section.title}</div>
                {isBoard && (
                  <button
                    type="button"
                    className={`mb-ui-pill ${topDown ? "on" : ""}`}
                    onClick={onToggleTopDown}
                    aria-pressed={topDown}
                    title="Flatten to an overhead hex grid (a temporary view — your saved iso config is untouched)"
                  >
                    Top-down
                  </button>
                )}
                {isBoard && (
                  <label className="mb-ui-check">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => onShowGridChange(e.target.checked)}
                    />
                    <span>Show grid</span>
                  </label>
                )}
                {section.controls.map((c) => {
                  const value = isBoard
                    ? mapCfg[c.key as keyof MapConfig]
                    : dmgCfg[c.key as keyof DamageCfg];
                  // Top-down overrides tilt/rotation/ratio — lock those while it's
                  // on (tile width + scale stay live), mirroring the old overlay.
                  const locked =
                    isBoard && topDown && c.key !== "tileWidth" && c.key !== "scale";
                  return (
                    <div
                      key={c.key}
                      className={`mb-ui-row ${locked ? "is-locked" : ""}`}
                    >
                      <div className="mb-ui-row-head">
                        <span className="mb-ui-label">{c.label}</span>
                        <span className="mb-ui-value">
                          {c.digits != null ? value.toFixed(c.digits) : value}
                          {c.suffix ?? ""}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="mb-ui-slider"
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        value={value}
                        disabled={locked}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (isBoard) onMapChange(c.key as keyof MapConfig, v);
                          else onDmgChange(c.key as keyof DamageCfg, v);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playback — boolean view preferences (in-memory, not persisted). */}
          <div className="mb-ui-section">
            <div className="mb-ui-section-title">Playback</div>
            <label className="mb-ui-check">
              <input
                type="checkbox"
                checked={autoRewatch}
                onChange={(e) => onAutoRewatchChange(e.target.checked)}
              />
              <span>Auto-rewatch</span>
            </label>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Styles — matches the studio's dark, glassy palette.
 * ------------------------------------------------------------------ */

const CSS = `
.mb-root {
  display: flex; flex-direction: column; width: 100vw; height: 100vh;
  font-family: system-ui, sans-serif; color: #e8e8f0;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(56,224,196,0.06), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(255,93,115,0.06), transparent 60%),
    #0a0a0f;
}
.mb-brand { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; color: #e8e8f0; padding: 0 6px; }
.mb-brand-sub { font-size: 11px; color: rgba(255,255,255,0.32); letter-spacing: 0.04em; }
.menu-bar a.menu-bar-item { text-decoration: none; }

.mb-body { flex: 1; position: relative; overflow: hidden; }

.mb-center-msg {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; gap: 6px;
  color: rgba(255,255,255,0.5); font-size: 15px; line-height: 1.6; padding: 0 24px;
}
.mb-center-msg.overlay { pointer-events: none; color: rgba(255,255,255,0.55); }
.mb-center-msg a { color: #38e0c4; }

/* ---- Builder ---- */
.mb-builder { height: 100%; overflow-y: auto; padding: 28px 32px 48px; }
.mb-builder-head { max-width: 720px; margin: 0 auto 26px; text-align: center; }
.mb-builder-head h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 8px; }
.mb-builder-head p { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.6; }

.mb-columns {
  display: grid; grid-template-columns: 1fr minmax(220px, 280px) 1fr;
  gap: 22px; max-width: 1240px; margin: 0 auto; align-items: start;
}
@media (max-width: 900px) { .mb-columns { grid-template-columns: 1fr; } }

.mb-party {
  background: rgba(15,15,20,0.7); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 14px; padding: 16px; backdrop-filter: blur(14px);
}
.mb-party.player { border-top: 2px solid #38e0c4; }
.mb-party.enemy { border-top: 2px solid #ff5d73; }
.mb-party-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.mb-party-head h2 { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
.mb-count { font-size: 12px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; font-family: 'SF Mono','Fira Code',monospace; }

.mb-add-row { margin-bottom: 12px; }
.mb-select {
  width: 100%; background: rgba(255,255,255,0.05); color: #e8e8f0;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  padding: 9px 10px; font-size: 13px; cursor: pointer; outline: none;
  -webkit-appearance: none; appearance: none;
}
.mb-select:hover { border-color: rgba(255,255,255,0.3); }
.mb-select:disabled { opacity: 0.5; cursor: not-allowed; }

.mb-unit-list { display: flex; flex-direction: column; gap: 10px; }
.mb-empty { font-size: 12px; color: rgba(255,255,255,0.3); padding: 14px 0; text-align: center; }

.mb-unit-card { background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; }
.mb-unit-top { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.mb-unit-avatar {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.mb-party.player .mb-unit-avatar { background: rgba(56,224,196,0.22); color: #aef6e8; }
.mb-party.enemy .mb-unit-avatar { background: rgba(255,93,115,0.22); color: #ffc6cf; }
.mb-unit-name { flex: 1; font-size: 13px; font-weight: 500; }
.mb-unit-del {
  background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer;
  font-size: 18px; line-height: 1; padding: 0 4px; transition: color 0.12s;
}
.mb-unit-del:hover { color: #ff5d73; }

.mb-slot-row { display: flex; align-items: center; gap: 5px; margin-bottom: 11px; }
.mb-slot-label { font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.35); margin-right: 3px; }
.mb-slot-pill {
  width: 26px; height: 24px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.55); font-size: 11px; font-family: 'SF Mono','Fira Code',monospace;
  transition: all 0.12s;
}
.mb-slot-pill:hover { border-color: rgba(255,255,255,0.3); }
.mb-party.player .mb-slot-pill.on { background: rgba(56,224,196,0.25); border-color: #38e0c4; color: #fff; }
.mb-party.enemy .mb-slot-pill.on { background: rgba(255,93,115,0.25); border-color: #ff5d73; color: #fff; }

.mb-stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px; }
.mb-stat { display: flex; flex-direction: column; gap: 3px; }
.mb-stat span { font-size: 9px; font-weight: 600; letter-spacing: 0.05em; color: rgba(255,255,255,0.4); text-align: center; }
.mb-stat input {
  width: 100%; box-sizing: border-box; text-align: center;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px; color: #e8e8f0; font-size: 12px;
  font-family: 'SF Mono','Fira Code',monospace; padding: 5px 2px; outline: none;
  -moz-appearance: textfield;
}
.mb-stat input::-webkit-inner-spin-button, .mb-stat input::-webkit-outer-spin-button { -webkit-appearance: none; }
.mb-stat input:focus { border-color: rgba(255,255,255,0.32); }

.mb-skill-row { display: flex; flex-wrap: wrap; gap: 10px; }
.mb-skill { display: flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(255,255,255,0.6); cursor: pointer; }
.mb-skill input { accent-color: #38e0c4; }
.mb-ui-check {
  display: flex; align-items: center; gap: 9px; margin-bottom: 14px;
  font-size: 12px; color: rgba(255,255,255,0.7); cursor: pointer;
}
.mb-ui-check input { accent-color: #38e0c4; width: 15px; height: 15px; cursor: pointer; }

/* ---- Center column ---- */
.mb-center-col { display: flex; flex-direction: column; align-items: center; gap: 14px; position: sticky; top: 8px; }
.mb-preview { width: 100%; max-width: 230px; height: auto; opacity: 0.95; }
.mb-vs { font-size: 18px; font-weight: 800; letter-spacing: 0.18em; color: rgba(255,255,255,0.3); }
.mb-fight-btn {
  width: 100%; padding: 14px 18px; border-radius: 12px; cursor: pointer;
  font-size: 15px; font-weight: 700; letter-spacing: 0.02em; color: #04140f;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border: 1px solid rgba(56,224,196,0.6);
  box-shadow: 0 8px 24px rgba(43,191,166,0.28); transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
}
.mb-fight-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(43,191,166,0.4); }
.mb-fight-btn:active:not(:disabled) { transform: translateY(0); }
.mb-fight-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.mb-hint { font-size: 11px; color: rgba(255,255,255,0.4); text-align: center; }
.mb-error {
  font-size: 12px; line-height: 1.5; text-align: center; max-width: 250px;
  color: #ffb3bd; background: rgba(255,93,115,0.12);
  border: 1px solid rgba(255,93,115,0.4); padding: 8px 12px; border-radius: 8px;
}

/* ---- Arena ---- */
.mb-arena { position: absolute; inset: 0; }
.mb-stage { position: absolute; inset: 0; }
.mb-back-btn {
  position: absolute; top: 14px; left: 14px; z-index: 5;
  background: rgba(15,15,20,0.82); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.7); font-size: 13px; padding: 8px 13px; border-radius: 8px;
  cursor: pointer; backdrop-filter: blur(14px); transition: color 0.12s, background 0.12s;
}
.mb-back-btn:hover { color: #fff; background: rgba(35,35,45,0.92); }
.mb-mock-badge {
  position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 5;
  background: rgba(224,176,74,0.14); border: 1px solid rgba(224,176,74,0.4);
  color: #f1d79a; font-size: 11px; padding: 6px 12px; border-radius: 20px;
  letter-spacing: 0.02em;
}

/* ---- Display / UI config drawer (right-side, slide-in) ---- */
.mb-ui-toggle {
  position: absolute; top: 50%; right: 0; transform: translateY(-50%);
  width: 30px; height: 58px; z-index: 9; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(15,20,30,0.85); border: 1px solid rgba(255,255,255,0.14);
  border-right: none; border-radius: 8px 0 0 8px;
  color: rgba(255,255,255,0.55); cursor: pointer;
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  writing-mode: vertical-rl; text-orientation: mixed;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  outline: none; user-select: none;
  transition: color 0.14s, background 0.14s, border-color 0.14s,
    right 0.28s cubic-bezier(0.4,0,0.2,1);
}
.mb-ui-toggle:hover { color: #fff; background: rgba(35,42,56,0.92); border-color: rgba(255,255,255,0.3); }
.mb-ui-toggle.open { right: 290px; color: #fff; }

.mb-ui-panel {
  position: absolute; top: 0; right: 0; width: 290px; height: 100%; z-index: 9;
  display: flex; flex-direction: column; box-sizing: border-box; padding: 22px 20px;
  background: rgba(13,16,22,0.9); border-left: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
}
.mb-ui-panel.open { transform: translateX(0); }
.mb-ui-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px; padding-bottom: 12px; flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.mb-ui-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255,255,255,0.32);
}
.mb-ui-reset {
  background: none; border: none; cursor: pointer; padding: 2px 4px; outline: none;
  font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255,255,255,0.3); transition: color 0.12s;
}
.mb-ui-reset:hover { color: rgba(255,255,255,0.75); }
.mb-ui-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; margin: 0 -20px; padding: 0 20px; }
.mb-ui-scroll::-webkit-scrollbar { width: 4px; }
.mb-ui-scroll::-webkit-scrollbar-track { background: transparent; }
.mb-ui-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
.mb-ui-section { margin-bottom: 24px; }
.mb-ui-section-title {
  font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.4); margin-bottom: 14px;
}
.mb-ui-pill {
  display: inline-flex; align-items: center; margin: -2px 0 16px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em; line-height: 1;
  color: rgba(255,255,255,0.7); cursor: pointer; white-space: nowrap;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px; padding: 6px 12px; outline: none;
  transition: background 0.14s, border-color 0.14s, color 0.14s, box-shadow 0.14s;
}
.mb-ui-pill:hover { color: #fff; background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.32); }
.mb-ui-pill.on {
  color: #04140f; background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border-color: rgba(56,224,196,0.6); box-shadow: 0 2px 10px rgba(43,191,166,0.35);
}
.mb-ui-row { margin-bottom: 15px; }
.mb-ui-row.is-locked { opacity: 0.4; }
.mb-ui-row.is-locked .mb-ui-slider { cursor: not-allowed; }
.mb-ui-row-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.mb-ui-label { font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.02em; }
.mb-ui-value {
  font-size: 11px; color: rgba(255,255,255,0.78);
  font-variant-numeric: tabular-nums; font-family: 'SF Mono','Fira Code',monospace;
}
.mb-ui-slider {
  width: 100%; height: 4px; border-radius: 3px; outline: none; cursor: pointer;
  -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.12);
  transition: background 0.12s;
}
.mb-ui-slider:hover { background: rgba(255,255,255,0.18); }
.mb-ui-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: #38e0c4; border: 2px solid #0a0a0f; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.mb-ui-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: #38e0c4; border: 2px solid #0a0a0f; cursor: pointer;
}

/* ---- Result ---- */
.mb-result-scrim {
  position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(5,6,10,0.55); backdrop-filter: blur(4px);
  animation: mb-fade 0.25s ease both;
}
.mb-result-card {
  text-align: center; padding: 34px 44px; border-radius: 18px;
  background: rgba(16,17,24,0.92); border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5); animation: mb-pop 0.32s cubic-bezier(0.2,0.9,0.3,1.3) both;
}
.mb-result-title { font-size: 40px; font-weight: 800; letter-spacing: 0.01em; margin-bottom: 6px; }
.mb-result-card.win .mb-result-title { color: #57e08a; text-shadow: 0 0 30px rgba(87,224,138,0.4); }
.mb-result-card.lose .mb-result-title { color: #ff5d73; text-shadow: 0 0 30px rgba(255,93,115,0.4); }
.mb-result-card.draw .mb-result-title { color: #e0c84a; text-shadow: 0 0 30px rgba(224,200,74,0.35); }
.mb-result-sub { font-size: 13px; color: rgba(255,255,255,0.55); margin-bottom: 22px; }
.mb-result-actions { display: flex; gap: 10px; justify-content: center; }
.mb-btn {
  padding: 11px 20px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 600;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #e8e8f0;
  transition: background 0.12s, border-color 0.12s;
}
.mb-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); }
.mb-btn.primary { background: linear-gradient(180deg, #46eccf, #2bbfa6); color: #04140f; border-color: rgba(56,224,196,0.6); }
.mb-btn.primary:hover { box-shadow: 0 6px 18px rgba(43,191,166,0.35); }

@keyframes mb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mb-pop { from { opacity: 0; transform: scale(0.92) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
`;
