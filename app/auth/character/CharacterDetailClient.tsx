"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthGuard";
import { DETAIL_STYLES } from "./detailStyles";
import type { SpellDef } from "@/lib/battle/types";

export type FullUserCharacter = {
  userId: string;
  characterId: string;
  level: number;
  exp: number;
  hp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  range: number;
  sortOrder: number;
  avatarUrl: string | null;
  isDead: number;
  spellHpThreshold: number;
};

type OwnedSpell = {
  characterId: string;
  spellId: string;
};

type Toast = {
  kind: "success" | "error";
  message: string;
};

const SPELL_ICONS: Record<string, string> = {
  fire: "\u{1F525}",
  ice: "\u{2744}\u{FE0F}",
  lightning: "\u{26A1}",
  heal: "\u{2764}\u{FE0F}",
  shield: "\u{1F6E1}\u{FE0F}",
};

function spellIcon(spell: SpellDef): string {
  if (spell.type === "heal") return "\u{2764}\u{FE0F}";
  const id = spell.id.toLowerCase();
  for (const [key, icon] of Object.entries(SPELL_ICONS)) {
    if (id.includes(key)) return icon;
  }
  return "\u{2728}";
}

function spellTypeBadge(type: string): string {
  switch (type) {
    case "attack": return "Attack";
    case "heal": return "Heal";
    case "buff": return "Buff";
    case "debuff": return "Debuff";
    default: return type;
  }
}

