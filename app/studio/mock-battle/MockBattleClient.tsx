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
  SpellDef,
  SpellInput,
  Team,
  UnitStats,
} from "@/lib/battle/types";
import { BATTLE_TICK, BOARD, DEFAULT_DAMAGE_CONFIG, DEFAULT_SPELL_DURATION, DEFAULT_SPELL_FPS, MAX_BATTLE_TIME, STAT_BOUNDS } from "@/lib/battle/types";
import { isoPos, isoHex, getHexRowsFromCounts } from "../studioHelpers";
import GameScreenShell from "./GameScreenShell";
import { mockResolve } from "./mockResolve";
import { BoardPreview } from "./BoardPreview";
import { PartyColumn } from "./PartyColumn";
import { DisplayConfigPanel } from "./DisplayConfigPanel";
import { createBattleClips } from "./battleClips";
import { createBattleBoard } from "./battleBoard";
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
const SPELL_FLIGHT_MS = 360; // projectile travel time, caster -> target
const HPBAR_MS = 180;
const INTER_BEAT_MS = 80; // breathing room between equal-`t` beats

/** 2:1 isometric geometry (tile height = tile width * ISO_RATIO), matching the studio iso grid. */
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

/** HP-bar color ramps red -> amber -> green as the fill level rises. */
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

export type RosterChar = { id: string; name: string };

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
  spells?: SpellDef[];
  characterSpells?: Record<string, string[]>;
  // Last-saved mock-battle builder parties (opaque to the server). null/absent
  // until the user edits a party; restored on load, persisted (debounced) on edit.
  roster?: { players: BuildUnit[]; enemies: BuildUnit[] } | null;
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
    spells: Array.isArray(data?.spells) ? data.spells : [],
    characterSpells: data?.characterSpells ?? {},
    roster: data?.roster ?? null,
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

