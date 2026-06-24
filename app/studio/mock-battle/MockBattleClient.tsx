"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DamageConfig as DamageCfg,
  MapConfig,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
  SpellDef,
  SpellInput,
  Team,
  UnitStats,
} from "@/lib/battle/types";
import { BOARD, DEFAULT_DAMAGE_CONFIG, STAT_BOUNDS } from "@/lib/battle/types";
import GameScreenShell from "./GameScreenShell";
import { BoardPreview } from "./BoardPreview";
import { PartyColumn } from "./PartyColumn";
import { DisplayConfigPanel } from "./DisplayConfigPanel";
import { requestResolve, normalizeConfig } from "./replayKit";
import BattleStage, { DEFAULT_MAP, deployHex, clamp } from "./BattleStage";
import type { BootstrapConfig } from "./BattleStage";

const DEFAULT_STATS: UnitStats = {
  hp: 120,
  attack: 24,
  defense: 6,
  actionSpeed: 100,
  range: 1,
  skills: [],
};

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

export type RosterChar = { id: string; name: string };

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
