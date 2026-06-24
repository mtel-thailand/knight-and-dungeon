// Pure helpers for the Animation Studio (no DOM / Pixi / React state).

import type { CharConfigData } from "./studioTypes";
import { effectiveSfxVolume } from "./audioSettings";
import { playSfx } from "./sfx";

/** Lowercase, hyphenate, and trim a display name into a stable id slug. */
export function slugify(name: string, fallback = "character"): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

/**
 * Axial-coordinate columns for an iso board defined by an explicit per-row tile
 * count (e.g. [5, 6, 7, 6, 5]). Each row is centered on q=0 for the shared
 * projection `cx = (q * 2 + r) * tileW / 2`, so alternating even/odd row counts
 * fall naturally into the pointy-top hex "brick" offset. Neighbouring counts
 * should differ by ±1 (matching their row-offset parity) so q lands on-lattice.
 */
export function getHexRowsFromCounts(counts: number[]): number[][] {
  const cR = (counts.length - 1) / 2;
  return counts.map((n, ri) => {
    const r = ri - cR;
    const qStart = (-(n - 1) - r) / 2;
    const cols: number[] = [];
    for (let i = 0; i < n; i++) cols.push(qStart + i);
    return cols;
  });
}

/**
 * Pointy-top axial-hex → screen projection of a board cell (q = col, r = row):
 * columns sit `tw` apart, each row is `3/4·th` lower and offset half a tile, so
 * cells interlock as a honeycomb. Shared by the studio preview board and the
 * mock-battle board so the two stay geometrically identical.
 */
export function isoPos(
  q: number,
  r: number,
  tw: number,
  th: number,
): { x: number; y: number } {
  return { x: (2 * q + r) * (tw / 2), y: r * ((th * 3) / 4) };
}

/**
 * Pointy-top hexagon corners around (cx, cy): vertices at top & bottom, vertical
 * edges left & right. Width `tw`, height `th` (the iso vertical squash). Tiles
 * edge-to-edge with the `isoPos` lattice for any tw:th ratio.
 */
export function isoHex(
  cx: number,
  cy: number,
  tw: number,
  th: number,
): Array<[number, number]> {
  return [
    [cx, cy - th / 2],
    [cx + tw / 2, cy - th / 4],
    [cx + tw / 2, cy + th / 4],
    [cx, cy + th / 2],
    [cx - tw / 2, cy + th / 4],
    [cx - tw / 2, cy - th / 4],
  ];
}

/**
 * Resolve a DB-stored image name to a loadable URL.
 * - Full HTTP(S) URLs (Firebase Storage) are returned as-is.
 * - Bare filenames are prefixed with "/assets/" so Pixi/HTML loads them from
 *   the local `public/assets/` directory (backward-compatible with existing
 *   rows that store the bare png name).
 */
export const assetUrl = (image: string) =>
  image.startsWith("http") ? image : `/assets/${image}`;

/**
 * Fire-and-forget SFX playback for an Action's `sound`. Resolves the stored
 * name through assetUrl (Firebase URL or /assets/…) and plays it once. Any
 * load/autoplay failure is swallowed — sound is non-critical polish. Client-
 * only by construction: `Audio` is touched lazily at call time, so importing
 * this in server scope is safe; callers invoke it inside Pixi/DOM effects.
 */
export function playSound(sound: string | null | undefined, volume = 1): void {
  if (!sound) return;
  const url = assetUrl(sound);
  const gain = Math.max(0, Math.min(1, volume * effectiveSfxVolume()));
  playSfx(url, gain);
}

/** A fresh, identity per-character transform. */
export const defaultCharConfig = (): CharConfigData => ({
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  tint: 0xffffff,
});
