// Shared constants for the Animation Studio (StudioClient.tsx + studioStyles.ts).
// Pure values — no DOM, no Pixi, no React — safe to import anywhere.

/**
 * Authoring frame rate of the source spritesheets, used to derive a default
 * playback duration (frames / SOURCE_FPS seconds) when none is configured.
 */
export const SOURCE_FPS = 24;
/** Pixi ticker target FPS; AnimatedSprite.animationSpeed is measured in frames per tick. */
export const TICKER_FPS = 60;
/** Polling interval (ms) used to time freeze steps while previewing an action. */
export const PREVIEW_TICK_MS = 16;

/** Side-panel width. Two panels stack on the left (characters + animations), one on the right (playback). */
export const PANEL_W = "20vw";
export const DUAL_PANEL_W = "40vw";

/** Hex-grid defaults and colors. */
export const GRID = {
  tileW: 120,
  tileHRatio: 0.5,
  radius: 1,
  tileFill: 0x1a2a3a,
  tileStroke: 0x4a9aba,
  dot: 0xff2222,
  centerStroke: 0xffffff,
};

/** Offline fallback character used only when the API is unreachable. */
export const DEFAULT_CHARACTER = { id: "knight", name: "Knight" };
