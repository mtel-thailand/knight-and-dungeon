"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthGuard";
import { SHOP_STYLES } from "./shopStyles";
import type { SpellDef } from "@/lib/battle/types";

type UserCharacter = {
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
  dark: "\u{2B50}",
  magic: "\u{2728}",
};

function spellIcon(spell: SpellDef): string {
  const id = spell.id.toLowerCase();
  for (const [key, icon] of Object.entries(SPELL_ICONS)) {
    if (id.includes(key)) return icon;
  }
  return "\u{2728}";
}

function spellTypeLabel(type: string): string {
  switch (type) {
    case "attack": return "Attack";
    case "heal": return "Heal";
    case "buff": return "Buff";
    case "debuff": return "Debuff";
    default: return type;
  }
}

export default function SpellShopClient() {
  const { user } = useAuth();
  const router = useRouter();

  // Data
  const [characters, setCharacters] = useState<UserCharacter[]>([]);
  const [catalog, setCatalog] = useState<SpellDef[]>([]);
  const [owned, setOwned] = useState<OwnedSpell[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [buyingSpell, setBuyingSpell] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Clear toast after a delay
  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const uid = user.uid;
      const [statsRes, charsRes, spellsRes, configRes] = await Promise.all([
        fetch(`/api/user/stats?userId=${encodeURIComponent(uid)}`),
        fetch(`/api/user/characters?userId=${encodeURIComponent(uid)}`),
        fetch(`/api/user/spells?userId=${encodeURIComponent(uid)}`),
        fetch("/api/config"),
      ]);

      const statsData = await statsRes.json();
      const charsData = await charsRes.json();
      const spellsData = await spellsRes.json();
      const configData = await configRes.json();

      if (!statsData.ok) throw new Error(statsData.error ?? "Failed to load stats");
      if (!charsData.ok) throw new Error(charsData.error ?? "Failed to load characters");
      if (!spellsData.ok) throw new Error(spellsData.error ?? "Failed to load spells");

      setBalance(statsData.stats?.totalMana ?? 0);
      setCharacters(charsData.characters ?? []);
      setOwned(spellsData.spells ?? []);
      setCatalog(configData.spells ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Auto-select first alive character on load
  useEffect(() => {
    if (characters.length > 0 && !selectedChar) {
      const firstAlive = characters.find((c) => !c.isDead);
      if (firstAlive) setSelectedChar(firstAlive.characterId);
    }
  }, [characters, selectedChar]);

  // Derived data
  const aliveChars = characters.filter((c) => !c.isDead);
  const deadChars = characters.filter((c) => c.isDead);
  const ownedForChar = owned.filter((o) => o.characterId === selectedChar).map((o) => o.spellId);
  const ownedSet = new Set(ownedForChar);

  const handleBuy = useCallback(
    async (spellId: string) => {
      if (!user || !selectedChar) return;
      setBuyingSpell(spellId);
      try {
        const res = await fetch("/api/user/spells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.uid, characterId: selectedChar, spellId }),
        });
        const data = await res.json();
        if (!data.ok) {
          const reason = data.reason ?? "Purchase failed";
          showToast({ kind: "error", message: reason === "insufficient" ? "Not enough mana" : reason === "already_owned" ? "Already owned" : reason });
          return;
        }
        // Optimistic update: add to owned, update balance
        setOwned((prev) => [...prev, { characterId: selectedChar, spellId }]);
        if (typeof data.balance === "number") {
          setBalance(data.balance);
        }
        showToast({ kind: "success", message: "Spell purchased!" });
      } catch {
        showToast({ kind: "error", message: "Network error. Try again." });
      } finally {
        setBuyingSpell(null);
      }
    },
    [user, selectedChar, showToast],
  );

  const selectedCharData = characters.find((c) => c.characterId === selectedChar);

  return (
    <div className="spell-shop-page">
      <style>{SHOP_STYLES}</style>
      <div className="shop-scanlines" />
      <div className="shop-vignette-top" />
      <div className="shop-vignette-bottom" />

      <div className="shop-container">
        {/* ──────── Header ──────── */}
        <header className="shop-header">
          <div className="shop-brand">
            <button className="shop-back-link" onClick={() => router.push("/auth/campaigns")}>
              <span>&larr;</span>
              <span>Back</span>
            </button>
            <span className="shop-brand-icon">&#x1F3F0;</span>
            <div>
              <h1 className="shop-brand-title">Spell Shop</h1>
              <p className="shop-brand-sub">Invest in your heroes</p>
            </div>
          </div>

          <div className="shop-wallet">
            <span className="shop-wallet-icon">&#x1F9FF;</span>
            <div>
              <div className="shop-wallet-label">Mana</div>
              <div className="shop-wallet-value">{balance.toLocaleString()}</div>
            </div>
          </div>
        </header>

        {/* Divider */}
        <div className="shop-divider">
          <span className="shop-divider-diamond">&#x25C6;</span>
          <span className="shop-divider-line" />
          <span className="shop-divider-diamond">&#x25C6;</span>
        </div>

        {/* ──────── Content ──────── */}
        <main>
          {loading ? (
            <div className="shop-loader">
              <div className="shop-spinner" />
              <span>Loading…</span>
            </div>
          ) : error ? (
            <div className="shop-error">
              <span>{error}</span>
              <button onClick={() => void fetchAll()}>Retry</button>
            </div>
          ) : characters.length === 0 ? (
            <div className="shop-empty-state">
              <span className="shop-empty-icon">&#x1F6E1;&#xFE0F;</span>
              <h2 className="shop-section-title">No Heroes Available</h2>
              <p>You need at least one hero in your roster to shop for spells.</p>
            </div>
          ) : (
            <>
              {/* ─── Character Roster ─── */}
              <h2 className="shop-section-title" style={{ marginBottom: 12 }}>
                Your Heroes
              </h2>

              <div className="shop-char-roster" style={{ marginBottom: 24 }}>
                {aliveChars.map((c) => (
                  <button
                    key={c.characterId}
                    className={`shop-char-card ${selectedChar === c.characterId ? "selected" : ""}`}
                    onClick={() => setSelectedChar(c.characterId)}
                    onDoubleClick={() => router.push(`/auth/character/${encodeURIComponent(c.characterId)}`)}
                    title="Click to select. Double-click for details."
                  >
                    <span className="shop-char-avatar">&#x1F9B8;</span>
                    <span className="shop-char-name">{c.characterId}</span>
                    <span className="shop-char-lv">Lv.{c.level}</span>
                  </button>
                ))}
                {deadChars.map((c) => (
                  <button
                    key={c.characterId}
                    className="shop-char-card dead"
                    disabled
                    onClick={() => router.push(`/auth/character/${encodeURIComponent(c.characterId)}`)}
                    title="View fallen hero details"
                  >
                    <span className="shop-char-avatar">&#x1F480;</span>
                    <span className="shop-char-name fallen">{c.characterId}</span>
                    <span className="shop-char-dead-tag">Fallen</span>
                  </button>
                ))}
              </div>

              {/* ─── Forfeit Warning ─── */}
              {selectedCharData && (
                <div className="shop-forfeit-warn" style={{ marginBottom: 20 }}>
                  <span className="shop-forfeit-warn-icon">&#x26A0;&#xFE0F;</span>
                  <span>
                    Spells are bought per hero. If <strong>{selectedCharData.characterId}</strong> dies in a
                    campaign, the hero is lost for good — and their purchased spells with them.
                  </span>
                </div>
              )}

              {/* ─── Spell Catalog ─── */}
              <h2 className="shop-section-title" style={{ marginBottom: 12 }}>
                Available Spells
                {selectedChar && (
                  <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.15)", fontSize: 12, marginLeft: 8 }}>
                    for {selectedChar}
                  </span>
                )}
              </h2>

              {catalog.length === 0 ? (
                <div className="shop-empty-state">
                  <span className="shop-empty-icon">&#x2728;</span>
                  <p>No spells in the catalog yet.</p>
                </div>
              ) : (
                <div className="shop-spell-grid">
                  {catalog.map((spell) => {
                    const alreadyOwned = ownedSet.has(spell.id);
                    const canAfford = balance >= spell.price;
                    const isBuying = buyingSpell === spell.id;

                    let btnClass = "shop-buy-btn";
                    let btnLabel: string;

                    if (alreadyOwned) {
                      btnClass += " owned-btn";
                      btnLabel = "Owned";
                    } else if (isBuying) {
                      btnClass += " buying";
                      btnLabel = "Buying...";
                    } else if (!canAfford) {
                      btnClass += " insufficient";
                      btnLabel = `Need ${(spell.price - balance).toLocaleString()} more`;
                    } else {
                      btnClass += " can-buy";
                      btnLabel = `Buy — ${spell.price.toLocaleString()} Mana`;
                    }

                    return (
                      <div key={spell.id} className={`shop-spell-card ${alreadyOwned ? "owned" : ""}`}>
                        <div className="shop-spell-icon">{spellIcon(spell)}</div>

                        <div className="shop-spell-header">
                          <span className="shop-spell-name">{spell.name}</span>
                          <span className="shop-spell-type">{spellTypeLabel(spell.type)}</span>
                        </div>

                        <div className="shop-spell-power">
                          Power: &times;{spell.power}
                        </div>

                        <div className="shop-spell-detail">
                          <span className="shop-spell-price">
                            &#x1F9FF; {spell.price.toLocaleString()}
                          </span>
                          <span className="shop-spell-mana">
                            &#x26A1; {spell.manaCost} per cast
                          </span>
                          <span className="shop-spell-cooldown">
                            &#x23F1;&#xFE0F; {spell.cooldown}s
                          </span>
                        </div>

                        <button
                          className={btnClass}
                          disabled={alreadyOwned || !canAfford || isBuying}
                          onClick={() => void handleBuy(spell.id)}
                        >
                          {btnLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>

        {/* Footer */}
        <div className="shop-divider" style={{ marginTop: "auto", paddingTop: 32 }}>
          <span className="shop-divider-diamond">&#x25C6;</span>
          <span className="shop-divider-line" />
          <span className="shop-divider-diamond">&#x25C6;</span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`shop-toast ${toast.kind}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
