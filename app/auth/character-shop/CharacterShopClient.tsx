"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../AuthGuard";
import { CHAR_SHOP_STYLES } from "./shopStyles";

/* ─── Types ─────────────────────────────────────────────────────────── */

type CatalogCharacter = {
  id: string;
  name: string;
};

type UserCharacter = {
  characterId: string;
  level: number;
  isDead: number;
};

type Toast = {
  kind: "success" | "error" | "info";
  message: string;
};

type ClaimError =
  | "already_owned"
  | "has_living_character";

function friendlyClaimReason(reason: string): string {
  switch (reason as ClaimError) {
    case "already_owned":
      return "You already own this hero.";
    case "has_living_character":
      return "You can only have one living hero at a time. Send your current hero into a campaign first.";
    default:
      return reason;
  }
}

/* ─── Avatar map ─────────────────────────────────────────────────────── */

const CHAR_AVATARS: Record<string, string> = {
  "blue": "\u{2694}\u{FE0F}",
  "little-green": "\u{1F3F9}",
  "big-green": "\u{1F6E1}\u{FE0F}",
};

function charAvatar(id: string): string {
  return CHAR_AVATARS[id] ?? "\u{1F9B8}";
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function CharacterShopClient() {
  const { user } = useAuth();
  const router = useRouter();

  const [catalog, setCatalog] = useState<CatalogCharacter[]>([]);
  const [owned, setOwned] = useState<UserCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
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
      const [configRes, charsRes] = await Promise.all([
        fetch("/api/config"),
        fetch(`/api/user/characters?userId=${encodeURIComponent(uid)}`),
      ]);

      const configData = await configRes.json();
      const charsData = await charsRes.json();

      if (!charsData.ok) throw new Error(charsData.error ?? "Failed to load characters");

      setCatalog(configData.characters ?? []);
      setOwned(charsData.characters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Derived state
  const hasLiving = owned.some((c) => c.isDead === 0);
  const ownedMap = new Map<string, UserCharacter>(
    owned.map((c) => [c.characterId, c]),
  );

  const handleClaim = useCallback(
    async (characterId: string) => {
      if (!user) return;
      setClaimingId(characterId);
      try {
        const res = await fetch("/api/user/characters/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.uid, characterId }),
        });
        const data = await res.json();

        if (!data.ok) {
          showToast({
            kind: "error",
            message: friendlyClaimReason(data.reason ?? "Claim failed"),
          });
          return;
        }

        showToast({ kind: "success", message: "Hero claimed!" });
        // Refetch to get updated owned list
        await fetchAll();
      } catch {
        showToast({ kind: "error", message: "Network error. Try again." });
      } finally {
        setClaimingId(null);
      }
    },
    [user, showToast, fetchAll],
  );

  return (
    <div className="character-shop-page">
      <style>{CHAR_SHOP_STYLES}</style>
      <div className="char-shop-scanlines" />
      <div className="char-shop-vignette-top" />
      <div className="char-shop-vignette-bottom" />

      <div className="char-shop-container">
        {/* ──────── Header ──────── */}
        <header className="char-shop-header">
          <div className="char-shop-brand">
            <button
              className="char-shop-back-link"
              onClick={() => router.push("/auth/campaigns")}
            >
              <span>&larr;</span>
              <span>Back</span>
            </button>
            <span className="char-shop-brand-icon">&#x1F3F0;</span>
            <div>
              <h1 className="char-shop-brand-title">Character Shop</h1>
              <p className="char-shop-brand-sub">Free Heroes</p>
            </div>
          </div>
        </header>

        {/* Divider */}
        <div className="char-shop-divider">
          <span className="char-shop-divider-diamond">&#x25C6;</span>
          <span className="char-shop-divider-line" />
          <span className="char-shop-divider-diamond">&#x25C6;</span>
        </div>

        {/* ──────── Notice banner ──────── */}
        {hasLiving && (
          <div className="char-shop-notice">
            <span className="char-shop-notice-icon">&#x26A0;&#xFE0F;</span>
            <span>
              You already have a living hero. Only one hero may be active at
              a time. Send your current hero on a campaign to free up your
              roster.
            </span>
          </div>
        )}

        {/* ──────── Main content ──────── */}
        <main>
          {loading ? (
            <div className="char-shop-loader">
              <div className="char-shop-spinner" />
              <span>Summoning heroes...</span>
            </div>
          ) : error ? (
            <div className="char-shop-error">
              <span>{error}</span>
              <button onClick={() => void fetchAll()}>Retry</button>
            </div>
          ) : catalog.length === 0 ? (
            <div className="char-shop-empty">
              <span className="char-shop-empty-icon">&#x1F6E1;&#xFE0F;</span>
              <h2 className="char-shop-section-title">No Heroes Available</h2>
              <p>Create a character in the studio to add them here.</p>
            </div>
          ) : (
            <>
              {/* Intro text */}
              <p className="char-shop-intro">
                Choose your first hero. You can only have{" "}
                <strong>one living hero</strong> at a time&mdash;choose wisely.
              </p>

              {/* Catalog grid */}
              <div className="char-shop-catalog">
                {catalog.map((char) => {
                  const ownedChar = ownedMap.get(char.id);
                  const isOwned = !!ownedChar;
                  const isDead = ownedChar?.isDead === 1;
                  const canClaim = !hasLiving;
                  const isClaiming = claimingId === char.id;

                  // Derive status & button
                  let statusLabel: string;
                  let cardClass = "char-shop-card";
                  let btnClass = "char-shop-claim-btn";
                  let btnLabel: string;
                  let btnDisabled = true;

                  if (isOwned && !isDead) {
                    cardClass += " owned";
                    statusLabel = "Owned";
                    btnClass += " owned-btn";
                    btnLabel = "Owned";
                  } else if (isOwned && isDead) {
                    cardClass += " fallen";
                    statusLabel = "Fallen";
                    btnLabel = isClaiming ? "Reclaiming..." : "Reclaim";
                    if (canClaim && !isClaiming) {
                      btnClass += " can-claim";
                      btnDisabled = false;
                    } else if (isClaiming) {
                      btnClass += " busy";
                    } else {
                      btnClass += " disabled";
                    }
                  } else {
                    cardClass += " free";
                    statusLabel = char.id === "blue" ? "Free Starter" : "Free";
                    btnLabel = isClaiming ? "Claiming..." : "Claim";
                    if (canClaim && !isClaiming) {
                      btnClass += " can-claim";
                      btnDisabled = false;
                    } else if (isClaiming) {
                      btnClass += " busy";
                    } else {
                      btnClass += " disabled";
                    }
                  }

                  return (
                    <div key={char.id} className={cardClass}>
                      <div className="char-shop-card-avatar">
                        {charAvatar(char.id)}
                      </div>
                      <div className="char-shop-card-body">
                        <div className="char-shop-card-name">{char.name}</div>
                        <div className="char-shop-card-id">{char.id}</div>
                      </div>
                      <div className="char-shop-card-status">{statusLabel}</div>
                      <button
                        className={btnClass}
                        disabled={btnDisabled}
                        onClick={() => void handleClaim(char.id)}
                      >
                        {btnLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {/* Footer divider */}
        <div
          className="char-shop-divider"
          style={{ marginTop: "auto", paddingTop: 32 }}
        >
          <span className="char-shop-divider-diamond">&#x25C6;</span>
          <span className="char-shop-divider-line" />
          <span className="char-shop-divider-diamond">&#x25C6;</span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`char-shop-toast ${toast.kind}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
