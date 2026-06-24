"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CampaignDef,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
  UnitStats,
} from "@/lib/battle/types";
import { BOARD } from "@/lib/battle/types";
import { normalizeConfig, requestResolve, finalHpFromResult, useReplayRefs } from "@/app/studio/mock-battle/replayKit";
import BattleStage, { deployHex, type BootstrapConfig } from "@/app/studio/mock-battle/BattleStage";
import GameScreenShell from "@/app/studio/mock-battle/GameScreenShell";
import { CAMP_PAGE_CSS } from "./campStyles";

// ────────────────────────────────────────────────────────────────────────────
// State machine: idle → fighting → won / lost
// ────────────────────────────────────────────────────────────────────────────

type Phase = "idle" | "fighting" | "won" | "lost";

/**
 * TEMP ("for now"): the camp player party is a single fixed `john`, regardless of
 * any saved roster. To restore multi-unit / party-select parties, rebuild this
 * from cfg.roster (and update both call sites). `john` is always seeded in
 * character_battle_stats; if it's somehow absent, the empty-party guard fires.
 */
function getCampParty(battleStats: Record<string, UnitStats>): PartyMemberInput[] {
  const s = battleStats["john"];
  if (!s) return [];
  return [{
    characterId: "john",
    stats: { ...s, attackType: s.attackType ?? "melee", skills: s.skills ?? [] },
    position: deployHex("player", 0),
  }];
}

// ────────────────────────────────────────────────────────────────────────────

