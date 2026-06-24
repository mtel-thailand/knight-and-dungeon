'use client';

import type { HexPosition, Team } from "@/lib/battle/types";
import { BOARD } from "@/lib/battle/types";
import { isoPos, isoHex, getHexRowsFromCounts } from "../studioHelpers";
import type { BuildUnit } from "./MockBattleClient";

// =============================================================================
// SECTION > BoardPreview (React subcomponent)
// Seam (Phase 1 -> BoardPreview.tsx): BoardPreview
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

const BOARD_ROWS = getHexRowsFromCounts([...BOARD.rowCounts]);
const DEPLOY_QS: Record<Team, number[]> = {
  player: BOARD_ROWS[BOARD_ROWS.length - 1],
  enemy: BOARD_ROWS[0],
};

function genHexes(): HexPosition[] {
  const cR = (BOARD_ROWS.length - 1) / 2;
  const out: HexPosition[] = [];
  BOARD_ROWS.forEach((cols, ri) => {
    const r = ri - cR;
    cols.forEach((q) => out.push({ q, r }));
  });
  return out;
}

export function BoardPreview({
  players,
  enemies,
  nameOf,
}: {
  players: BuildUnit[];
  enemies: BuildUnit[];
  nameOf: (id: string) => string;
}) {
  const PV = 34; // iso tile width for the schematic
  const PVH = PV * 0.5;
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
