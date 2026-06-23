// Pure helpers for the Animation Studio (no DOM / Pixi / React state).

import type { CharConfigData } from "./studioTypes";

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
 * Axial-coordinate columns for each row of a pointy-top hexagon of the given
 * radius (a hex "ring" board), centered on (0,0).
 */
export function getHexRows(radius: number): number[][] {
  const rows: number[][] = [];
  for (let r = -radius; r <= radius; r++) {
    const qMin = Math.max(-radius, -radius - r);
    const qMax = Math.min(radius, radius - r);
    const cols: number[] = [];
    for (let q = qMin; q <= qMax; q++) cols.push(q);
    rows.push(cols);
  }
  return rows;
}

/** A fresh, identity per-character transform. */
export const defaultCharConfig = (): CharConfigData => ({
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  tint: 0xffffff,
});
