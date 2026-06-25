"use client";

import { useRef, useEffect, useState } from "react";
import type {
  BattleEvent,
  BattleEventRole,
  CharacterRoleMap,
  DamageConfig as DamageCfg,
  HexPosition,
  MapConfig,
  ResolveResult,
  BattleRewardDef,
  SpellDef,
  SpellTextConfig as SpellTextCfg,
  Team,
  UnitStats,
} from "@/lib/battle/types";
export type { DamageCfg, SpellTextCfg };
import {
  BOARD,
  DEFAULT_SPELL_DURATION,
  DEFAULT_SPELL_FPS,
  DEFAULT_SPELL_TRANSITION,
  SPELL_FADE_MS,
} from "@/lib/battle/types";
import { isoPos, getHexRowsFromCounts, assetUrl, playSound } from "../studioHelpers";
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
const HPBAR_MS = 180;
export const INTER_BEAT_MS = 80; // breathing room between equal-`t` beats

/** 2:1 isometric geometry (tile height = tile width * ISO_RATIO), matching the studio iso grid. */
export const ISO_RATIO = 0.5;

/** Map-config defaults (mirror the server's GET /api/config fallback). */
export const DEFAULT_MAP: MapConfig = {
  tileWidth: 72,
  tileHeightRatio: 0.5,
  scale: 1,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
};
/** Server-enforced bounds; UI ranges align so input isn't silently clamped. */
export const MAP_BOUNDS = {
  tileWidth: { min: 16, max: 400 },
  tileHeightRatio: { min: 0.1, max: 1 },
  scale: { min: 0.25, max: 4 },
  rotation: { min: -180, max: 180 },
  rotationX: { min: -80, max: 80 },
  rotationY: { min: -80, max: 80 },
} as const;

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function lerp(a: number, b: number, p: number) {
  return a + (b - a) * p;
}
function easeOutCubic(p: number) {
  return 1 - Math.pow(1 - p, 3);
}
function easeInOutQuad(p: number) {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}
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
export const DEPLOY_QS: Record<Team, number[]> = {
  player: BOARD_ROWS[BOARD_ROWS.length - 1],
  enemy: BOARD_ROWS[0],
};
export function deployHex(team: Team, slot: number): HexPosition {
  return {
    q: DEPLOY_QS[team][slot],
    r: team === "player" ? BOARD.playerRow : BOARD.enemyRow,
  };
}

