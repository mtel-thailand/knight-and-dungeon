"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  CampaignDef,
  WaveDef,
  PartyMemberInput,
  ResolveRequest,
  ResolveResult,
  SpellDef,
  BattleRewardDef,
  SpellInput,
  UnitStats,
} from "@/lib/battle/types";
import { BATTLE_REWARD_EFFECTS, BOARD } from "@/lib/battle/types";
import { normalizeConfig, requestResolve, finalHpFromResult, useReplayRefs } from "@/app/studio/mock-battle/replayKit";
import BattleStage, { deployHex, type BootstrapConfig } from "@/app/studio/mock-battle/BattleStage";
import { useAuth } from "@/app/auth/AuthGuard";
import GameScreenShell from "@/app/studio/mock-battle/GameScreenShell";
import { assetUrl } from "@/app/studio/studioHelpers";
import { CAMP_PAGE_CSS } from "./campStyles";

// ────────────────────────────────────────────────────────────────────────────
// State machine: idle → fighting → won / lost
// ────────────────────────────────────────────────────────────────────────────

/** Render a character's idle animation as a Pixi AnimatedSprite. */
function CharacterAvatar({ charId, name, animations }: { charId: string; name: string; animations: any[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const candidates = animations.filter((a: any) => a.key?.startsWith(charId + "-"));
    if (candidates.length === 0) return;
    let destroyed = false;
    let pixiApp: any = null;
    let sprite: any = null;
    (async () => {
      const { Application, Assets, Spritesheet, AnimatedSprite } = await import("pixi.js");
      if (destroyed) return;
      // Try each candidate animation until one loads successfully
      for (const anim of candidates) {
        if (destroyed) return;
        if (!anim?.image || !anim?.frameData) continue;
        try {
          const url = assetUrl(anim.image);
          await Assets.load(url);
        } catch { continue; }
        if (destroyed) return;
        const el = ref.current;
        if (!el) return;
        pixiApp = new Application();
        await pixiApp.init({ resizeTo: el, backgroundAlpha: 0, antialias: true });
        if (destroyed) { pixiApp.destroy(); return; }
        el.innerHTML = "";
        el.appendChild(pixiApp.canvas);
        try {
          const texture = await Assets.load(assetUrl(anim.image));
          if (destroyed) { pixiApp.destroy(); return; }
          const sheet = new Spritesheet(texture, anim.frameData);
          await sheet.parse();
          const frames = Object.keys(sheet.data.frames).map((n: string) => sheet.textures[n]);
          sprite = new AnimatedSprite(frames);
          sprite.anchor.set(0.5);
          sprite.position.set(pixiApp.screen.width / 2, pixiApp.screen.height / 2);
          const s = 64 / (Math.max(sheet.data.meta?.size?.w ?? 64, sheet.data.meta?.size?.h ?? 64) || 64);
          sprite.scale.set(s, s);
          sprite.animationSpeed = frames.length / (2 * 60);
          sprite.play();
          pixiApp.stage.addChild(sprite);
          return; // success — stop trying
        } catch {
          if (pixiApp) { try { pixiApp.destroy(); } catch {} pixiApp = null; }
          continue; // try next candidate
        }
      }
    })();
    return () => {
      destroyed = true;
      if (sprite) { try { sprite.destroy(); } catch {} }
      if (pixiApp) { try { pixiApp.destroy(); } catch {} }
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [charId, animations]);
  return (
    <div ref={ref} style={{ width: 64, height: 64 }} />
  );
}

type Phase = "idle" | "fighting" | "reward" | "won" | "lost";

/**
 * Build a player party from selected character IDs.
 * Each character is positioned in a deploy hex slot.
 * Pass extraUserSpells (user-purchased, per-character) so owned spells reach the battle.
 */
function buildParty(charIds: string[], config: BootstrapConfig, extraUserSpells?: Record<string, string[]>): PartyMemberInput[] {
  const party: PartyMemberInput[] = [];
  for (let i = 0; i < charIds.length && i < BOARD.maxPerSide; i++) {
    const charId = charIds[i];
    const s = config.battleStats?.[charId];
    if (!s) continue;
    party.push({
      characterId: charId,
      stats: { ...s, attackType: s.attackType ?? "melee", skills: s.skills ?? [] },
      spells: spellsFor(charId, config, extraUserSpells?.[charId]),
      position: deployHex("player", i),
    });
  }
  return party;
}

/** Resolve a character's owned spell ids -> the engine's SpellInput configs
 *  (mirrors mock-battle's startFight). Without this, camp units fight spell-less. */
function spellsFor(characterId: string, config: BootstrapConfig, extraSpellIds?: string[]): SpellInput[] {
  const byId = new Map((config.spells ?? []).map((s) => [s.id, s] as const));
  const ids = new Set(config.characterSpells?.[characterId] ?? []);
  if (extraSpellIds) for (const id of extraSpellIds) ids.add(id);
  return [...ids]
    .map((id) => byId.get(id))
    .filter((s): s is SpellDef => !!s)
    .map((s) => ({
      id: s.id,
      power: s.power,
      cooldown: s.cooldown,
      type: s.type,
      animationKey: s.animationKey,
      manaCost: s.manaCost,
    }));
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
  const { user: authUser } = useAuth();
  const userId = authUser?.uid;
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [rewardChoices, setRewardChoices] = useState<BattleRewardDef[]>([]);
  const [pendingRewardParty, setPendingRewardParty] = useState<PartyMemberInput[]>([]);
  const [pendingRewardWave, setPendingRewardWave] = useState(1);
  const [rerollCount, setRerollCount] = useState(0);
  const [claimedRewards, setClaimedRewards] = useState<BattleRewardDef[]>([]);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>(["blue"]);
  const [userCharacters, setUserCharacters] = useState<Record<string, { level: number; exp: number; avatarUrl?: string }>>({});
  const [userSpells, setUserSpells] = useState<Record<string, string[]>>({});
  const [livePlayerHp, setLivePlayerHp] = useState<Record<string, number>>({});
  const [resolvingWave, setResolvingWave] = useState(false);

  // Stable refs so async wave logic always reads the latest values.
  const activeCampaignRef = useRef(activeCampaign);
  activeCampaignRef.current = activeCampaign;
  const configRef = useRef(config);
  configRef.current = config;
  const playerPartyRef = useRef(playerParty);
  playerPartyRef.current = playerParty;
  const waveIndexRef = useRef(waveIndex);
  waveIndexRef.current = waveIndex;

  function togglePaused() {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      return next;
    });
  }

  function rewardSummary(reward: BattleRewardDef): string {
    if (reward.effect === "atkPercent") return `ATK +${reward.effectValue}%`;
    if (reward.effect === "restoreHp") return `Restore ${reward.effectValue} HP`;
    return `DEF +${reward.effectValue}`;
  }

  function pickRewardChoices(rewards: BattleRewardDef[]): BattleRewardDef[] {
    function rollRarity(): BattleRewardDef["rarity"] {
      const roll = Math.random();
      if (roll < 0.5) return "common";
      if (roll < 0.85) return "uncommon";
      return "rare";
    }
    const byEffect = new Map<string, BattleRewardDef[]>();
    for (const reward of rewards) {
      const group = byEffect.get(reward.effect) ?? [];
      group.push(reward);
      byEffect.set(reward.effect, group);
    }
    const choices: BattleRewardDef[] = [];
    for (const effect of BATTLE_REWARD_EFFECTS) {
      const groupAll = byEffect.get(effect) ?? [];
      const rarity = rollRarity();
      const group = groupAll.filter((reward) => reward.rarity === rarity);
      const fallback = group.length ? group : groupAll;
      if (fallback.length === 0) continue;
      choices.push(fallback[Math.floor(Math.random() * fallback.length)]);
      if (choices.length === 3) break;
    }
    return choices;
  }

  function applyRewardToParty(reward: BattleRewardDef, party: PartyMemberInput[]): PartyMemberInput[] {
    return party.map((m) => {
      if (reward.effect === "atkPercent") {
        return {
          ...m,
          stats: {
            ...m.stats,
            attack: Math.max(0, Math.round(m.stats.attack * (1 + reward.effectValue / 100))),
          },
        };
      }
      if (reward.effect === "restoreHp") {
        const current = m.currentHp ?? m.stats.hp;
        return { ...m, currentHp: Math.min(m.stats.hp, current + reward.effectValue) };
      }
      return {
        ...m,
        stats: { ...m.stats, defense: Math.max(0, m.stats.defense + reward.effectValue) },
      };
    });
  }

  function chooseReward(reward: BattleRewardDef) {
    const nextParty = applyRewardToParty(reward, pendingRewardParty);
    setPendingRewardParty(nextParty);
    setPlayerParty(nextParty);
    // Immediately advance — pick only one reward
    advanceWave(nextParty, pendingRewardWave);
  }

  function advanceWave(nextParty: PartyMemberInput[], nextWave: number) {
    setRewardChoices([]);
    setPendingRewardParty([]);
    setClaimedRewards([]);
    setRerollCount(0);
    setWaveIndex(nextWave);
    pausedRef.current = false;
    setPaused(false);
    setPhase("fighting");
    setResolvingWave(true);
    runWave(nextWave, nextParty).then((res) => {
      if (res !== "ok") {
        setError(typeof res === "string" ? res : "Wave resolution failed");
        setPhase("lost");
      }
    }).finally(() => {
      setResolvingWave(false);
    });
  }

  function characterName(id: string): string {
    return configRef.current?.characters.find((c) => c.id === id)?.name ?? id;
  }

  function renderPlayerStats() {
    return (
      <div className="camp-bottom-stats">
        {playerParty.map((member, index) => {
          const liveId = result?.initialState.units.find(
            (u) =>
              u.team === "player" &&
              u.characterId === member.characterId &&
              u.position.q === member.position.q &&
              u.position.r === member.position.r,
          )?.id;
          const hp = liveId && livePlayerHp[liveId] !== undefined
            ? livePlayerHp[liveId]
            : member.currentHp ?? member.stats.hp;
          return (
            <div className="camp-stat-card" key={`${member.characterId}-${member.position.q}-${member.position.r}-${index}`}>
              <div className="camp-stat-name">{characterName(member.characterId)}</div>
              <div className="camp-stat-grid">
                <span className="camp-stat-pill"><span>HP</span><strong>{hp}/{member.stats.hp}</strong></span>
                <span className="camp-stat-pill"><span>ATK</span><strong>{member.stats.attack}</strong></span>
                <span className="camp-stat-pill"><span>DEF</span><strong>{member.stats.defense}</strong></span>
                <span className="camp-stat-pill"><span>SPD</span><strong>{member.stats.actionSpeed}</strong></span>
                <span className="camp-stat-pill"><span>RNG</span><strong>{member.stats.range}</strong></span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const urlCampaignId = searchParams?.get("id");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        const data = res.ok ? await res.json() : {};
        if (cancelled) return;
        const cfg = normalizeConfig(data);
        setConfig(cfg);

        const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
        const camp: CampaignDef | null =
          (urlCampaignId
            ? campaigns.find((c: CampaignDef) => c.id === urlCampaignId)
            : campaigns.find((c: CampaignDef) => c.isActive)) ?? null;
        setActiveCampaign(camp);

        // Build initial player party from selected characters
        setPlayerParty(buildParty(selectedCharIds, cfg, userSpells));
        setLoading(false);
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

  // ── Fetch user's owned characters AND purchased spells ──────────────────
  useEffect(() => {
    if (!userId || !config) return;
    let cancelled = false;
    (async () => {
      try {
        const [ucRes, usRes] = await Promise.all([
          fetch(`/api/user/characters?userId=${encodeURIComponent(userId)}`),
          fetch(`/api/user/spells?userId=${encodeURIComponent(userId)}`),
        ]);
        const ucData = await ucRes.json();
        const usData = await usRes.json();
        if (cancelled) return;

        // Build userSpells map from the API response
        const newUserSpells: Record<string, string[]> = {};
        if (usData.ok && Array.isArray(usData.spells)) {
          for (const entry of usData.spells) {
            if (!newUserSpells[entry.characterId]) newUserSpells[entry.characterId] = [];
            newUserSpells[entry.characterId].push(entry.spellId);
          }
        }
        setUserSpells(newUserSpells);

        if (ucData.ok && Array.isArray(ucData.characters)) {
          const owned: Record<string, { level: number; exp: number; avatarUrl?: string }> = {};
          const ownedIds: string[] = [];
          for (const c of ucData.characters) {
            owned[c.characterId] = { level: c.level ?? 1, exp: c.exp ?? 0, avatarUrl: c.avatarUrl };
            ownedIds.push(c.characterId);
          }
          setUserCharacters(owned);
          if (ownedIds.length > 0) {
            setSelectedCharIds(ownedIds.slice(0, BOARD.maxPerSide));
            setPlayerParty(buildParty(ownedIds.slice(0, BOARD.maxPerSide), config, newUserSpells));
          }
        }
      } catch { /* server unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [userId, config]);

  // ── Refs from the shared replay kit (inert OUT mutators for camp) ──────

  const refs = useReplayRefs(config ?? {});

  // ── Guards ─────────────────────────────────────────────────────────────

  const guardMessage = ((): string | null => {
    if (!activeCampaign) return "No active campaign. Create one in the Campaigns page first.";
    const hasWaves = Array.isArray(activeCampaign.waves) && activeCampaign.waves.length > 0;
    const hasPool = Array.isArray(activeCampaign.monsterPool) && activeCampaign.monsterPool.length > 0;
    if (!hasWaves && !hasPool) {
      return "The active campaign has no monsters configured.";
    }
    if (playerParty.length === 0) return "No playable characters with battle stats.";
    return null;
  })();

  // ── Wave resolution ────────────────────────────────────────────────────

  async function runWave(k: number, party: PartyMemberInput[]): Promise<"ok" | string> {
    const camp = activeCampaignRef.current;
    const cfg = configRef.current;
    if (!cfg || !camp) return "No active campaign";

    let enemies: PartyMemberInput[] = [];
    let spawnCount = camp.spawnCount ?? 0;

    // Use structured wave definitions when available
    const waveDef = camp.waves?.[k - 1];
    if (waveDef) {
      let slot = 0;
      for (const group of waveDef.initial) {
        for (let i = 0; i < group.count && slot < BOARD.maxPerSide; i++, slot++) {
          const statsRaw = cfg.battleStats?.[group.characterId];
          if (!statsRaw) continue;
          enemies.push({
            characterId: group.characterId,
            stats: { ...statsRaw, attackType: statsRaw.attackType ?? "melee", skills: statsRaw.skills ?? [] },
            spells: spellsFor(group.characterId, cfg),
            position: deployHex("enemy", slot),
          });
        }
      }
      // Compute spawn count from the sum of spawn group counts
      spawnCount = waveDef.spawns.reduce((sum, g) => sum + g.count, 0);
    } else {
      // Fallback: legacy pool cycling
      const count = Math.min(k, BOARD.maxPerSide);
      const pool = camp.monsterPool;
      for (let i = 0; i < count; i++) {
        const charId = pool[i % pool.length];
        const statsRaw = cfg.battleStats?.[charId];
        if (!statsRaw) continue;
        enemies.push({
          characterId: charId,
          stats: { ...statsRaw, attackType: statsRaw.attackType ?? "melee", skills: statsRaw.skills ?? [] },
          spells: spellsFor(charId, cfg),
          position: deployHex("enemy", i),
        });
      }
    }

    if (enemies.length === 0) return "No valid enemy characters in monster pool (all missing battle stats).";

    const req: ResolveRequest = {
      players: party, enemies, spawnCount,
      userId, campaignId: camp.id, waveIndex: k,
    };
    const outcome = await requestResolve(req);
    if (!outcome.ok) return outcome.error;

    setResult(outcome.result);
    const openingHp: Record<string, number> = {};
    for (const u of outcome.result.initialState.units) {
      if (u.team === "player") openingHp[u.id] = u.hp;
    }
    setLivePlayerHp(openingHp);
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
        const choices = pickRewardChoices(configRef.current?.battleRewards ?? []);
        if (choices.length > 0) {
          setPendingRewardParty(nextParty);
          setPendingRewardWave(curWave + 1);
          setRerollCount(0);
          setClaimedRewards([]);
          setRewardChoices(choices);
          pausedRef.current = true;
          setPaused(true);
        } else {
          setWaveIndex(curWave + 1);
          setResolvingWave(true);
          // Trigger next wave asynchronously; use the party we just computed.
          runWave(curWave + 1, nextParty).then((res) => {
            if (res !== "ok") {
              setError(typeof res === "string" ? res : "Wave resolution failed");
              setPhase("lost");
            }
          }).finally(() => {
            setResolvingWave(false);
          });
        }
      } else {
        // Campaign won — transfer mana count to user pool
        const mana = refs.controlsRef.current?.getManaCount?.() ?? 0;
        if (mana > 0 && userId) {
          fetch("/api/user/stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, totalMana: mana }),
          }).catch(() => {});
        }
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
    // Gate on the always-current refs (NOT the render-derived `canStart`): even a
    // stale handler closure reads the newest committed values through the shared
    // ref objects, and every early-return now surfaces a reason — so the start can
    // never silently no-op.
    const cfg = configRef.current;
    const camp = activeCampaignRef.current;
    const party = playerPartyRef.current;
    if (!cfg || !camp) {
      setError("No active campaign — create and activate one in the Campaigns page.");
      return;
    }
    if (party.length === 0) {
      setError("No playable characters with battle stats.");
      return;
    }
    setError(null);
    setLivePlayerHp({});
    pausedRef.current = false;
    setPaused(false);
    setRewardChoices([]);
    setPendingRewardParty([]);
    setResolvingWave(false);
    setPhase("fighting");
    setWaveIndex(1);
    runWave(1, party).then((res) => {
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
    setLivePlayerHp({});
    pausedRef.current = false;
    setPaused(false);
    setRewardChoices([]);
    setPendingRewardParty([]);
    setResolvingWave(false);
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
        setPlayerParty(buildParty(selectedCharIds, cfg, userSpells));
        // Re-fetch user's owned characters AND purchased spells
        if (userId) {
          Promise.all([
            fetch(`/api/user/characters?userId=${encodeURIComponent(userId)}`).then((r) => r.json()),
            fetch(`/api/user/spells?userId=${encodeURIComponent(userId)}`).then((r) => r.json()),
          ]).then(([ucData, usData]) => {
            if (ucData.ok && Array.isArray(ucData.characters)) {
              const owned: Record<string, { level: number; exp: number; avatarUrl?: string }> = {};
              for (const c of ucData.characters) owned[c.characterId] = { level: c.level ?? 1, exp: c.exp ?? 0, avatarUrl: c.avatarUrl };
              setUserCharacters(owned);
            }
            if (usData.ok && Array.isArray(usData.spells)) {
              const newUserSpells: Record<string, string[]> = {};
              for (const entry of usData.spells) {
                if (!newUserSpells[entry.characterId]) newUserSpells[entry.characterId] = [];
                newUserSpells[entry.characterId].push(entry.spellId);
              }
              setUserSpells(newUserSpells);
              // Rebuild party with the freshest spell data
              setPlayerParty(buildParty(selectedCharIds, cfg, newUserSpells));
            }
          }).catch(() => {});
        }
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
          <div className="camp-center-msg">
            <div className="camp-spinner" />
            <span>Loading…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="camp-page">
      <style>{CAMP_PAGE_CSS}</style>
      <div className="camp-body">
        {phase === "fighting" && config && result ? (
          <div className="camp-fight-area">
            {/* Wave HUD */}
            <div className="camp-hud">
              <div className="camp-hud-inner">
                <span className="camp-hud-label">Wave</span>
                <span className="camp-hud-value">{waveIndex}</span>
                <span className="camp-hud-divider">/</span>
                <span className="camp-hud-total">{activeCampaign?.waveCount ?? "?"}</span>
                <button
                  className={paused ? "camp-pause-btn active" : "camp-pause-btn"}
                  type="button"
                  onClick={togglePaused}
                  aria-pressed={paused}
                  aria-label={paused ? "Resume battle" : "Pause battle"}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
              </div>
            </div>

            <GameScreenShell
              centerBg="/assets/dungeon-bg.png"
              centerVideo="/assets/dungeon-bg.mp4"
              bgm="/assets/audio/battle-bgm.mp3"
              bottom={renderPlayerStats()}
              center={
                <BattleStage
                  result={result}
                  config={config}
                  {...refs}
                  pausedRef={pausedRef}
                  onUnitHpChange={(unitId, hp) => {
                    setLivePlayerHp((prev) => ({ ...prev, [unitId]: hp }));
                  }}
                  onReady={() => {}}
                  onEnd={onWaveEnd}
                />
              }
            />
            {rewardChoices.length > 0 ? (
              <div className="camp-reward-scrim">
                <div className="camp-reward-panel">
                  <h2 className="camp-reward-title">
                    Pick a reward
                  </h2>
                  <div className="camp-reward-cards">
                    {rewardChoices.map((reward) => (
                      <button
                        key={reward.id}
                        className={`camp-reward-card ${reward.rarity}`}
                        type="button"
                        onClick={() => chooseReward(reward)}
                      >
                        <span className="camp-reward-card-name">{reward.name}</span>
                        <span className="camp-reward-card-rarity">{reward.rarity}</span>
                        <span className="camp-reward-card-effect">{rewardSummary(reward)}</span>
                        <span className="camp-reward-card-desc">
                          {reward.description || rewardSummary(reward)}
                        </span>
                      </button>
                    ))}
                  </div>
                  {rerollCount < 3 ? (
                    <div className="camp-reroll-row">
                      <button
                        className="camp-reroll-btn"
                        type="button"
                        disabled={(refs.controlsRef.current?.getManaCount?.() ?? 0) < rerollCount + 1}
                        onClick={() => {
                          const mana = refs.controlsRef.current?.getManaCount?.() ?? 0;
                          const cost = rerollCount + 1;
                          if (mana < cost) return;
                          refs.controlsRef.current?.setManaCount?.(mana - cost);
                          setRerollCount((prev) => prev + 1);
                          // Re-roll only the remaining slots
                          const count = rewardChoices.length;
                          const all = pickRewardChoices(configRef.current?.battleRewards ?? []);
                          setRewardChoices(all.slice(0, count));
                        }}
                      >
                        Re-roll ({rerollCount + 1} mana)
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {resolvingWave ? (
              <div className="camp-wave-loading" aria-live="polite">
                <div className="camp-spinner small" />
                <span>Preparing wave {waveIndex}…</span>
              </div>
            ) : null}
          </div>
        ) : phase === "fighting" ? (
          <div className="camp-center-msg">
            <div className="camp-spinner" />
            <span>Loading battle…</span>
          </div>
        ) : phase === "won" ? (
          <div className="camp-result-scrim">
            <div className="camp-result-card won">
              <div className="camp-result-glow" />
              <div className="camp-result-icon" />
              <div className="camp-result-title">Victory</div>
              <div className="camp-result-sub">All waves cleared!</div>
              <a className="camp-btn primary" href="/auth/campaigns">
                Back to quests
              </a>
            </div>
          </div>
        ) : phase === "lost" ? (
          <div className="camp-result-scrim">
            <div className="camp-result-card lost">
              <div className="camp-result-glow" />
              <div className="camp-result-icon" />
              <div className="camp-result-title">Defeat</div>
              <div className="camp-result-sub">
                {error ? (
                  <span className="camp-error-text">{error}</span>
                ) : (
                  "you suck, loser"
                )}
              </div>
              <a className="camp-btn primary" href="/auth/campaigns">
                Back to quests
              </a>
            </div>
          </div>
        ) : (
          /* idle */
          <div className="camp-idle">
            {guardMessage ? (
              <div className="camp-guard">
                <div className="camp-guard-icon" />
                <p>{guardMessage}</p>
                <a href="/studio/campaigns">Go to Campaigns</a>
              </div>
            ) : (
              <>
                <a href="/auth/campaigns" className="camp-back-link">← Back</a>
                <div className="camp-idle-badge">Campaign</div>
                <h1 className="camp-idle-title">{activeCampaign?.name ?? "Campaign"}</h1>
                <p className="camp-idle-sub">Auto-battle dungeon run</p>
                <div className="camp-idle-stats">
                  <span>
                    {activeCampaign?.waveCount ?? 0} wave
                    {(activeCampaign?.waveCount ?? 0) !== 1 ? "s" : ""}
                  </span>
                  <span className="camp-stat-dot" />
                  <span>
                    {selectedCharIds.length} fighter{selectedCharIds.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Character selection grid — user-owned characters only */}
                <div className="camp-char-grid">
                  {((config?.characters ?? []).filter((ch) => ch.id in userCharacters).map((ch) => {
                    const on = selectedCharIds.includes(ch.id);
                    const hasStats = !!config?.battleStats?.[ch.id];
                    const uc = userCharacters[ch.id];
                    return (
                      <button key={ch.id}
                        className={`camp-char-card${on ? " on" : ""}`}
                        disabled={!hasStats}
                        onClick={() => {
                          if (on) return; // already selected — no action (prevents emptying the party / error)
                          const next = [...selectedCharIds, ch.id];
                          setSelectedCharIds(next);
                          const cfg = configRef.current;
                          if (cfg) setPlayerParty(buildParty(next, cfg, userSpells));
                        }}
                      >
                        <div className="camp-char-avatar">
                          {uc?.avatarUrl ? (
                            <img src={uc.avatarUrl} alt={ch.name} className="camp-char-img" />
                          ) : (
                            <CharacterAvatar
                              charId={ch.id}
                              name={ch.name}
                              animations={config?.animations ?? []}
                            />
                          )}
                        </div>
                        <span className="camp-char-name">{ch.name}</span>
                        {uc ? <span className="camp-char-lv">Lv.{uc.level}</span> : null}
                      </button>
                    );
                  }))}
                </div>
                <button className="camp-start-btn" onClick={startCampaign}>
                  Start campaign
                </button>
                {error ? <p className="camp-error-text">{error}</p> : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
