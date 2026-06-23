// lib/battle/hex.ts
//
// Pure axial-hex spatial helpers for the mock-battle engine.
// PURITY: no React/Pixi/DB/`next` imports; no `Date`/`Math.random` (determinism).
// All shapes come from the frozen contract (types.ts); none are redefined here.

import type { HexPosition, Unit } from "./types";
import { BOARD } from "./types";

// The fixed battlefield: a [5,6,7,6,5] hexagon arena in centered axial coords
// (r in {-2..2}, q centered per row — the same shape/coords the studio preview
// renders), built row-major (r outer, q inner) so VALID_HEXES order is stable for
// the snapshot. Row -2 = enemy back row, row +2 = player row. The hex math below
// is shape-agnostic, so this generator + BOARD.rowCounts are the ONLY places the
// board shape is encoded (mirrors getHexRowsFromCounts in studioHelpers).
export const VALID_HEXES: HexPosition[] = (() => {
  const counts = BOARD.rowCounts;
  const cR = (counts.length - 1) / 2;
  const out: HexPosition[] = [];
  for (let ri = 0; ri < counts.length; ri++) {
    const r = ri - cR;
    const n = counts[ri];
    const qStart = (-(n - 1) - r) / 2;
    for (let i = 0; i < n; i++) out.push({ q: qStart + i, r });
  }
  return out;
})();

// Six axial neighbor directions (visual orientation is a render concern).
const HEX_DIRECTIONS: readonly HexPosition[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function getNeighbors(pos: HexPosition): HexPosition[] {
  return HEX_DIRECTIONS.map((dir) => ({ q: pos.q + dir.q, r: pos.r + dir.r }));
}

// A hex is in bounds only if it exists in VALID_HEXES.
export function isValidHex(pos: HexPosition): boolean {
  return VALID_HEXES.some((hex) => hex.q === pos.q && hex.r === pos.r);
}

// Axial hex distance.
export function hexDistance(a: HexPosition, b: HexPosition): number {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.q + a.r - b.q - b.r) +
    Math.abs(a.r - b.r)
  ) / 2;
}

// A hex is occupied iff a LIVING unit stands on it (dead units free their hex).
export function isOccupied(pos: HexPosition, units: Unit[]): boolean {
  return units.some(
    (u) => !u.isDead && u.position.q === pos.q && u.position.r === pos.r,
  );
}

// Movement primitive: step one hex toward `target`. Enumerate the 6 neighbors,
// keep valid + unoccupied, pick the one minimizing distance to target, with a
// deterministic tie-break: lower distance, then lower r, then lower q.
// No legal neighbor => stay put (the caller still consumes the action).
export function getNextHexToward(
  from: HexPosition,
  target: HexPosition,
  units: Unit[],
): HexPosition {
  const candidates = getNeighbors(from)
    .filter(isValidHex)
    .filter((pos) => !isOccupied(pos, units))
    .sort((a, b) => {
      const distDiff = hexDistance(a, target) - hexDistance(b, target);
      if (distDiff !== 0) return distDiff;
      const rowDiff = a.r - b.r;
      if (rowDiff !== 0) return rowDiff;
      return a.q - b.q;
    });
  return candidates[0] ?? from;
}

// Push destination: one hex further along the (target - source) direction. Shield
// Bash only fires when adjacent, so this is always exactly one neighbor step
// beyond the target.
export function getPushTarget(
  source: HexPosition,
  target: HexPosition,
): HexPosition {
  const dir = { q: target.q - source.q, r: target.r - source.r };
  return { q: target.q + dir.q, r: target.r + dir.r };
}

// Try to push `target` away from `source`. Blocked (off-map OR occupied) = stays.
// Mutates target.position in place when the push lands.
export function tryPushUnit(source: Unit, target: Unit, units: Unit[]): void {
  const pushTarget = getPushTarget(source.position, target.position);
  if (!isValidHex(pushTarget)) return; // off-map -> stays
  if (isOccupied(pushTarget, units)) return; // occupied -> stays
  target.position = { q: pushTarget.q, r: pushTarget.r };
}
