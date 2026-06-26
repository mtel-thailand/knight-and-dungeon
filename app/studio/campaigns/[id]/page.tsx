"use client";

// /studio/campaigns/[id] — EDIT page for one campaign.
// Loads the campaign + the character roster from GET /api/config (campaign found
// by the route id). Edits name / wave count / monster pool locally, then Save
// → POST /api/config/campaign { campaign }. Activation is separate: "Set as
// active" button → POST /api/config/campaign { activeId }. Missing id is handled.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { CampaignDef, WaveDef, WaveEnemyGroup } from "@/lib/battle/types";
import { CAMPAIGN_BOUNDS } from "@/lib/battle/types";
import type { BootstrapPayload } from "../../studioTypes";
import { CAMPAIGNS_PAGE_CSS } from "../campaignsStyles";

export default function CampaignEditPage() {
  const params = useParams<{ id: string }>();
  const routeId = params?.id ?? "";

  const [campaign, setCampaign] = useState<CampaignDef | null>(null);
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) throw new Error("config fetch failed");
        const data: BootstrapPayload = await res.json();
        if (cancelled) return;
        setCharacters(Array.isArray(data.characters) ? data.characters : []);
        const found = (data.campaigns ?? []).find((c) => c.id === routeId);
        if (found) setCampaign({ ...found });
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  function update<K extends keyof CampaignDef>(
    key: K,
    value: CampaignDef[K],
  ) {
    setCampaign(
      (prev) => (prev ? { ...prev, [key]: value } : prev) as CampaignDef | null,
    );
  }

  function toggleMonster(id: string) {
    if (!campaign) return;
    const has = campaign.monsterPool.includes(id);
    update(
      "monsterPool",
      has
        ? campaign.monsterPool.filter((m) => m !== id)
        : [...campaign.monsterPool, id],
    );
  }

  async function save() {
    if (!campaign || saving) return;
    setSaving(true);
    try {
      await fetch("/api/config/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch {
      /* leave the form as-is so the user can retry */
    } finally {
      setSaving(false);
    }
  }

  async function doActivate() {
    if (!campaign || activating) return;
    setActivating(true);
    try {
      await fetch("/api/config/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeId: campaign.id }),
      });
      setCampaign((prev) =>
        prev ? { ...prev, isActive: true } : prev,
      );
    } catch {
      /* leave as-is */
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="campaigns-page">
      <style>{CAMPAIGNS_PAGE_CSS}</style>

      <nav className="menu-bar">
        <Link className="menu-bar-item" href="/studio">
          Studio
        </Link>
        <Link className="menu-bar-item" href="/studio/spells">
          Spells
        </Link>
        <Link className="menu-bar-item" href="/studio/campaigns">
          Campaigns
        </Link>
        <Link className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
        </Link>
      </nav>

      <div className="campaigns-wrap">
        <Link className="campaign-back" href="/studio/campaigns">
          ← Back to campaigns
        </Link>

        {loading ? (
          <div className="campaigns-empty">Loading campaign…</div>
        ) : notFound || !campaign ? (
          <div className="campaigns-empty">
            <p>
              No campaign found{routeId ? ` for "${routeId}"` : ""}.
            </p>
            <Link className="campaign-btn primary" href="/studio/campaigns">
              Back to campaigns
            </Link>
          </div>
        ) : (
          <div className="campaign-edit">
            <h1 className="campaigns-title">
              {campaign.name || campaign.id}
            </h1>

            <label className="campaign-field">
              <span className="campaign-field-label">Name</span>
              <input
                className="campaign-input"
                value={campaign.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>

            <label className="campaign-field">
              <span className="campaign-field-label">Wave count</span>
              <input
                className="campaign-input"
                type="number"
                min={CAMPAIGN_BOUNDS.waveCount.min}
                max={CAMPAIGN_BOUNDS.waveCount.max}
                step={1}
                value={campaign.waveCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v))
                    update(
                      "waveCount",
                      Math.max(
                        CAMPAIGN_BOUNDS.waveCount.min,
                        Math.min(
                          CAMPAIGN_BOUNDS.waveCount.max,
                          v,
                        ),
                      ),
                    );
                }}
              />
            </label>

            <label className="campaign-field">
              <span className="campaign-field-label">Spawns per wave</span>
              <input
                className="campaign-input"
                type="number"
                min={CAMPAIGN_BOUNDS.spawnCount.min}
                max={CAMPAIGN_BOUNDS.spawnCount.max}
                step={1}
                value={campaign.spawnCount ?? 0}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v))
                    update(
                      "spawnCount",
                      Math.max(
                        CAMPAIGN_BOUNDS.spawnCount.min,
                        Math.min(
                          CAMPAIGN_BOUNDS.spawnCount.max,
                          v,
                        ),
                      ),
                    );
                }}
              />
              <p className="campaign-hint">
                Extra enemies that spawn mid-fight (0 = none). Max 5 on board at once.
              </p>
            </label>

            <label className="campaign-field">
              <span className="campaign-field-label">Difficulty</span>
              <select
                className="campaign-input"
                value={campaign.difficulty ?? 1}
                onChange={(e) => update("difficulty", parseInt(e.target.value, 10))}
              >
                <option value={1}>1 — Easy</option>
                <option value={2}>2 — Normal</option>
                <option value={3}>3 — Hard</option>
              </select>
            </label>

            <div className="campaign-field">
              <span className="campaign-field-label">
                Monster pool ({campaign.monsterPool.length} selected)
              </span>
              {characters.length === 0 ? (
                <p className="campaign-hint">
                  No characters available. Add them in the studio first.
                </p>
              ) : (
                <div className="campaign-monster-grid">
                  {characters.map((ch) => (
                    <label key={ch.id} className="campaign-check">
                      <input
                        type="checkbox"
                        checked={campaign.monsterPool.includes(ch.id)}
                        onChange={() => toggleMonster(ch.id)}
                      />
                      <span>{ch.name || ch.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* ── Wave editor ──────────────────────────────────────────── */}
            <div className="campaign-field">
              <span className="campaign-field-label">Waves</span>
              <p className="campaign-hint">
                Each wave defines initial enemies and mid-fight spawns per character type.
                Max 5 enemies on board at once.
              </p>

              <div className="campaign-waves">
                {(campaign.waves ?? []).map((wave, wi) => (
                  <div key={wi} className="campaign-wave-card">
                    <div className="campaign-wave-header">
                      <strong>Wave {wi + 1}</strong>
                      <button
                        className="campaign-btn small danger"
                        type="button"
                        onClick={() => {
                          const w = [...(campaign.waves ?? [])];
                          w.splice(wi, 1);
                          update("waves", w);
                          update("waveCount", w.length);
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Initial enemies */}
                    <div className="campaign-wave-section">
                      <span className="campaign-wave-label">Initial enemies</span>
                      {wave.initial.map((grp, gi) => (
                        <div key={gi} className="campaign-wave-group">
                          <select
                            className="campaign-input small"
                            value={grp.characterId}
                            onChange={(e) => {
                              const w = [...(campaign.waves ?? [])];
                              w[wi].initial[gi].characterId = e.target.value;
                              update("waves", w);
                            }}
                          >
                            {characters.map((ch) => (
                              <option key={ch.id} value={ch.id}>{ch.name || ch.id}</option>
                            ))}
                          </select>
                          <input
                            className="campaign-input small"
                            type="number"
                            min={1}
                            max={5}
                            value={grp.count}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!isNaN(v) && v >= 1 && v <= 5) {
                                const w = [...(campaign.waves ?? [])];
                                w[wi].initial[gi].count = v;
                                update("waves", w);
                              }
                            }}
                          />
                          <button
                            className="campaign-btn small"
                            type="button"
                            onClick={() => {
                              const w = [...(campaign.waves ?? [])];
                              w[wi].initial.splice(gi, 1);
                              update("waves", w);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        className="campaign-btn small"
                        type="button"
                        onClick={() => {
                          const w = [...(campaign.waves ?? [])];
                          w[wi].initial.push({ characterId: characters[0]?.id ?? "", count: 1 });
                          update("waves", w);
                        }}
                        disabled={wave.initial.reduce((s, g) => s + g.count, 0) >= 5}
                      >
                        + Add enemy type
                      </button>
                    </div>

                    {/* Spawning enemies */}
                    <div className="campaign-wave-section">
                      <span className="campaign-wave-label">Mid-fight spawns</span>
                      {wave.spawns.map((grp, gi) => (
                        <div key={gi} className="campaign-wave-group">
                          <select
                            className="campaign-input small"
                            value={grp.characterId}
                            onChange={(e) => {
                              const w = [...(campaign.waves ?? [])];
                              w[wi].spawns[gi].characterId = e.target.value;
                              update("waves", w);
                            }}
                          >
                            {characters.map((ch) => (
                              <option key={ch.id} value={ch.id}>{ch.name || ch.id}</option>
                            ))}
                          </select>
                          <input
                            className="campaign-input small"
                            type="number"
                            min={1}
                            max={10}
                            value={grp.count}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!isNaN(v) && v >= 1 && v <= 10) {
                                const w = [...(campaign.waves ?? [])];
                                w[wi].spawns[gi].count = v;
                                update("waves", w);
                              }
                            }}
                          />
                          <button
                            className="campaign-btn small"
                            type="button"
                            onClick={() => {
                              const w = [...(campaign.waves ?? [])];
                              w[wi].spawns.splice(gi, 1);
                              update("waves", w);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        className="campaign-btn small"
                        type="button"
                        onClick={() => {
                          const w = [...(campaign.waves ?? [])];
                          w[wi].spawns.push({ characterId: characters[0]?.id ?? "", count: 1 });
                          update("waves", w);
                        }}
                      >
                        + Add spawn type
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="campaign-btn"
                type="button"
                onClick={() => {
                  const w = [...(campaign.waves ?? [])];
                  w.push({
                    initial: [{ characterId: characters[0]?.id ?? "", count: 1 }],
                    spawns: [],
                  });
                  update("waves", w);
                  update("waveCount", w.length);
                }}
              >
                + Add wave
              </button>
            </div>

            <div className="campaign-field">
              <span className="campaign-field-label">Active state</span>
              <button
                className={
                  "campaign-btn" +
                  (campaign.isActive ? " primary saved" : " primary")
                }
                onClick={doActivate}
                disabled={campaign.isActive || activating}
              >
                {campaign.isActive
                  ? "Active ✓"
                  : activating
                    ? "Activating…"
                    : "Set as active campaign"}
              </button>
            </div>

            <div className="campaign-edit-actions">
              <button
                className={
                  "campaign-btn primary" + (saved ? " saved" : "")
                }
                onClick={save}
                disabled={saving}
              >
                {saved
                  ? "Saved ✓"
                  : saving
                    ? "Saving…"
                    : "Save campaign"}
              </button>
              <Link className="campaign-btn" href="/studio/campaigns">
                Done
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