// mockResolve extracted -> ./mockResolve.ts (Phase 1)
/* ------------------------------------------------------------------ *
 * BattleStage — the PixiJS replayer.
 *
 * Reuses the StudioClient lifecycle contract: `await import('pixi.js')` +
 * Application.init (StudioClient:46-67), the Spritesheet/frames loader with
 * deriveFrom/reverse (122-159), the previewGenId generation-cancel pattern
 * (1094/1110/1114/1157) for re-fight, the AnimatedSprite play/onComplete pattern
 * from previewAction (1107-1193), and the destroyed-guard + cleanup (2092-2107).
 * ------------------------------------------------------------------ */

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
  // Body horizontal facing as a scale-X SIGN: 1 = right (the art's authored
  // direction), -1 = left. At rest it defaults by team (enemy = -1/left,
  // player = 1/right); engage re-points it at the current target's board row.
  // Applied to the BODY sprite (body.scale.x = absScale * facing) — never the
  // node, which also holds the HP bar + damage numbers, so flipping never
  // mirrors the UI. Zoom-independent, so it survives relayout (node-only rescale).
  facing: 1 | -1;
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

      // Cap the canvas render scale (applied to `resolution` below). Lower = fewer
      // pixels filled per frame (the biggest GPU lever here) at the cost of softer
      // text/vector edges; the pixel-art sprites tolerate a lower cap well. 2 = no
      // change on a typical 2x-retina display — drop to 1.5 / 1 and hard-reload to
      // A/B the perf-vs-crispness trade-off.
      const MAX_RENDER_SCALE = 2;
      pixiApp = new Application();
      await pixiApp.init({
        resizeTo: wrapper,
        backgroundAlpha: 0,
        antialias: true,
        // Render at the device pixel density (crisp text/vectors on HiDPI; without
        // it the canvas rasterizes at 1x and is CSS-upscaled -> blurry), but CAP
        // it so high-DPR phones don't pay to fill ~9x the pixels every frame.
        resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE),
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
      // ---- Load only the sheets THIS battle needs ----
      // Loading the whole catalog (~35 sheets) up front is slow on prod and OOMs
      // phones; a 1v1 needs ~2 characters. Compute the catalog keys the replay can
      // request for the battle's characters, mirroring the SAME key sources
      // ownedKeys/clipForRole/basePose draw from (character_animations / seed,
      // authored Actions' steps, role-map values), then load only those rows.
      // NOTE: clipForRole/ownedKeys aren't reusable here — they return frames and
      // read framesByKey, which isn't populated until the load below; so this
      // walks the key sources directly (key-level, pre-load).
      const catalogByKey: Record<string, any> = {};
      for (const c of catalog) catalogByKey[c.key] = c;
      const neededKeys = new Set<string>();
      const battleCharIds = new Set(
        result.initialState.units.map((u) => u.characterId),
      );
      for (const charId of battleCharIds) {
        // owned art: character_animations blob, else characterSeed keys
        const ca = config.characterAnimations?.[charId];
        const owned =
          ca && ca.length
            ? ca
            : Object.keys(config.characterSeed?.[charId]?.animations ?? {});
        for (const k of owned) neededKeys.add(k);
        // every authored Action's animation steps (covers role-map Action ids +
        // name-inferred actions, which clipForRole flattens to these keys)
        for (const raw of config.actions?.[charId] ?? []) {
          const steps = Array.isArray(raw?.steps)
            ? raw.steps
            : (raw?.animationKeys ?? []).map((k: string) => ({
                type: "animation",
                animationKey: k,
              }));
          for (const s of steps)
            if (s?.type === "animation" && s.animationKey)
              neededKeys.add(s.animationKey);
        }
        // role-map values that are raw animation keys (Action-id values are
        // already covered by the Action steps above)
        const rm = config.roleMaps?.[charId];
        if (rm)
          for (const role of [
            "idle",
            "move",
            "attack",
            "hit",
            "death",
          ] as BattleEventRole[]) {
            const v = rm[role];
            if (v) neededKeys.add(v);
          }
        // owned spells' projectile sheets (so flyProjectile can play their art)
        for (const sid of config.characterSpells?.[charId] ?? []) {
          const sp = (config.spells ?? []).find((s) => s.id === sid);
          if (sp?.animationKey) neededKeys.add(sp.animationKey);
        }
      }
      // deriveFrom chains: a needed derived key needs its BASE image loaded
      // (framesForKey resolves derived frames from framesByKey[deriveFrom]) —
      // e.g. john-copy-* -> john-*. Walk the full chain, guarding cycles.
      for (const k of [...neededKeys]) {
        let row = catalogByKey[k];
        const seen = new Set<string>();
        while (row?.deriveFrom && !seen.has(row.deriveFrom)) {
          seen.add(row.deriveFrom);
          neededKeys.add(row.deriveFrom);
          row = catalogByKey[row.deriveFrom];
        }
      }

      // Load each needed sheet's PNG + parse its frames CONCURRENTLY. Pixi's
      // Assets queue de-dupes/parallelizes the network+decode; failures stay
      // isolated per row.
      await Promise.all(
        catalog.map(async (c) => {
          if (!c.image || !c.frameData) return;
          if (!neededKeys.has(c.key)) return; // skip sheets this battle won't use
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

      // battleClips extracted -> ./battleClips (Phase 2a)
      const {
        framesForKey,
        migrateAction,
        ownedKeys,
        basePose,
        flattenAction,
        clipForRole,
      } = createBattleClips({ config, catalog, framesByKey });

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
      const TW0 = fitW; // sprite-build reference (units scaled to the live tile size)
      const BODY_H = TW0 * 1.3;
      // HP-bar height/gap and the damage stroke are authored in px at the default
      // tile (DEFAULT_MAP.tileWidth). Scale them into the TW0 build-frame so, after
      // the node's live-tile/reference scale, they track the board zoom uniformly (like
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

      const boardLayout = { tileW, ratio, boardScale, rotRad, rotXRad, rotYRad };

      // Outer viewport applies the pseudo-3D tilt (pitch/yaw foreshorten) + zoom
      // OUTSIDE the in-plane Z-rotation, so units can counter just rotation +
      // foreshorten (no shear) and read as upright billboards.
      const viewport = new Container();
      pixiApp.stage.addChild(viewport);
      const board = new Container();
      viewport.addChild(board);
      const sprites: Record<string, SpriteUnit> = {};
      const initialById: Record<string, { q: number; r: number }> = {};

      const grid = new Graphics();
      board.addChild(grid);
      grid.visible = showGridRef.current; // seed from the live toggle on (re)build
      gridVisibleRef.current = (v: boolean) => {
        grid.visible = v;
      };
      const { pixelOf, centerBoard, drawGrid, relayout, applyMap } = createBattleBoard({
        pixiApp,
        board,
        viewport,
        grid,
        sprites,
        hexes,
        TW0,
        boardLayout,
        mapCfgRef,
        MAP_BOUNDS,
      });
      // battleBoard extracted -> ./battleBoard (Phase 2b)
      drawGrid();

      // Depth-sorted unit layer (farther rows render behind nearer ones).
      const unitsLayer = new Container();
      unitsLayer.sortableChildren = true;
      board.addChild(unitsLayer);
      // Depth by SCREEN-y (project the board-local position through the current
      // rotation) so stacking stays correct at any view angle.
      const depthTick = () => {
        if (destroyed) return;
        const cs = Math.cos(boardLayout.rotRad);
        const sn = Math.sin(boardLayout.rotRad);
        const px = board.pivot.x;
        const py = board.pivot.y;
        for (const id of Object.keys(sprites)) {
          const su = sprites[id];
          su.node.zIndex = (su.node.x - px) * sn + (su.node.y - py) * cs;
        }
      };
      pixiApp.ticker.add(depthTick);

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
        const hpRatio = Math.max(0.0001, Math.min(1, su.hp / su.maxHp));
        su.hpFill.clear();
        su.hpFill.roundRect(0, barY, barW, barH, 2).fill({ color: 0xffffff });
        su.hpFill.position.x = -barW / 2;
        su.hpFill.scale.x = hpRatio;
        su.hpFill.tint = hpColor(hpRatio);
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
        // Horizontal facing is a scale-X SIGN carried by the BODY sprite (never
        // the node — flipping that would mirror the HP bar + damage numbers). The
        // art is authored facing RIGHT; at rest enemies face LEFT, players RIGHT,
        // and doAttack re-points it at the current target on engage.
        const facing: 1 | -1 = u.team === "enemy" ? -1 : 1;
        body.scale.x = absScale * facing;

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
          facing, // team default at rest (enemy=left, player=right); set on engage
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

      applyMapRef.current = applyMap;

      // ---- Playback primitives (all genId/destroyed-aware) ----
      function wait(ms: number): Promise<void> {
        return new Promise((res) => {
          const id = setTimeout(res, ms);
          cleanups.push(() => clearTimeout(id));
        });
      }
      // =============================================================================
      // SECTION > battleReplay: choreography core (KEEP co-located behind StageCtx; spell slice = flyProjectile + spellcast branch of runBeat)
      // Seam (Phase 3 -> stays for now): tween, playOnce, spawnDamage, updateHp, flashHit, knockback, flyProjectile, doMove, doAttack, doDeath, runBeat, runReplay
      // Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
      // =============================================================================
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
        // magnifies it by the live-tile/reference scale (+ board zoom). Rasterize fine enough to
        // stay crisp through that upscale (capped to avoid huge glyph textures).
        t.resolution = Math.min(
          4,
          (window.devicePixelRatio || 1) *
            Math.max(1, (boardLayout.tileW / TW0) * boardLayout.boardScale),
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

      // A spell projectile: an AnimatedSprite that flies caster -> target along a
      // straight line over SPELL_FLIGHT_MS, then destroys itself. Empty frames (no
      // projectile art) -> just wait the span so impact still lands on arrival.
      function flyProjectile(
        spellId: string,
        from: HexPosition,
        to: HexPosition,
        myId: number,
      ): Promise<void> {
        const sp = (config.spells ?? []).find((s) => s.id === spellId);
        const frames = sp ? framesForKey(sp.animationKey) : [];
        // SpellDef visual config: flight time, render offset, orientation.
        const flightMs = (sp?.duration ?? DEFAULT_SPELL_DURATION) * 1000;
        const offX = sp?.offsetX ?? 0;
        const offY = sp?.offsetY ?? 0;
        const pa = pixelOf(from.q, from.r);
        const pb = pixelOf(to.q, to.r);
        // Shift both endpoints by the offset so the whole straight line translates.
        const a = { x: pa.x + offX, y: pa.y + offY };
        const b = { x: pb.x + offX, y: pb.y + offY };
        if (!frames.length) return wait(flightMs); // no art -> preserve timing
        const proj = new AnimatedSprite(frames);
        proj.anchor.set(0.5);
        proj.loop = sp?.loop ?? true; // false -> frames play once (flight unchanged)
        const k = (boardLayout.tileW / TW0) * (sp?.scale ?? 1);
        proj.scale.set(k, k);
        proj.animationSpeed = (sp?.fps ?? DEFAULT_SPELL_FPS) / TICKER_FPS;
        proj.rotation =
          Math.atan2(b.y - a.y, b.x - a.x) + ((sp?.rotation ?? 0) * Math.PI) / 180;
        proj.position.set(a.x, a.y);
        proj.zIndex = 9999;
        unitsLayer.addChild(proj);
        proj.play();
        return tween(
          flightMs,
          (p) => {
            const e = easeInOutQuad(p);
            proj.position.set(lerp(a.x, b.x, e), lerp(a.y, b.y, e));
          },
          myId,
        ).then(() => {
          try {
            proj.destroy();
          } catch {
            /* already torn down */
          }
        });
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
        // Face the target by board row: LEFT if the target sits in a lower row,
        // RIGHT if higher; unchanged (default right) for same-row / no-target.
        // Flip the BODY sprite only — never the node, which also carries the HP
        // bar + damage numbers (flipping it would mirror them). absScale keeps the
        // body's natural size; su.facing is the only sign that changes.
        if (target) {
          su.facing = target.r < su.r ? 1 : -1;
          su.body.scale.x = su.absScale * su.facing;
        }
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
              su.node.x =
                ox + dir * boardLayout.tileW * 0.28 * Math.sin(p * Math.PI);
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
          } else if (ev.kind === "spellcast") {
            const src = sprites[ev.sourceId];
            const tgt = sprites[ev.targetId];
            const ids = [ev.sourceId, ev.targetId].filter((id) => sprites[id]);
            tasks.push(
              schedule(ids, async () => {
                // Cast wind-up reuses the attack pose (+ facing), THEN the
                // projectile flies; HP/number land on arrival (impact-after-flight).
                if (src && !src.dead) await doAttack(src, tgt, myId);
                await flyProjectile(ev.spellId, ev.from, ev.to, myId);
                if (destroyed || genId !== myId || !tgt) return;
                await Promise.all([
                  updateHp(tgt, ev.targetHp, myId),
                  flashHit(tgt, myId),
                ]);
                spawnDamage(tgt, ev.damage, "skill", myId); // reuse gold "!" style
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
          su.facing = su.team === "enemy" ? -1 : 1; // team default: enemy left, player right
          su.body.scale.x = su.absScale * su.facing; // facing on the BODY, not the node
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

export type BuildUnit = {
  uid: string;
  characterId: string;
  slot: number; // deploy index 0..maxPerSide-1 (NOT a raw q)
  stats: UnitStats;
  // Tracked top-level (clampStats normalizes only the numeric stats); merged
  // back into `stats` when building the resolve payload. Default "melee".
  attackType: "melee" | "ranged";
};

const genUid = () => Math.random().toString(36).slice(2, 9);

/** A possibly-absent attackType -> a definite 2-state value (default melee). */
const attackTypeOf = (t: unknown): "melee" | "ranged" =>
  t === "ranged" ? "ranged" : "melee";

/**
 * Sanitize one persisted roster entry into a live BuildUnit, or null to drop it.
 * Defensive against schema drift / hand-edited data: drops units whose
 * characterId is no longer in the live roster, clamps the slot to range, defaults
 * a missing/odd attackType to melee, and re-clamps stats over sensible defaults.
 */
function sanitizeBuildUnit(raw: any, validIds: Set<string>): BuildUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const characterId = typeof raw.characterId === "string" ? raw.characterId : "";
  if (!validIds.has(characterId)) return null; // not in the live roster -> drop
  const base = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
  const stats = clampStats({
    ...DEFAULT_STATS,
    ...base,
    skills: Array.isArray(base.skills) ? base.skills : [],
  });
  return {
    uid: typeof raw.uid === "string" ? raw.uid : genUid(),
    characterId,
    slot: clamp(Math.round(Number(raw.slot)) || 0, 0, BOARD.maxPerSide - 1),
    stats,
    attackType: attackTypeOf(raw.attackType),
  };
}

/**
 * Rebuild the saved builder parties from `cfg.roster`, validated against the live
 * roster. Returns null when the roster is absent / not an object / yields no
 * usable units on either side, so the caller falls back to the default matchup.
 */
function restoreParties(
  cfg: BootstrapConfig,
): { players: BuildUnit[]; enemies: BuildUnit[] } | null {
  const r = cfg.roster;
  if (!r || typeof r !== "object") return null;
  const validIds = new Set(buildRoster(cfg).map((c) => c.id));
  const conv = (arr: unknown): BuildUnit[] =>
    (Array.isArray(arr) ? arr : [])
      .map((u) => sanitizeBuildUnit(u, validIds))
      .filter((u): u is BuildUnit => u !== null)
      .slice(0, BOARD.maxPerSide);
  const players = conv(r.players);
  const enemies = conv(r.enemies);
  if (players.length === 0 && enemies.length === 0) return null;
  return { players, enemies };
}

// BoardPreview extracted -> ./BoardPreview.tsx (Phase 1)
/* ------------------------------------------------------------------ *
 * MockBattleClient — top-level page client
 * ------------------------------------------------------------------ */

// =============================================================================
// SECTION > MockBattleClient: party-builder state + persisted roster (page shell)
// Seam (stays - page entry): MockBattleClient
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================
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
  // and unrotated), restore on toggle off. While it's on, saves are
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

  // Persist the BUILDER party selection (both parties) server-side, debounced
  // (~400ms trailing) like the dmgCfg/mapCfg saves: a ref-held timeout + refs
  // holding the live parties (read at fire time), cleared on unmount. ONLY the
  // mutators call schedulePartySave — never the load/seed path — so hydration
  // never re-saves, and transient replay state is excluded by construction.
  const playersRef = useRef(players);
  playersRef.current = players;
  const enemiesRef = useRef(enemies);
  enemiesRef.current = enemies;
  const rosterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePartySave = useCallback(() => {
    if (rosterSaveTimer.current) clearTimeout(rosterSaveTimer.current);
    rosterSaveTimer.current = setTimeout(() => {
      fetch("/api/config/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roster: { players: playersRef.current, enemies: enemiesRef.current },
        }),
      }).catch(() => {});
    }, 400);
  }, []);
  useEffect(
    () => () => {
      if (rosterSaveTimer.current) clearTimeout(rosterSaveTimer.current);
    },
    [],
  );

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
      // Restore the saved builder parties when present + valid (validated against
      // the live roster); otherwise seed a default matchup from the playable
      // roster — first character vs the next distinct one — so "Start battle"
      // works immediately and stays correct for any roster (no hardcoded ids).
      // setPlayers/setEnemies directly (not the mutators) so hydration never saves.
      const restored = restoreParties(cfg);
      if (restored) {
        setPlayers(restored.players);
        setEnemies(restored.enemies);
      } else {
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
              attackType: attackTypeOf(cfg.battleStats?.[playerChar.id]?.attackType),
            },
          ]);
          setEnemies([
            {
              uid: genUid(),
              characterId: enemyChar.id,
              slot: mid,
              stats: statsFor(cfg, enemyChar.id),
              attackType: attackTypeOf(cfg.battleStats?.[enemyChar.id]?.attackType),
            },
          ]);
        }
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
      {
        uid: genUid(),
        characterId: charId,
        slot: nextFreeSlot(list),
        stats: statsFor(config, charId),
        attackType: attackTypeOf(config.battleStats?.[charId]?.attackType),
      },
    ]);
    schedulePartySave();
  }
  function removeUnit(team: Team, uid: string) {
    const { list, setList } = partyOps(team);
    setList(list.filter((u) => u.uid !== uid));
    schedulePartySave();
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
    schedulePartySave();
  }
  function setStat(team: Team, uid: string, key: keyof UnitStats, value: number) {
    const { list, setList } = partyOps(team);
    setList(
      list.map((u) =>
        u.uid === uid ? { ...u, stats: { ...u.stats, [key]: value } } : u,
      ),
    );
    schedulePartySave();
  }
  function setAttackType(team: Team, uid: string, attackType: "melee" | "ranged") {
    const { list, setList } = partyOps(team);
    setList(list.map((u) => (u.uid === uid ? { ...u, attackType } : u)));
    schedulePartySave();
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
    schedulePartySave();
  }

  async function startFight() {
    if (!config || players.length === 0 || enemies.length === 0) return;
    // Resolve each member's owned spell ids -> the engine's SpellInput configs.
    const spellById = new Map(
      (config.spells ?? []).map((s) => [s.id, s] as const),
    );
    const spellsFor = (charId: string): SpellInput[] =>
      (config.characterSpells?.[charId] ?? [])
        .map((id) => spellById.get(id))
        .filter((s): s is SpellDef => !!s)
        .map((s) => ({
          id: s.id,
          power: s.power,
          cooldown: s.cooldown,
          type: s.type,
          animationKey: s.animationKey,
        }));
    const toInput =
      (team: Team) =>
      (u: BuildUnit): PartyMemberInput => ({
        characterId: u.characterId,
        // Merge the per-unit attack type back into the stats sent to the engine
        // (clampStats normalizes only the numeric fields).
        stats: { ...clampStats(u.stats), attackType: u.attackType },
        position: deployHex(team, u.slot),
        spells: spellsFor(u.characterId),
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
                  onAttackType={(uid, t) => setAttackType("player", uid, t)}
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
                  onAttackType={(uid, t) => setAttackType("enemy", uid, t)}
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

// PartyColumn extracted -> ./PartyColumn.tsx (Phase 1)
// DisplayConfigPanel extracted -> ./DisplayConfigPanel.tsx (Phase 1)
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
.mb-atk-pill {
  height: 24px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.55); font-size: 11px; font-family: system-ui, sans-serif;
  transition: all 0.12s;
}
.mb-atk-pill:hover { border-color: rgba(255,255,255,0.3); }
.mb-party.player .mb-atk-pill.on { background: rgba(56,224,196,0.25); border-color: #38e0c4; color: #fff; }
.mb-party.enemy .mb-atk-pill.on { background: rgba(255,93,115,0.25); border-color: #ff5d73; color: #fff; }

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