export default function CharacterDetailClient({
  characterId,
}: {
  characterId: string;
}) {
  const { user } = useAuth();
  const router = useRouter();

  const [character, setCharacter] = useState<FullUserCharacter | null>(null);
  const [catalog, setCatalog] = useState<SpellDef[]>([]);
  const [ownedSpells, setOwnedSpells] = useState<OwnedSpell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Threshold state
  const [threshold, setThreshold] = useState<number>(50);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const uid = user.uid;
      const [charsRes, spellsRes, configRes] = await Promise.all([
        fetch(`/api/user/characters?userId=${encodeURIComponent(uid)}`),
        fetch(`/api/user/spells?userId=${encodeURIComponent(uid)}`),
        fetch("/api/config"),
      ]);

      const charsData = await charsRes.json();
      const spellsData = await spellsRes.json();
      const configData = await configRes.json();

      if (!charsData.ok) throw new Error(charsData.error ?? "Failed to load characters");
      if (!spellsData.ok) throw new Error(spellsData.error ?? "Failed to load owned spells");

      const found = (charsData.characters ?? []).find(
        (c: FullUserCharacter) => c.characterId === characterId,
      );
      if (!found) {
        setCharacter(null);
      } else {
        setCharacter(found);
        setThreshold(found.spellHpThreshold ?? 50);
      }
      setCatalog(configData.spells ?? []);
      setOwnedSpells(spellsData.spells ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [user, characterId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Threshold changed — reset "saved" state
  const thresholdDirty = character && threshold !== character.spellHpThreshold;

  const handleSaveThreshold = useCallback(async () => {
    if (!user || !character) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/user/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.uid,
          characterId: character.characterId,
          spellHpThreshold: threshold,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        showToast({ kind: "error", message: data.error ?? "Failed to save" });
        return;
      }
      // Optimistic local update
      setCharacter((prev) =>
        prev ? { ...prev, spellHpThreshold: threshold } : prev,
      );
      setSaved(true);
      showToast({ kind: "success", message: "Threshold saved!" });
      // Auto-clear saved state after 2s
      setTimeout(() => setSaved(false), 2000);
    } catch {
      showToast({ kind: "error", message: "Network error. Try again." });
    } finally {
      setSaving(false);
    }
  }, [user, character, threshold, showToast]);

  // Owned spells for this character
  const ownedForChar = ownedSpells
    .filter((o) => o.characterId === characterId)
    .map((o) => o.spellId);
  const ownedCatalog = catalog.filter((s) => ownedForChar.includes(s.id));

  return (
    <div className="char-detail-page">
      <style>{DETAIL_STYLES}</style>
      <div className="char-detail-scanlines" />
      <div className="char-detail-vignette-top" />
      <div className="char-detail-vignette-bottom" />

      <div className="char-container">
        {/* ──────── Header bar ──────── */}
        <header className="char-header-bar">
          <button
            className="char-back-link"
            onClick={() => router.push("/auth/campaigns")}
          >
            <span>&larr;</span>
            <span>Quests</span>
          </button>

          <div className="char-header-actions">
            <button
              className="char-back-link"
              onClick={() => router.push("/auth/spell-shop")}
              style={{ fontSize: 12 }}
            >
              <span>&#x1F9FF;</span>
              <span>Shop</span>
            </button>
          </div>
        </header>

        {/* ──────── Content ──────── */}
        <main>
          {loading ? (
            <div className="char-loader">
              <div className="char-spinner" />
              <span>Summoning hero data...</span>
            </div>
          ) : error ? (
            <div className="char-error">
              <span>{error}</span>
              <button onClick={() => void fetchAll()}>Retry</button>
            </div>
          ) : !character ? (
            <div className="char-not-found">
              <span className="char-not-found-icon">&#x1F50D;</span>
              <p>Hero &ldquo;{characterId}&rdquo; not found in your roster.</p>
              <button
                className="char-back-link"
                onClick={() => router.push("/auth/campaigns")}
                style={{ fontSize: 13 }}
              >
                <span>&larr;</span>
                <span>Back to Quests</span>
              </button>
            </div>
          ) : (
            <>
              {/* ─── Character Hero Card ─── */}
              <div
                className={`char-hero-card${character.isDead ? " dead" : ""}`}
              >
                <div className="char-hero-row">
                  <div className="char-hero-avatar">
                    {character.isDead ? "\u{1F480}" : "\u{1F9B8}"}
                  </div>
                  <div className="char-hero-info">
                    <h1 className="char-hero-name">
                      {character.characterId}
                    </h1>
                    {character.isDead ? (
                      <div className="char-dead-tag">
                        <span>&#x2716;</span>
                        <span>Fallen</span>
                      </div>
                    ) : (
                      <div className="char-hero-level">
                        <span>Level</span>
                        <strong>{character.level}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats grid */}
                <div className="char-stats-grid">
                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x2764;&#xFE0F;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">HP</span>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span className="char-stat-value hp-current">
                          {character.hp}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x1F5E1;&#xFE0F;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">Attack</span>
                      <span className="char-stat-value attack">
                        {character.attack}
                      </span>
                    </div>
                  </div>

                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x1F6E1;&#xFE0F;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">Defense</span>
                      <span className="char-stat-value defense">
                        {character.defense}
                      </span>
                    </div>
                  </div>

                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x26A1;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">Speed</span>
                      <span className="char-stat-value speed">
                        {character.actionSpeed}
                      </span>
                    </div>
                  </div>

                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x1F3AF;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">Range</span>
                      <span className="char-stat-value range">
                        {character.range}
                      </span>
                    </div>
                  </div>

                  <div className="char-stat-item">
                    <span className="char-stat-icon">&#x1F4CA;</span>
                    <div className="char-stat-body">
                      <span className="char-stat-label">EXP</span>
                      <span className="char-stat-value" style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, fontWeight: 600 }}>
                        {character.exp.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Owned Spells Sub-menu ─── */}
              <div className="char-spells-panel">
                <h2 className="char-section-title">Owned Spells</h2>

                {ownedCatalog.length === 0 ? (
                  <div className="char-spells-empty">
                    {character.isDead
                      ? "A fallen hero carries no spells."
                      : "No spells owned yet. Visit the Spell Shop to invest in this hero."}
                  </div>
                ) : (
                  <div className="char-spells-list">
                    {ownedCatalog.map((spell) => (
                      <div key={spell.id} className="char-spell-row">
                        <span className="char-spell-icon">
                          {spellIcon(spell)}
                        </span>
                        <div className="char-spell-info">
                          <span className="char-spell-name">
                            {spell.name}
                          </span>
                          <div className="char-spell-meta">
                            <span className={`char-spell-badge ${spell.type}`}>
                              {spellTypeBadge(spell.type)}
                            </span>
                            <span className="char-spell-mana">
                              &#x26A1; {spell.manaCost} per cast
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ─── HP% Threshold Config ─── */}
              {!character.isDead && (
                <div className="char-threshold-panel">
                  <h2 className="char-section-title">Heal Trigger</h2>

                  <div className="char-threshold-label">
                    During battle, {character.characterId} will cast a heal
                    spell on an ally when their HP drops below{" "}
                    <strong>{threshold}%</strong>.
                  </div>

                  <div className="char-threshold-controls">
                    <div className="char-threshold-slider-wrap">
                      <input
                        type="range"
                        className="char-threshold-slider"
                        min={0}
                        max={100}
                        step={5}
                        value={threshold}
                        onChange={(e) => {
                          setThreshold(Number(e.target.value));
                          setSaved(false);
                        }}
                        aria-label="Heal trigger percentage"
                      />
                      <div className="char-threshold-slider-labels">
                        <span>0% (off)</span>
                        <span>100% (always)</span>
                      </div>
                    </div>

                    <div className="char-threshold-value">
                      {threshold}
                      <span className="char-threshold-pct">%</span>
                    </div>

                    <button
                      className={`char-threshold-save-btn${saved ? " saved" : ""}`}
                      disabled={saving || !thresholdDirty}
                      onClick={() => void handleSaveThreshold()}
                    >
                      {saved ? "Saved" : saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {/* If dead, show a read-only state for threshold */}
              {character.isDead && (
                <div
                  className="char-threshold-panel"
                  style={{ opacity: 0.4, pointerEvents: "none" }}
                >
                  <h2 className="char-section-title">Heal Trigger</h2>
                  <div className="char-threshold-label">
                    A fallen hero cannot fight or heal. Their threshold was{" "}
                    <strong>{character.spellHpThreshold}%</strong>.
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* Footer divider */}
        <div className="char-divider" style={{ marginTop: "auto", paddingTop: 32 }}>
          <span className="char-divider-diamond">&#x25C6;</span>
          <span className="char-divider-line" />
          <span className="char-divider-diamond">&#x25C6;</span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`char-toast ${toast.kind}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
