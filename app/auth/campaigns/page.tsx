"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Jersey_25 } from "next/font/google";
import { useAuth } from "../AuthGuard";

const questFont = Jersey_25({ weight: "400", subsets: ["latin"], display: "swap" });

type Campaign = {
  id: string;
  name: string;
  waveCount: number;
  monsterPool: string[];
  isActive: boolean;
};

type UserCharacter = {
  characterId: string;
  level: number;
  isDead: number;
  exp: number;
  hp: number;
  attack: number;
  defense: number;
  actionSpeed: number;
  range: number;
};

const CARD_ICONS = ["\u{1F3F0}", "\u{2694}\u{FE0F}", "\u{1F6E1}\u{FE0F}", "\u{25C6}", "\u{1F525}", "\u{1F480}", "\u{1F5E1}\u{FE0F}", "\u{25C6}"];
const CARD_ACCENTS = ["#3b82f6", "#ef4444", "#22c55e", "#a855f7", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6"];

export default function CampaignListPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<UserCharacter[]>([]);
  const [charsLoading, setCharsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        const list: Campaign[] = data.campaigns ?? [];
        setCampaigns(list);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setCharsLoading(false);
      return;
    }
    fetch(`/api/user/characters?userId=${encodeURIComponent(user.uid)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setCharacters(data.characters ?? []);
      })
      .catch(console.error)
      .finally(() => setCharsLoading(false));
  }, [user?.uid]);

  function startCampaign(c: Campaign) {
    router.push(`/g/camp?id=${encodeURIComponent(c.id)}`);
  }

  return (
    <div style={styles.wrapper}>
      {/* Background atmosphere layers */}
      <div style={styles.bgGradient} />
      <div style={styles.bgGrid} />
      <div style={styles.bgOrb} />

      {/* Scan line overlay */}
      <div style={styles.scanlines} />

      <div style={styles.container}>
        {/* ──────── HEADER ──────── */}
        <header style={styles.header}>
          <div style={styles.brandGroup}>
            <span style={styles.brandIcon}>{`\u{2694}\u{FE0F}`}</span>
            <div>
              <h1 style={{ ...styles.brandTitle, fontFamily: questFont.style.fontFamily }}>
                Quest Log
              </h1>
              <p style={styles.brandSub}>choose your campaign</p>
            </div>
          </div>

          <div style={styles.userGroup}>
            <span style={styles.userEmail}>{user?.email ?? ""}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => router.push("/auth/spell-shop")}
                style={styles.spellShopBtn}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(168,85,247,0.2)";
                  e.currentTarget.style.color = "#c084fc";
                  e.currentTarget.style.borderColor = "rgba(168,85,247,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(168,85,247,0.1)";
                  e.currentTarget.style.color = "#a855f7";
                  e.currentTarget.style.borderColor = "rgba(168,85,247,0.2)";
                }}
              >
                &#9830; Spell Shop
              </button>
              <button
                onClick={signOut}
                style={styles.signOutBtn}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                  e.currentTarget.style.color = "#8899aa";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  e.currentTarget.style.color = "#667788";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </header>

        {/* Decorative divider */}
        <div style={styles.divider}>
          <span style={styles.dividerDiamond}>{`\u25C6`}</span>
          <span style={styles.dividerLine} />
          <span style={styles.dividerDiamond}>{`\u25C6`}</span>
        </div>

        {/* ──────── CHARACTER ROSTER ──────── */}
        {!charsLoading && characters.length > 0 && (
          <section style={styles.rosterSection}>
            <h2 style={{ ...styles.rosterTitle, fontFamily: questFont.style.fontFamily }}>
              Your Heroes
            </h2>
            <div style={styles.rosterList}>
              {characters.map((ch) => {
                const dead = ch.isDead !== 0;
                return (
                  <button
                    key={ch.characterId}
                    onClick={() => {
                      if (!dead) router.push("/auth/character/" + ch.characterId);
                    }}
                    style={{
                      ...styles.heroPill,
                      ...(dead ? styles.heroPillDead : {}),
                      cursor: dead ? "default" : "pointer",
                    }}
                    title={dead ? "Fallen \u2014 cannot be fielded" : undefined}
                    onMouseEnter={
                      !dead
                        ? (e) => {
                            e.currentTarget.style.borderColor = "#a855f7";
                            e.currentTarget.style.background = "rgba(168,85,247,0.1)";
                          }
                        : undefined
                    }
                    onMouseLeave={
                      !dead
                        ? (e) => {
                            e.currentTarget.style.borderColor = "rgba(168,85,247,0.2)";
                            e.currentTarget.style.background = "rgba(168,85,247,0.05)";
                          }
                        : undefined
                    }
                  >
                    {dead && <span style={styles.skullIcon}>{`\uD83D\uDC80`}</span>}
                    <span style={styles.heroName}>{ch.characterId}</span>
                    <span style={styles.heroLevel}>Lv.{ch.level}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ──────── CONTENT ──────── */}
        <main style={styles.main}>
          {loading ? (
            <div style={styles.centeredState}>
              <div style={styles.loaderRing}>
                <div style={styles.loaderRingInner} />
              </div>
              <p style={styles.stateText}>Summoning quests...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div style={styles.centeredState}>
              <span style={styles.emptyIcon}>{`\u{1F6E1}\u{FE0F}`}</span>
              <h2 style={{ ...styles.emptyTitle, fontFamily: questFont.style.fontFamily }}>
                No Quests Available
              </h2>
              <p style={styles.stateText}>
                The realm lies quiet. Create a campaign in the studio to begin.
              </p>
            </div>
          ) : (
            <div style={styles.cardList}>
              {campaigns.map((c, i) => {
                const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
                const icon = CARD_ICONS[i % CARD_ICONS.length];
                return (
                  <button
                    key={c.id}
                    onClick={() => startCampaign(c)}
                    style={{
                      ...styles.card,
                      borderColor: c.isActive ? accent : "rgba(255,255,255,0.06)",
                      boxShadow: c.isActive
                        ? `0 0 20px ${accent}22, inset 0 0 60px ${accent}08`
                        : "none",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.style.borderColor = accent;
                      el.style.boxShadow = `0 0 24px ${accent}33, inset 0 0 60px ${accent}0d`;
                      const arrow = el.querySelector('[data-card-arrow]') as HTMLElement;
                      if (arrow) {
                        arrow.style.color = accent;
                        arrow.style.transform = "translateX(4px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.borderColor = c.isActive ? accent : "rgba(255,255,255,0.06)";
                      el.style.boxShadow = c.isActive
                        ? `0 0 20px ${accent}22, inset 0 0 60px ${accent}08`
                        : "none";
                      const arrow = el.querySelector('[data-card-arrow]') as HTMLElement;
                      if (arrow) {
                        arrow.style.color = "rgba(255,255,255,0.12)";
                        arrow.style.transform = "translateX(0)";
                      }
                    }}
                  >
                    {/* Left accent bar */}
                    <span
                      style={{
                        ...styles.cardAccent,
                        background: `linear-gradient(to bottom, ${accent}, ${accent}44)`,
                        boxShadow: `0 0 12px ${accent}66`,
                      }}
                    />

                    {/* Icon area */}
                    <div style={styles.cardIconWrap}>
                      <span
                        style={{
                          ...styles.cardIcon,
                          textShadow: `0 0 20px ${accent}88`,
                        }}
                      >
                        {icon}
                      </span>
                    </div>

                    {/* Text content */}
                    <div style={styles.cardBody}>
                      <div style={styles.cardTitleRow}>
                        <h3
                          style={{
                            ...styles.cardTitle,
                            fontFamily: questFont.style.fontFamily,
                          }}
                        >
                          {c.name}
                        </h3>
                        {c.isActive && (
                          <span
                            style={{
                              ...styles.activeBadge,
                              background: `${accent}22`,
                              color: accent,
                              borderColor: `${accent}55`,
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>

                      <div style={styles.cardMeta}>
                        <span style={styles.metaPill}>
                          <span style={styles.metaDot}>{`\u25CF`}</span>
                          {c.waveCount} wave{c.waveCount !== 1 ? "s" : ""}
                        </span>
                        <span style={styles.metaPill}>
                          <span style={styles.metaDot}>{`\u25CF`}</span>
                          {c.monsterPool.length} monster{c.monsterPool.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    {/* Right arrow */}
                    <span data-card-arrow style={styles.cardArrow}>{`\u2192`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </main>

        {/* Footer flavor */}
        <div style={styles.footer}>
          <span>{`\u25C6`}</span>
          <span style={styles.footerText}>choose wisely, hero</span>
          <span>{`\u25C6`}</span>
        </div>
      </div>

      {/* Corner vignette overlays */}
      <div style={styles.vignetteTop} />
      <div style={styles.vignetteBottom} />
    </div>
  );
}

/* ──────────── Inline styles ──────────── */

const styles: Record<string, React.CSSProperties> = {
  /* Root wrapper — full viewport, dark canvas */
  wrapper: {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    background: "#080b12",
    color: "#c8d6e5",
    fontFamily: "system-ui, -apple-system, sans-serif",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  /* Deep background gradient — like a night sky */
  bgGradient: {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(ellipse 90% 70% at 50% 20%, #0f1729 0%, #0a0d18 40%, #060810 100%)",
    pointerEvents: "none",
    zIndex: 0,
  },

  /* Subtle grid pattern */
  bgGrid: {
    position: "fixed",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px)",
    backgroundSize: "48px 48px",
    pointerEvents: "none",
    zIndex: 0,
  },

  /* Soft glowing orb */
  bgOrb: {
    position: "fixed",
    top: "-30vh",
    right: "-10vw",
    width: "70vmax",
    height: "70vmax",
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(59, 130, 246, 0.07) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },

  /* Scan lines overlay for texture */
  scanlines: {
    position: "fixed",
    inset: 0,
    background:
      "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
    pointerEvents: "none",
    zIndex: 1,
  },

  /* Content container */
  container: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    maxWidth: 520,
    padding: "24px 20px 40px",
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
  },

  /* ─── HEADER ─── */
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingTop: 8,
  },

  brandGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },

  brandIcon: {
    fontSize: 28,
    lineHeight: 1,
    filter: "drop-shadow(0 0 8px rgba(59,130,246,0.5))",
  },

  brandTitle: {
    fontSize: 28,
    color: "#e8edf5",
    letterSpacing: "0.02em",
    lineHeight: 1.1,
    margin: 0,
  },

  brandSub: {
    fontSize: 11,
    color: "#556688",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    margin: 0,
    marginTop: 1,
  },

  userGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
  },

  userEmail: {
    fontSize: 11,
    color: "#445566",
    maxWidth: 140,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "right",
  },

  signOutBtn: {
    padding: "5px 14px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#667788",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "0.04em",
    transition: "all 0.2s",
  },

  /* ─── DIVIDER ─── */
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "20px 0 24px",
  },

  dividerLine: {
    flex: 1,
    height: 1,
    background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.2), transparent)",
  },

  dividerDiamond: {
    fontSize: 8,
    color: "rgba(59,130,246,0.4)",
  },

  /* ─── MAIN ─── */
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },

  /* ─── CENTERED STATE (loading / empty) ─── */
  centeredState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: "80px 20px",
    textAlign: "center",
  },

  /* Loading spinner ring */
  loaderRing: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "3px solid rgba(59,130,246,0.1)",
    borderTopColor: "#3b82f6",
    animation: "spin 0.9s linear infinite",
  } as React.CSSProperties,
  loaderRingInner: {},

  stateText: {
    fontSize: 14,
    color: "#556677",
    lineHeight: 1.5,
    maxWidth: 280,
    margin: 0,
  },

  emptyIcon: {
    fontSize: 48,
    lineHeight: 1,
    opacity: 0.5,
    marginBottom: 4,
  },

  emptyTitle: {
    fontSize: 22,
    color: "#667788",
    margin: 0,
    letterSpacing: "0.02em",
  },

  /* ─── CARD LIST ─── */
  cardList: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },

  /* Individual campaign card */
  card: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "16px 16px 16px 0",
    background: "linear-gradient(135deg, rgba(20,24,36,0.95) 0%, rgba(14,18,30,0.95) 100%)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
    transition: "border-color 0.25s, box-shadow 0.3s, transform 0.15s",
    textAlign: "left",
    fontFamily: "inherit",
    width: "100%",
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
    outline: "none",
  } as React.CSSProperties,

  /* Left accent bar */
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },

  /* Icon container */
  cardIconWrap: {
    flexShrink: 0,
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  cardIcon: {
    fontSize: 26,
    lineHeight: 1,
    filter: "drop-shadow(0 0 6px rgba(255,255,255,0.15))",
  },

  /* Body text area */
  cardBody: {
    flex: 1,
    minWidth: 0,
  },

  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
    flexWrap: "wrap",
  },

  cardTitle: {
    fontSize: 18,
    color: "#e8edf5",
    margin: 0,
    lineHeight: 1.2,
    letterSpacing: "0.01em",
  },

  activeBadge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.12em",
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid",
    lineHeight: 1.3,
  },

  cardMeta: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  metaPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "#667788",
    background: "rgba(255,255,255,0.03)",
    padding: "3px 10px",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.05)",
  },

  metaDot: {
    fontSize: 8,
    color: "#3b82f6",
  },

  cardArrow: {
    flexShrink: 0,
    fontSize: 16,
    color: "rgba(255,255,255,0.12)",
    marginRight: 4,
    transition: "color 0.2s, transform 0.2s",
  },

  /* ─── SPELL SHOP BUTTON ─── */
  spellShopBtn: {
    padding: "5px 14px",
    borderRadius: 6,
    border: "1px solid rgba(168,85,247,0.2)",
    background: "rgba(168,85,247,0.1)",
    color: "#a855f7",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "0.04em",
    transition: "all 0.2s",
    whiteSpace: "nowrap",
  },

  /* ─── CHARACTER ROSTER ─── */
  rosterSection: {
    marginBottom: 20,
  },

  rosterTitle: {
    fontSize: 13,
    color: "#667788",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    margin: 0,
    marginBottom: 10,
  },

  rosterList: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },

  heroPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 14px",
    borderRadius: 20,
    border: "1px solid rgba(168,85,247,0.2)",
    background: "rgba(168,85,247,0.05)",
    color: "#c8d6e5",
    fontSize: 13,
    lineHeight: 1.3,
    transition: "border-color 0.2s, background 0.2s",
    fontFamily: "inherit",
    outline: "none",
    WebkitTapHighlightColor: "transparent",
  } as React.CSSProperties,

  heroPillDead: {
    opacity: 0.4,
    border: "1px dashed rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.02)",
    color: "#667788",
    cursor: "default",
    pointerEvents: "none" as const,
  },

  skullIcon: {
    fontSize: 13,
    lineHeight: 1,
  },

  heroName: {
    fontWeight: 500,
  },

  heroLevel: {
    fontSize: 11,
    color: "#a855f7",
    fontWeight: 600,
    letterSpacing: "0.04em",
  },

  /* ─── FOOTER ─── */
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 40,
    paddingTop: 20,
    borderTop: "1px solid rgba(255,255,255,0.04)",
    fontSize: 8,
    color: "rgba(59,130,246,0.3)",
  },

  footerText: {
    fontSize: 10,
    color: "#334455",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
  },

  /* Corner vignettes */
  vignetteTop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: "15vh",
    background: "linear-gradient(to bottom, rgba(8,11,18,0.6) 0%, transparent 100%)",
    pointerEvents: "none",
    zIndex: 1,
  },

  vignetteBottom: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: "20vh",
    background: "linear-gradient(to top, rgba(8,11,18,0.8) 0%, transparent 100%)",
    pointerEvents: "none",
    zIndex: 1,
  },
};
