import type { MutableRefObject } from "react";
import type {
  Application as PixiApplication,
  Container as PixiContainer,
  Graphics as PixiGraphics,
} from "pixi.js";
import type { HexPosition, MapConfig } from "@/lib/battle/types";
import { BOARD } from "@/lib/battle/types";
import { isoHex, isoPos } from "../studioHelpers";

// =============================================================================
// SECTION > battleBoard: iso geometry, grid, layout
// Seam (Phase 2 -> battleBoard.ts): centerBoard, drawGrid, relayout, applyMap, pixelOf
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

type BattleMapBounds = {
  tileWidth: { min: number; max: number };
  tileHeightRatio: { min: number; max: number };
  scale: { min: number; max: number };
  rotation: { min: number; max: number };
  rotationX: { min: number; max: number };
  rotationY: { min: number; max: number };
};

type BattleBoardSprite = {
  q: number;
  r: number;
  node: {
    position: { set(x: number, y: number): void };
    rotation: number;
    scale: { set(x: number, y: number): void };
  };
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export type BattleBoardCtx = {
  pixiApp: PixiApplication;
  board: PixiContainer;
  viewport: PixiContainer;
  grid: PixiGraphics;
  sprites: Record<string, BattleBoardSprite>;
  hexes: HexPosition[];
  TW0: number;
  boardLayout: {
    tileW: number;
    ratio: number;
    boardScale: number;
    rotRad: number;
    rotXRad: number;
    rotYRad: number;
  };
  mapCfgRef: MutableRefObject<MapConfig>;
  MAP_BOUNDS: BattleMapBounds;
};

export function createBattleBoard(ctx: BattleBoardCtx) {
  const {
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
  } = ctx;

  const pixelOf = (q: number, r: number) =>
    isoPos(q, r, boardLayout.tileW, boardLayout.tileW * boardLayout.ratio);

  function centerBoard() {
    const hw = boardLayout.tileW / 2;
    const hh = (boardLayout.tileW * boardLayout.ratio) / 2;
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
    board.rotation = boardLayout.rotRad;
    // Viewport: overall zoom + pitch/yaw foreshorten, around the screen center.
    viewport.pivot.set(0, 0);
    viewport.rotation = 0;
    // Responsive fit: the mapConfig (tileWidth/scale) is MASTER DATA authored
    // against a reference square field of BOARD_REF_SIDE px. Scale the whole
    // board by (live field side / reference) so it occupies the SAME fraction
    // of the field at ANY size — fixing the "doesn't scale even at 1:1" gap
    // where the absolute-px board floated at a fixed size while the bg filled.
    // centerBoard re-runs on resize, so this stays live; units / HP bars /
    // damage ride the board and track it for free (TW0 cancels out of the
    // footprint, so their relative proportions and crispness are unchanged).
    const BOARD_REF_SIDE = 640; // px; the field side the board view is tuned at
    const fitScale =
      Math.min(pixiApp.screen.width, pixiApp.screen.height) / BOARD_REF_SIDE;
    viewport.scale.set(
      boardLayout.boardScale * fitScale * Math.cos(boardLayout.rotYRad),
      boardLayout.boardScale * fitScale * Math.cos(boardLayout.rotXRad),
    );
    // Bottom-anchor the board to the center band: drop it so the front-most
    // tile edge rests just inside the bottom border (the Pixi host fills
    // .gss-center-field, so screen.height === that band's bottom), leaving
    // the headroom above for the upright units instead of dead space below.
    // The board's lowest point lies (|halfW·sinθ| + |halfH·cosθ|) below its
    // pivot in board space (θ = the in-plane Z-rotation); the viewport's
    // vertical zoom (matching scale.y above) converts
    // that to screen px.
    const halfW = (xX - nX) / 2;
    const halfH = (xY - nY) / 2;
    const bottomDrop =
      (Math.abs(halfW * Math.sin(boardLayout.rotRad)) +
        Math.abs(halfH * Math.cos(boardLayout.rotRad))) *
      boardLayout.boardScale *
      fitScale *
      Math.cos(boardLayout.rotXRad);
    const BOTTOM_INSET = 8; // so the inner ring/vignette doesn't clip the edge
    viewport.position.set(
      pixiApp.screen.width / 2,
      pixiApp.screen.height - BOTTOM_INSET - bottomDrop,
    );
  }

  function drawGrid() {
    const th = boardLayout.tileW * boardLayout.ratio;
    grid.clear();
    for (const h of hexes) {
      const { x, y } = pixelOf(h.q, h.r);
      grid.poly(isoHex(x, y, boardLayout.tileW * 0.94, th * 0.94).flat());
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

  // Re-fit + re-place units for the current W/H/Rotation. Units are uniformly
  // scaled to the live tile and counter-rotated so sprites/HP bars stay upright.
  function relayout() {
    drawGrid();
    const k = boardLayout.tileW / TW0;
    const isx = 1 / Math.cos(boardLayout.rotYRad); // counter yaw foreshorten
    const isy = 1 / Math.cos(boardLayout.rotXRad); // counter pitch foreshorten
    for (const id of Object.keys(sprites)) {
      const su = sprites[id];
      const p = pixelOf(su.q, su.r);
      su.node.position.set(p.x, p.y);
      su.node.rotation = -boardLayout.rotRad;
      // Upright, unsquashed billboard — board zoom + counter-rotation only.
      // Facing lives on the BODY's scale-X (set at build/engage/reset) and is
      // zoom-independent, so it survives relayout without mirroring the UI.
      su.node.scale.set(k * isx, k * isy);
    }
    centerBoard();
  }

  function applyMap() {
    const m = mapCfgRef.current;
    boardLayout.tileW = clamp(
      m.tileWidth,
      MAP_BOUNDS.tileWidth.min,
      MAP_BOUNDS.tileWidth.max,
    );
    boardLayout.ratio = clamp(
      m.tileHeightRatio,
      MAP_BOUNDS.tileHeightRatio.min,
      MAP_BOUNDS.tileHeightRatio.max,
    );
    boardLayout.boardScale = clamp(
      m.scale,
      MAP_BOUNDS.scale.min,
      MAP_BOUNDS.scale.max,
    );
    boardLayout.rotRad = (m.rotation * Math.PI) / 180;
    boardLayout.rotXRad = (m.rotationX * Math.PI) / 180;
    boardLayout.rotYRad = (m.rotationY * Math.PI) / 180;
    relayout();
  }

  return { centerBoard, drawGrid, relayout, applyMap, pixelOf };
}
