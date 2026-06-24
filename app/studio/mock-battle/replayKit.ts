"use client";

import { useRef } from "react";
import type { BootstrapConfig, DamageCfg } from "./BattleStage";
import { DEFAULT_MAP } from "./BattleStage";
import type {
  MapConfig,
  ResolveRequest,
  ResolveResult,
} from "@/lib/battle/types";
import { DEFAULT_DAMAGE_CONFIG } from "@/lib/battle/types";
import { mockResolve } from "./mockResolve";

export { mockResolve } from "./mockResolve";

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

export { requestResolve };

/* ------------------------------------------------------------------ *
 * Config normalizer (mirrors GET /api/config shape -> BootstrapConfig).
 * ------------------------------------------------------------------ */

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

export { normalizeConfig };

/* ------------------------------------------------------------------ *
 * useReplayRefs — returns the 7 bridge refs for non-studio callers.
 * Studio callers wire their own refs; this gives camp/page clients a
 * correctly-initialized set with inert OUT mutators.
 * ------------------------------------------------------------------ */

function useReplayRefs(config: {
  damageConfig?: DamageCfg;
  mapConfig?: MapConfig;
}) {
  const dmgCfgRef = useRef<DamageCfg>(config.damageConfig ?? DEFAULT_DAMAGE_CONFIG);
  const mapCfgRef = useRef<MapConfig>(config.mapConfig ?? DEFAULT_MAP);
  const showGridRef = useRef(false);
  const controlsRef = useRef<{ replay: () => void } | null>(null);
  // OUT mutators: inert no-ops for non-studio callers (camp never needs to
  // live-retune HP bars / board / grid from outside the Pixi effect).
  const redrawHealthBarsRef = useRef<() => void>(() => {});
  const applyMapRef = useRef<() => void>(() => {});
  const gridVisibleRef = useRef<((v: boolean) => void) | null>(null);

  return {
    dmgCfgRef,
    mapCfgRef,
    showGridRef,
    controlsRef,
    redrawHealthBarsRef,
    applyMapRef,
    gridVisibleRef,
  };
}

export { useReplayRefs };

/* ------------------------------------------------------------------ *
 * finalHpFromResult — derive final HP map from a ResolveResult.
 * Uses finalState when present (engine P2+), otherwise replays events
 * from initialState to derive end-of-battle HP per unit id.
 * ------------------------------------------------------------------ */

function finalHpFromResult(result: ResolveResult): Record<string, number> {
  const hpMap: Record<string, number> = {};
  for (const u of result.initialState.units) hpMap[u.id] = u.hp;
  if (result.finalState) {
    // finalState is authoritative when present (P2+ engine)
    for (const u of result.finalState.units) hpMap[u.id] = u.hp;
  } else {
    // Without finalState, replay events to derive terminal HP
    for (const ev of result.events ?? []) {
      if (
        (ev.kind === "attack" || ev.kind === "skill" || ev.kind === "spellcast") &&
        typeof ev.targetHp === "number"
      ) {
        hpMap[ev.targetId] = ev.targetHp;
      } else if (ev.kind === "death") {
        hpMap[ev.unitId] = 0;
      }
    }
  }
  return hpMap;
}

export { finalHpFromResult };