/** Every deploy/transit hex on the board, used when a snapshot omits `hexes`. */
export function genHexes(): HexPosition[] {
  const cR = (BOARD_ROWS.length - 1) / 2;
  const out: HexPosition[] = [];
  BOARD_ROWS.forEach((cols, ri) => {
    const r = ri - cR;
    cols.forEach((q) => out.push({ q, r }));
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Bootstrap config shape (from GET /api/config). battleStats/roleMaps
 * are read defensively — they may not be surfaced yet (Lane B).
 * ------------------------------------------------------------------ */

export type BootstrapConfig = {
  characters: Array<{ id: string; name: string }>;
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
  spellTextConfig?: SpellTextCfg;
  spells?: SpellDef[];
  battleRewards?: BattleRewardDef[];
  characterSpells?: Record<string, string[]>;
  // Last-saved mock-battle builder parties (opaque to the server). null/absent
  // until the user edits a party; restored on load, persisted (debounced) on edit.
  roster?: { players: any[]; enemies: any[] } | null;
};

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

export type StageProps = {
  result: ResolveResult;
  config: BootstrapConfig;
  userId?: string; // Firebase UID for server-persisted stats (totalExp, etc.)
  controlsRef: React.MutableRefObject<{ replay: () => void; getManaCount: () => number } | null>;
  // Live damage-number config. A stable ref (never in the effect deps) so the
  // panel can retune numbers mid-battle without tearing down the Pixi app.
  dmgCfgRef: React.MutableRefObject<DamageCfg>;
  // Live spell-text config. Same stable-ref pattern as dmgCfgRef — the panel
  // retunes spell-name shout knobs mid-battle without tearing down Pixi.
  spellTextCfgRef: React.MutableRefObject<SpellTextCfg>;
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
  // Optional live pause flag for game-screen HUDs. Kept as a ref so toggling pause
  // never tears down the Pixi app/replay effect.
  pausedRef?: React.MutableRefObject<boolean>;
  onUnitHpChange?: (unitId: string, hp: number) => void;
  onReady: () => void;
  onEnd: (r: "win" | "lose" | "draw") => void;
};

function BattleStage({
  result,
  config,
  userId,
  controlsRef,
  dmgCfgRef,
  spellTextCfgRef,
  redrawHealthBarsRef,
  mapCfgRef,
  applyMapRef,
  showGridRef,
  gridVisibleRef,
  pausedRef,
  onUnitHpChange,
  onReady,
  onEnd,
}: StageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const localPausedRef = useRef(false);
  const activePausedRef = pausedRef ?? localPausedRef;

  // ---- Persistent Pixi instance (survives re-fights) ----
  // Effect 1: create Pixi once, load UI spritesheets, return cleanup = destroy on unmount.
  // Effect 2: load battle-specific data & replay on every result/config change.
  const pixiCtx = useRef<{
    gameplayApp: any;
    uiApp: any;
    manaTank: any;
    manaCountText: any;
    manaCount: number; // crystals collected this session (0-10)
    expByChar: Record<string, number>; // characterId → total EXP earned
    crystalShardTex: any;
    pixi: { Application: any; Assets: any; AnimatedSprite: any; Graphics: any; Spritesheet: any; Text: any; Container: any; Sprite: any };
  } | null>(null);
  const [pixiReady, setPixiReady] = useState(false);

  // Effect 1 — Pixi + UI (runs once, creates two apps: gameplay + UI overlay)
  useEffect(() => {
    const container = containerRef.current!;
    let destroyed = false;
    let gameplayApp: any = null;
    let uiApp: any = null;
    let pauseRaf = 0;
    const cleanups: Array<() => void> = [];

    async function initPixi() {
      const pixi = await import("pixi.js");
      const { Application, Assets, AnimatedSprite, Spritesheet, Text } = pixi as any;
      if (destroyed) return;

      // Gameplay wrapper (bottom layer)
      const gWrapper = document.createElement("div");
      gWrapper.style.cssText = "position:absolute; inset:0;";
      container.appendChild(gWrapper);

      // UI wrapper (top layer — mana gauge, HUD)
      const uWrapper = document.createElement("div");
      uWrapper.style.cssText = "position:absolute; inset:0; pointer-events:none; z-index:10;";
      container.appendChild(uWrapper);

      const MAX_RENDER_SCALE = 2;
      gameplayApp = new Application();
      await gameplayApp.init({
        resizeTo: gWrapper,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE),
        autoDensity: true,
      });
      if (destroyed) { gameplayApp.destroy(); return; }
      gWrapper.appendChild(gameplayApp.canvas);

      uiApp = new Application();
      await uiApp.init({
        resizeTo: uWrapper,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE),
        autoDensity: true,
      });
      if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }
      uWrapper.appendChild(uiApp.canvas);

      // Ticker pause (both apps)
      const syncPause = () => {
        if (gameplayApp?.ticker) gameplayApp.ticker.speed = 0;
        if (uiApp?.ticker) uiApp.ticker.speed = 0;
        if (!destroyed) pauseRaf = requestAnimationFrame(syncPause);
      };
      syncPause();
      cleanups.push(() => { cancelAnimationFrame(pauseRaf); if (gameplayApp?.ticker) gameplayApp.ticker.speed = 1; if (uiApp?.ticker) uiApp.ticker.speed = 1; });

      // ---- Load UI spritesheets FIRST (mana tank) ----
      let manaFrames: any[] | null = null;
      let manaTank: any | null = null;
      let crystalShardTex: any | null = null;
      try {
        const manaTexture = await Assets.load("/assets/ui/mana-tank-spritesheet.png");
        if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }
        const manaResp = await fetch("/assets/ui/mana-tank-spritesheet.json");
        const manaJson = await manaResp.json();
        const manaSheet = new Spritesheet(manaTexture, manaJson);
        await manaSheet.parse();
        manaFrames = Object.keys(manaSheet.data.frames).map(
          (n: string) => manaSheet.textures[n],
        );
      } catch (err) {
        console.warn("mock-battle: mana tank sheet failed", err);
      }
      if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }

      // Load crystal shard texture (single image, no spritesheet)
      try {
        crystalShardTex = await Assets.load("/assets/ui/crystal-shard.png");
      } catch (err) {
        console.warn("mock-battle: crystal shard load failed", err);
      }
      if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }

      if (manaFrames && manaFrames.length > 0) {
        manaTank = new AnimatedSprite(manaFrames);
        manaTank.anchor.set(0.5);
        manaTank.scale.set(0.25);
        manaTank.position.set(60, 60);
        manaTank.zIndex = 9998;
        manaTank.loop = false;
        manaTank.currentFrame = 0;
        manaTank.stop();
        uiApp.stage.addChild(manaTank);
      }

      // Font load
      try {
        await document.fonts.load(`400 32px ${dmgFont.style.fontFamily}`);
      } catch { /* fallback */ }
      if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }

      // Fetch per-character EXP from server
      let expByChar: Record<string, number> = {};
      try {
        if (userId) {
          const resp = await fetch(`/api/user/characters?userId=${encodeURIComponent(userId)}`);
          const data = await resp.json();
          if (data.ok && Array.isArray(data.characters)) {
            for (const c of data.characters) {
              expByChar[c.characterId] = c.exp ?? 0;
            }
          }
        }
      } catch { /* server unavailable */ }
      if (destroyed) { gameplayApp.destroy(); uiApp.destroy(); return; }

      // Mana count text (right of gauge) — shows first character's EXP
      const primaryChar = Object.keys(expByChar)[0] || "blue";
      let manaCountText: any = null;
      if (manaTank) {
        manaCountText = new Text("0/10", {
          fontFamily: dmgFont.style.fontFamily,
          fontSize: 16,
          fill: 0x88ccff,
          fontWeight: "bold",
        });
        manaCountText.anchor.set(0, 0.5);
        manaCountText.position.set(85, 65);
        manaCountText.zIndex = 9999;
        uiApp.stage.addChild(manaCountText);
        // Mana tank starts empty (frame 0); updated by manaCount in spawnCrystalShard
        manaTank.currentFrame = 0;
      }

      // Store in ref for Effect 2
      pixiCtx.current = { gameplayApp, uiApp, manaTank, manaCountText, manaCount: 0, expByChar, crystalShardTex, pixi };
      setPixiReady(true);
    }

    initPixi().catch(console.error);

    return () => {
      destroyed = true;
      cancelAnimationFrame(pauseRaf);
      for (const c of cleanups) c();
      if (gameplayApp) { try { gameplayApp.destroy(); } catch { /* ignore */ } }
      if (uiApp) { try { uiApp.destroy(); } catch { /* ignore */ } }
      pixiCtx.current = null;
      container.innerHTML = "";
    };
  }, []);

  // Effect 2 — battle load + replay (runs on every result/config change)
  useEffect(() => {
    const ctx = pixiCtx.current;
    if (!ctx || !result) return;

    const pixiApp = ctx!.gameplayApp;
    const container = containerRef.current!;
    let destroyed = false;
    let genId = 0;
    const cleanups: Array<() => void> = [];

    async function runBattle() {
      const pixi = ctx!.pixi;
      const { Application: _, Assets, AnimatedSprite, Graphics, Spritesheet, Text, Container, Sprite } = pixi;
      const manaTank = ctx!.manaTank;
      const manaCountText = ctx!.manaCountText;
      const crystalShardTex = ctx!.crystalShardTex;

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
      // e.g. a "-copy" variant -> its base. Walk the full chain, guarding cycles.
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
            const texture = await Assets.load(assetUrl(c.image));
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
        soundForRole,
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
      // Destroy old viewport on re-fight (clears all previous units/board)
      cleanups.push(() => { try { pixiApp.stage.removeChild(viewport); viewport.destroy({ children: true }); } catch {} });
      const board = new Container();
      viewport.addChild(board);
      const sprites: Record<string, SpriteUnit> = {};
      const initialById: Record<string, { q: number; r: number; hp: number }> = {};

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
        const barY = su.dispH * 0.15 + cfg.barGap * pxScale;
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
        // Fill from bottom: position fill at bottom of bar, height = hpRatio * barH
        const fillH = barH * hpRatio;
        su.hpFill.roundRect(0, barY + barH - fillH, barW, fillH, 2).fill({ color: 0xffffff });
        su.hpFill.position.x = -barW / 2;
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
        initialById[u.id] = { q: u.position.q, r: u.position.r, hp: u.hp };
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
          let raf = 0;
          let elapsed = 0;
          let last = performance.now();
          const step = (now: number) => {
            if (destroyed) {
              res();
              return;
            }
            if (!activePausedRef.current) elapsed += now - last;
            last = now;
            if (elapsed >= ms) res();
            else raf = requestAnimationFrame(step);
          };
          raf = requestAnimationFrame(step);
          cleanups.push(() => cancelAnimationFrame(raf));
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
          let elapsed = 0;
          let last = performance.now();
          let raf = 0;
          const step = (now: number) => {
            if (destroyed || genId !== myId) {
              res();
              return;
            }
            if (!activePausedRef.current) elapsed += now - last;
            last = now;
            const p = Math.min(1, elapsed / ms);
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
          playSound(soundForRole(su.characterId, role));
          su.body.play();
          wait(durSec * 1000 + 90).then(finish);
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

      // The casting unit "shouts" the spell's name — a floating name callout
      // above the caster at cast time (mirrors spawnDamage's text float/fade).
      function spawnSpellShout(su: SpriteUnit, name: string, myId: number) {
        if (!name) return;
        const cfg = spellTextCfgRef.current;
        const t = new Text({
          text: name.toUpperCase(),
          style: {
            fontFamily: dmgFont.style.fontFamily,
            fontSize: cfg.size * TW0,
            fontWeight: "700",
            fill: 0xeaf2ff,
            stroke: { color: 0x1b3a7a, width: cfg.stroke * pxScale },
          },
        });
        t.resolution = Math.min(
          4,
          (window.devicePixelRatio || 1) *
            Math.max(1, (boardLayout.tileW / TW0) * boardLayout.boardScale),
        );
        t.anchor.set(0.5);
        // Centered above the caster's head, parented to the node so it tracks +
        // billboards/scales with the unit (like the damage numbers do).
        const baseX = TW0 * cfg.offsetX;
        const baseY = -su.dispH - TW0 * (cfg.height + cfg.offsetY);
        t.position.set(baseX, baseY);
        su.node.addChild(t);
        tween(
          cfg.durationMs,
          (p) => {
            // Quick pop-in (scale + fade-in), then drift up and fade out.
            const popIn = Math.min(1, p / 0.18);
            const sc = 0.55 + 0.6 * easeOutCubic(popIn);
            t.scale.set(sc, sc);
            t.position.y = baseY - TW0 * cfg.rise * easeOutCubic(p);
            if (p < 0.18) {
              t.alpha = popIn;
            } else {
              const f = (p - 0.18) / 0.82;
              t.alpha = 1 - f * f;
            }
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
        onUnitHpChange?.(su.id, newHp);
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
      // straight line, then destroys itself. SCREEN-SPACE overlay matching the spell-
      // editor preview exactly (correct size + per-axis proportion + upright orientation).
      // Uses board.toGlobal to lift board-local pixel coords into screen space, then
      // applies the same base scale formula the preview uses — /cos per axis, tileW/72
      // ratio, boardScale * fitScale — producing a projectile that reads at the same
      // size and aspect as the Canvas2D preview. Empty frames (no projectile art) ->
      // just wait the span so impact still lands on arrival.
      function flyProjectile(
        spellId: string,
        from: HexPosition,
        to: HexPosition,
        myId: number,
      ): Promise<void> {
        const sp = (config.spells ?? []).find((s) => s.id === spellId);
        const frames = sp ? framesForKey(sp.animationKey) : [];
        const flightMs = (sp?.duration ?? DEFAULT_SPELL_DURATION) * 1000;
        if (!frames.length) return wait(flightMs); // no art -> preserve impact timing

        const pa = pixelOf(from.q, from.r);
        const pb = pixelOf(to.q, to.r);

        const cX = Math.cos(boardLayout.rotXRad);
        const cY = Math.cos(boardLayout.rotYRad);
        const fitScale =
          Math.min(pixiApp.screen.width, pixiApp.screen.height) / 640; // BOARD_REF_SIDE
        const base =
          boardLayout.boardScale *
          fitScale *
          (boardLayout.tileW / DEFAULT_MAP.tileWidth); // /72, NOT TW0
        const spriteScaleX = ((sp?.scaleX ?? 1) * base) / cY;
        const spriteScaleY = ((sp?.scaleY ?? 1) * base) / cX;
        const spellRot = ((sp?.rotation ?? 0) * Math.PI) / 180;
        const offX = sp?.offsetX ?? 0;
        const offY = sp?.offsetY ?? 0;
        // board.toGlobal converts board-local coords -> screen space, matching how the
        // preview lifts iso-positions through its transform. Offsets are then applied
        // in screen space (negated Y so +offsetY still means up).
        const project = (bx: number, by: number) => {
          const s = board.toGlobal({ x: bx, y: by });
          return { x: s.x + offX, y: s.y - offY };
        };
        const a0 = project(pa.x, pa.y);
        const b0 = project(pb.x, pb.y);
        const travelAngle = Math.atan2(b0.y - a0.y, b0.x - a0.x) + spellRot;

        const proj = new AnimatedSprite(frames);
        proj.anchor.set(0.5);
        proj.loop = sp?.loop ?? true;
        proj.animationSpeed = (sp?.fps ?? DEFAULT_SPELL_FPS) / TICKER_FPS;
        proj.scale.set(spriteScaleX, spriteScaleY);
        proj.rotation = travelAngle;
        proj.position.set(a0.x, a0.y);
        proj.zIndex = 9999;
        pixiApp.stage.addChild(proj);
        proj.play();

        const fadeMs = Math.min(SPELL_FADE_MS, flightMs / 2);
        const transIn = sp?.transitionIn ?? DEFAULT_SPELL_TRANSITION;
        const transOut = sp?.transitionOut ?? DEFAULT_SPELL_TRANSITION;
        return tween(
          flightMs,
          (p) => {
            const e = easeInOutQuad(p);
            const lp = project(lerp(pa.x, pb.x, e), lerp(pa.y, pb.y, e));
            proj.position.set(lp.x, lp.y);
            // Alpha fade for transition-in/out, matching the editor preview.
            const elapsed = p * flightMs;
            if (transIn === "fade" && elapsed < fadeMs) {
              proj.alpha = elapsed / fadeMs;
            } else if (transOut === "fade" && flightMs - elapsed <= fadeMs) {
              proj.alpha = (flightMs - elapsed) / fadeMs;
            } else {
              proj.alpha = 1;
            }
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
        // Move animation intentionally removed (all units): the unit glides in
        // its current idle pose while the position tween runs below.
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

      // ---- Crystal shard: drop from dying enemy, fly to mana gauge ----
      async function spawnCrystalShard(x: number, y: number, myId: number) {
        if (!crystalShardTex) return;
        playSound("audio/crystal-absorb.wav", 2);
        // Increment mana count (visual counter, not synced to gauge frame)
        ctx!.manaCount = Math.min(10, (ctx!.manaCount ?? 0) + 1);
        if (manaCountText) manaCountText.text = `${ctx!.manaCount}/10`;
        // Snap mana tank frame to crystal count
        const MANA_FRAMES = [33, 37, 41, 52, 63, 74, 85, 96, 96, 107];
        const idx = Math.min(ctx!.manaCount - 1, MANA_FRAMES.length - 1);
        if (ctx!.manaTank) ctx!.manaTank.currentFrame = Math.min(107, MANA_FRAMES[idx]);

        const shard = new Sprite(crystalShardTex);
        shard.anchor.set(0.5);
        shard.position.set(x, y);
        shard.alpha = 0;
        shard.zIndex = 9999;
        shard.scale.set(0.25);
        pixiApp.stage.addChild(shard);
        cleanups.push(() => { try { shard.destroy(); } catch {} });
        // Phase 1: fade in + drop down
        await tween(250, (p) => {
          shard.alpha = Math.min(1, p * 3);
          shard.position.y = y + 30 * easeOutCubic(p);
        }, myId);
        if (destroyed || genId !== myId) return;
        // Phase 2: fly to mana tank (top-left 60,60) — stay fully visible, shrink only
        const startX = shard.position.x;
        const startY = shard.position.y;
        const tx = 60; const ty = 60;
        await tween(400, (p) => {
          const e = easeOutCubic(p);
          shard.position.x = startX + (tx - startX) * e;
          shard.position.y = startY + (ty - startY) * e;
          shard.scale.set(0.25 * (1 - e * 0.5));
        }, myId);
        // Phase 3: slow fade out at mana tank
        await tween(500, (p) => {
          shard.alpha = 1 - easeOutCubic(p);
        }, myId);
        shard.destroy();
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
                if (src && !src.dead) {
                  // The caster shouts the spell's name as the cast begins.
                  const spellName = (config.spells ?? []).find(
                    (s) => s.id === ev.spellId,
                  )?.name;
                  if (spellName) spawnSpellShout(src, spellName, myId);
                  await doAttack(src, tgt, myId);
                }
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
            // Spawn crystal shard when enemy dies — fire-and-forget, don't block other animations
            if (su && su.team === "enemy" && crystalShardTex) {
              const pos = su.node.getGlobalPosition();
              spawnCrystalShard(pos.x, pos.y, myId).catch(() => {});
            }
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
          su.hp = init.hp;
          onUnitHpChange?.(su.id, init.hp);
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
          const hpRatio = Math.max(0.0001, Math.min(1, su.hp / su.maxHp));
          su.hpFill.scale.x = hpRatio;
          su.hpFill.tint = hpColor(hpRatio);
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
        // ---- EXP accumulation (post-battle) ----
        // Characters that died this battle lose all campaign EXP.
        const deadCharIds = new Set<string>();
        for (const ev of result.events ?? []) {
          if (ev.kind === "death" && ev.unitId?.startsWith("player-")) {
            const parts = ev.unitId.split("-");
            const charId = parts.length >= 3 ? parts.slice(1, -1).join("-") : ev.unitId;
            deadCharIds.add(charId);
          }
        }
        for (const charId of deadCharIds) {
          ctx!.expByChar[charId] = 0;
        }
        // Add new EXP for surviving characters.
        if (result.expGains) {
          const entries = Object.entries(result.expGains).filter(([, v]) => v > 0);
          for (const [unitId, exp] of entries) {
            const parts = unitId.split("-");
            const charId = parts.length >= 3 ? parts.slice(1, -1).join("-") : unitId;
            if (!deadCharIds.has(charId)) {
              ctx!.expByChar[charId] = (ctx!.expByChar[charId] ?? 0) + exp;
            }
            }
            // Persist per-character EXP to server
            if (userId) {
              for (const [charId, exp] of Object.entries(ctx!.expByChar)) {
                fetch("/api/user/characters", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId, characterId: charId, exp }),
                }).catch(() => {});
              }
            }
        }
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
        getManaCount: () => ctx!.manaCount ?? 0,
      };
      onReady();
      runReplay().catch(console.error);
    }

    runBattle().catch(console.error);

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
      // DON'T destroy pixiApp — it's owned by Effect 1 and persists across re-fights.
      // DON'T clear container innerHTML — that would remove the Pixi canvas too.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, pixiReady]);

  return <div ref={containerRef} className="mb-stage" />;
}

export default BattleStage;