export default function CampClient() {
  const [config, setConfig] = useState<BootstrapConfig | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<CampaignDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [waveIndex, setWaveIndex] = useState(1);
  const [playerParty, setPlayerParty] = useState<PartyMemberInput[]>([]);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [waveKey, setWaveKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Stable refs so async wave logic always reads the latest values.
  const activeCampaignRef = useRef(activeCampaign);
  activeCampaignRef.current = activeCampaign;
  const configRef = useRef(config);
  configRef.current = config;
  const playerPartyRef = useRef(playerParty);
  playerPartyRef.current = playerParty;
  const waveIndexRef = useRef(waveIndex);
  waveIndexRef.current = waveIndex;

  // ── Bootstrap ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        const data = res.ok ? await res.json() : {};
        if (cancelled) return;
        const cfg = normalizeConfig(data);
        setConfig(cfg);

        const camp: CampaignDef | null =
          (Array.isArray(data?.campaigns)
            ? data.campaigns.find((c: CampaignDef) => c.isActive)
            : null) ?? null;
        setActiveCampaign(camp);

        // Build initial player party (TEMP: fixed single john — see getCampParty)
        setPlayerParty(getCampParty(cfg.battleStats ?? {}));
      } catch {
        // Offline — empty config
        if (!cancelled) {
          setConfig(normalizeConfig({}));
          setActiveCampaign(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Refs from the shared replay kit (inert OUT mutators for camp) ──────

  const refs = useReplayRefs(config ?? {});

  // ── Guards ─────────────────────────────────────────────────────────────

  const guardMessage = ((): string | null => {
    if (!activeCampaign) return "No active campaign. Create one in the Campaigns page first.";
    if (!Array.isArray(activeCampaign.monsterPool) || activeCampaign.monsterPool.length === 0) {
      return "The active campaign has no monsters in its pool.";
    }
    if (playerParty.length === 0) return "No playable characters with battle stats.";
    return null;
  })();

  const canStart = phase === "idle" && !loading && guardMessage === null;

  // ── Wave resolution ────────────────────────────────────────────────────

  async function runWave(k: number, party: PartyMemberInput[]): Promise<"ok" | string> {
    const camp = activeCampaignRef.current;
    const cfg = configRef.current;
    if (!cfg || !camp) return "No active campaign";

    const count = Math.min(k, BOARD.maxPerSide);
    const pool = camp.monsterPool;
    const enemies: PartyMemberInput[] = [];
    for (let i = 0; i < count; i++) {
      const charId = pool[i % pool.length];
      const statsRaw = cfg.battleStats?.[charId];
      if (!statsRaw) continue; // skip characters without battle stats
      enemies.push({
        characterId: charId,
        stats: { ...statsRaw, attackType: statsRaw.attackType ?? "melee", skills: statsRaw.skills ?? [] },
        position: deployHex("enemy", i),
      });
    }
    if (enemies.length === 0) return "No valid enemy characters in monster pool (all missing battle stats).";

    const req: ResolveRequest = { players: party, enemies };
    const outcome = await requestResolve(req);
    if (!outcome.ok) return outcome.error;

    setResult(outcome.result);
    setWaveKey((prev) => prev + 1);
    return "ok";
  }

  // ── Wave-end callback (passed to BattleStage.onEnd) ────────────────────

  const onWaveEnd = useCallback(
    (outcome: "win" | "lose" | "draw") => {
      if (outcome === "lose" || outcome === "draw") {
        setPhase("lost");
        return;
      }

      // Win — HP carryover
      const curResult = result;
      const curParty = playerPartyRef.current;
      const curWave = waveIndexRef.current;
      const camp = activeCampaignRef.current;
      if (!curResult || !camp) return;

      const hp = finalHpFromResult(curResult);
      const posToId = new Map<string, string>();
      for (const u of curResult.initialState.units) {
        if (u.team === "player") posToId.set(`${u.position.q},${u.position.r}`, u.id);
      }

      const nextParty: PartyMemberInput[] = [];
      for (const m of curParty) {
        const id = posToId.get(`${m.position.q},${m.position.r}`);
        const h = id ? hp[id] : undefined;
        if (h !== undefined && h > 0) {
          nextParty.push({ ...m, currentHp: h });
        }
      }

      setPlayerParty(nextParty);

      if (curWave < camp.waveCount) {
        setWaveIndex(curWave + 1);
        // Trigger next wave asynchronously; use the party we just computed.
        runWave(curWave + 1, nextParty).then((res) => {
          if (res !== "ok") {
            setError(typeof res === "string" ? res : "Wave resolution failed");
            setPhase("lost");
          }
        });
      } else {
        setPhase("won");
      }
    },
    // result is captured at the render that created this callback; it doesn't
    // change within a wave because BattleStage remounts on waveKey change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result],
  );

  // ── Start campaign ─────────────────────────────────────────────────────

  function startCampaign() {
    if (!canStart || !activeCampaign) return;
    setPhase("fighting");
    setWaveIndex(1);
    const initialParty = playerPartyRef.current;
    setError(null);
    runWave(1, initialParty).then((res) => {
      if (res !== "ok") {
        setError(typeof res === "string" ? res : "Failed to start campaign");
        setPhase("idle");
      }
    });
  }

  function resetToIdle() {
    setPhase("idle");
    setResult(null);
    setWaveKey(0);
    setWaveIndex(1);
    setError(null);
    // Re-fetch config to get fresh campaign/roster state
    setLoading(true);
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.resolve({} as any)))
      .then((data: any) => {
        const cfg = normalizeConfig(data);
        setConfig(cfg);
        const camp: CampaignDef | null =
          (Array.isArray(data?.campaigns)
            ? data.campaigns.find((c: CampaignDef) => c.isActive)
            : null) ?? null;
        setActiveCampaign(camp);
        setPlayerParty(getCampParty(cfg.battleStats ?? {}));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="camp-page">
        <style>{CAMP_PAGE_CSS}</style>
        <div className="camp-body">
          <div className="camp-center-msg">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="camp-page">
      <style>{CAMP_PAGE_CSS}</style>
      <div className="camp-body">
        {phase === "fighting" && config && result ? (
          <>
            {/* Wave HUD */}
            <div className="camp-hud">
              Wave {waveIndex} / {activeCampaign?.waveCount ?? "?"}
            </div>

            <GameScreenShell
              centerBg="/assets/dungeon-bg.png"
              centerVideo="/assets/dungeon-bg.mp4"
              center={
                <BattleStage
                  key={waveKey}
                  result={result}
                  config={config}
                  {...refs}
                  onReady={() => {}}
                  onEnd={onWaveEnd}
                />
              }
            />
          </>
        ) : phase === "fighting" ? (
          <div className="camp-center-msg">Loading battle…</div>
        ) : phase === "won" ? (
          <div className="camp-result-scrim">
            <div className="camp-result-card won">
              <div className="camp-result-title">Victory</div>
              <div className="camp-result-sub">All waves cleared!</div>
              <button className="camp-btn primary" onClick={resetToIdle}>
                Back to camp
              </button>
            </div>
          </div>
        ) : phase === "lost" ? (
          <div className="camp-result-scrim">
            <div className="camp-result-card lost">
              <div className="camp-result-title">Defeat</div>
              <div className="camp-result-sub">
                {error ? (
                  <span style={{ color: "#ffb3bd" }}>{error}</span>
                ) : (
                  "Your party was defeated."
                )}
              </div>
              <button className="camp-btn primary" onClick={resetToIdle}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          /* idle */
          <div className="camp-idle">
            {guardMessage ? (
              <div className="camp-guard">
                <div className="icon">⚠️</div>
                <p>{guardMessage}</p>
                <p>
                  <a href="/studio/campaigns">Go to Campaigns</a>
                </p>
              </div>
            ) : (
              <>
                <h1>{activeCampaign?.name ?? "Campaign"}</h1>
                <p>
                  {activeCampaign?.waveCount ?? 0} wave
                  {(activeCampaign?.waveCount ?? 0) !== 1 ? "s" : ""}
                  {" · "}
                  {playerParty.length} fighter{playerParty.length !== 1 ? "s" : ""}
                </p>
                <button className="camp-start-btn" onClick={startCampaign}>
                  Start campaign
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
