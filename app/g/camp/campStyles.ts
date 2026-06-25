/* ------------------------------------------------------------------ *
 * Camp page styles — dungeon dark, game-feel polish. Scoped under
 * .camp-page to coexist with other routes. Cinzel display headings
 * for fantasy tone; system-ui body for legibility.
 * ------------------------------------------------------------------ */
export const CAMP_PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&display=swap');

.camp-page {
  display: flex; flex-direction: column;
  width: 100vw; height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  color: #e2e4ec;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(56,224,196,0.07), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(255,93,115,0.07), transparent 60%),
    linear-gradient(180deg, #0a0b12 0%, #0d0e18 50%, #080911 100%);
}

.camp-body {
  flex: 1; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}

/* ── Loading / center messages ─────────────────────────────────────── */

.camp-center-msg {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; text-align: center;
  color: rgba(255,255,255,0.4);
  font-size: 14px; line-height: 1.5; padding: 24px;
}

.camp-spinner {
  width: 26px; height: 26px;
  border: 2px solid rgba(56,224,196,0.1);
  border-top-color: #38e0c4;
  border-radius: 50%;
  animation: camp-spin 0.7s linear infinite;
}
.camp-spinner.small { width: 16px; height: 16px; }

/* ── Idle screen — campaign launch ─────────────────────────────────── */

.camp-idle {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px; text-align: center;
  padding: 40px 24px;
  max-width: 380px;
  width: 100%;
}

.camp-idle-badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(56,224,196,0.55);
  background: rgba(56,224,196,0.06);
  padding: 4px 12px; border-radius: 20px;
  border: 1px solid rgba(56,224,196,0.09);
  margin-bottom: 6px;
}

.camp-idle-title {
  font-family: 'Cinzel', serif;
  font-size: 30px; font-weight: 700;
  line-height: 1.15; letter-spacing: 0.02em;
  margin: 0;
  color: #edf0f5;
  text-shadow: 0 0 40px rgba(56,224,196,0.1);
}

.camp-idle-sub {
  font-size: 13px; color: rgba(255,255,255,0.28); margin: 0 0 2px;
  font-style: italic;
}

.camp-idle-stats {
  display: flex; align-items: center; gap: 10px;
  margin: 4px 0 20px;
  font-size: 13px; color: rgba(255,255,255,0.4);
}

.camp-stat-dot {
  width: 3px; height: 3px; border-radius: 50%;
  background: rgba(255,255,255,0.18);
}

/* ── Start campaign button ─────────────────────────────────────────── */

.camp-start-btn {
  padding: 14px 40px; border-radius: 12px; cursor: pointer;
  font-size: 15px; font-weight: 700; font-family: inherit;
  letter-spacing: 0.02em;
  color: #04140f;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border: none;
  box-shadow:
    0 8px 24px rgba(43,191,166,0.28),
    inset 0 1px 0 rgba(255,255,255,0.2);
  transition: transform 0.1s, box-shadow 0.15s;
}
.camp-start-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 12px 30px rgba(43,191,166,0.4),
    inset 0 1px 0 rgba(255,255,255,0.2);
}
.camp-start-btn:active:not(:disabled) {
  transform: translateY(0);
}
.camp-start-btn:disabled {
  opacity: 0.35; cursor: not-allowed; box-shadow: none;
}

/* ── Guard (empty state — no campaign / no monsters / no party) ── */

.camp-guard {
  display: flex; flex-direction: column;
  align-items: center; gap: 12px;
  text-align: center;
  max-width: 320px;
  color: rgba(255,255,255,0.4);
  font-size: 14px; line-height: 1.6;
}

.camp-guard-icon {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 2px;
}
.camp-guard-icon::after {
  content: '!';
  font-size: 18px; font-weight: 700;
  color: rgba(255,255,255,0.22);
  line-height: 1;
}

.camp-guard a {
  color: #38e0c4; text-decoration: none;
  font-weight: 600; font-size: 13px;
}
.camp-guard a:hover { text-decoration: underline; }

/* ── Fight area (wraps GameScreenShell + HUD overlay) ────────────── */

.camp-fight-area {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
}

/* ── Bottom character stats HUD ────────────────────────────────────── */

.camp-bottom-stats {
  height: 100%;
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 14px 16px; box-sizing: border-box;
  overflow-x: auto;
}
.camp-stat-card {
  min-width: min(220px, 88vw);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(8,10,16,0.56);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.camp-stat-name {
  font-family: 'Cinzel', serif;
  font-size: 16px; font-weight: 700;
  color: #edf0f5;
  margin-bottom: 8px;
  text-align: center;
}
.camp-stat-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.camp-stat-pill {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 999px;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.055);
}
.camp-stat-pill span {
  color: rgba(255,255,255,0.34);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.camp-stat-pill strong {
  color: #46eccf;
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* HUD — wave counter pill, top of the frame */
.camp-hud {
  position: absolute; top: 0; left: 0; right: 0;
  z-index: 40; pointer-events: none;
  display: flex; justify-content: center;
  padding: 10px 16px 0;
}

.camp-hud-inner {
  display: flex; align-items: center; gap: 6px;
  background: rgba(8,10,16,0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.05);
  padding: 5px 14px; border-radius: 20px;
  color: rgba(255,255,255,0.45);
}

.camp-pause-btn {
  pointer-events: auto;
  margin-left: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
  padding: 4px 10px;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.68);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.camp-pause-btn.active {
  color: #04140f;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border-color: rgba(70,236,207,0.4);
}

.camp-wave-loading {
  position: absolute;
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 54;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  color: rgba(255,255,255,0.72);
  background: rgba(8,10,16,0.66);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 16px 48px rgba(0,0,0,0.38);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}

/* ── Mid-campaign reward choice ────────────────────────────────────── */

.camp-reward-scrim {
  position: absolute; inset: 0; z-index: 55;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.camp-reward-panel { text-align: center; width: min(760px, 100%); }
.camp-reward-title {
  font-family: 'Cinzel', serif; font-size: 30px; margin: 0 0 22px;
  color: #edf0f5; letter-spacing: 0.02em;
}
.camp-reward-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, min(156px, 28vw)));
  justify-content: center;
  gap: clamp(8px, 2vw, 16px);
}
.camp-reward-card {
  width: 100%; aspect-ratio: 2 / 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 18px 14px; text-align: center;
  border-radius: 16px; cursor: pointer;
  color: #edf0f5;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(70,236,207,0.14), transparent 58%),
    linear-gradient(180deg, rgba(24,28,42,0.98), rgba(12,14,22,0.98));
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 24px 60px rgba(0,0,0,0.48), inset 0 0 0 1px rgba(255,255,255,0.03);
  transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.camp-reward-card.common {
  border-color: rgba(255,255,255,0.42);
  box-shadow: 0 24px 60px rgba(0,0,0,0.48), 0 0 24px rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.08);
}
.camp-reward-card.uncommon {
  border-color: rgba(70,236,123,0.55);
  box-shadow: 0 24px 60px rgba(0,0,0,0.48), 0 0 28px rgba(70,236,123,0.28), inset 0 0 0 1px rgba(70,236,123,0.12);
}
.camp-reward-card.rare {
  border-color: rgba(177,100,255,0.65);
  box-shadow: 0 24px 60px rgba(0,0,0,0.48), 0 0 34px rgba(177,100,255,0.34), inset 0 0 0 1px rgba(177,100,255,0.16);
}
.camp-reward-card:hover {
  transform: translateY(-5px);
  border-color: rgba(70,236,207,0.45);
  box-shadow: 0 30px 76px rgba(0,0,0,0.58), 0 0 34px rgba(70,236,207,0.12);
}
.camp-reward-card-name { font-family: 'Cinzel', serif; font-size: 18px; font-weight: 700; }
.camp-reward-card-rarity { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.46); }
.camp-reward-card-effect { font-size: 15px; font-weight: 800; color: #46eccf; }
.camp-reward-card-desc { font-size: 12px; line-height: 1.45; color: rgba(255,255,255,0.5); }
@media (max-width: 520px) {
  .camp-reward-scrim { padding: 14px; }
  .camp-reward-title { font-size: 24px; margin-bottom: 14px; }
  .camp-reward-card { padding: 12px 8px; gap: 8px; border-radius: 12px; }
  .camp-reward-card-name { font-size: 14px; }
  .camp-reward-card-effect { font-size: 12px; }
  .camp-reward-card-desc { font-size: 10px; line-height: 1.3; }
}

.camp-hud-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255,255,255,0.25);
}

.camp-hud-value {
  font-family: 'Cinzel', serif;
  font-size: 15px; font-weight: 700;
  color: #e8ecf5;
}

.camp-hud-divider {
  color: rgba(255,255,255,0.12);
  font-size: 12px;
}

.camp-hud-total {
  font-size: 12px; color: rgba(255,255,255,0.3);
}

/* ── Result screen — victory / defeat ──────────────────────────────── */

.camp-result-scrim {
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  background: rgba(5,6,12,0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: camp-fade 0.3s ease both;
}

.camp-result-card {
  position: relative;
  text-align: center;
  padding: 36px 44px;
  border-radius: 20px;
  background: rgba(14,16,24,0.94);
  border: 1px solid rgba(255,255,255,0.055);
  box-shadow: 0 32px 80px rgba(0,0,0,0.55);
  animation: camp-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
  max-width: 300px;
  overflow: hidden;
}

.camp-result-glow {
  position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
  pointer-events: none; z-index: 0;
}
.camp-result-card.won .camp-result-glow {
  background: radial-gradient(ellipse at 50% 30%, rgba(87,224,138,0.07), transparent 60%);
}
.camp-result-card.lost .camp-result-glow {
  background: radial-gradient(ellipse at 50% 30%, rgba(255,93,115,0.07), transparent 60%);
}

.camp-result-icon {
  position: relative; z-index: 1;
  width: 44px; height: 44px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.camp-result-card.won .camp-result-icon {
  background: rgba(87,224,138,0.08);
  border: 1px solid rgba(87,224,138,0.16);
}
/* checkmark via border trick */
.camp-result-card.won .camp-result-icon::after {
  content: '';
  width: 14px; height: 8px;
  border-left: 2.5px solid #57e08a;
  border-bottom: 2.5px solid #57e08a;
  transform: rotate(-45deg) translate(1px, -1px);
  margin-top: -3px;
}
.camp-result-card.lost .camp-result-icon {
  background: rgba(255,93,115,0.08);
  border: 1px solid rgba(255,93,115,0.16);
}
/* cross via two rotated pseudo bars */
.camp-result-card.lost .camp-result-icon::before,
.camp-result-card.lost .camp-result-icon::after {
  content: '';
  position: absolute;
  width: 18px; height: 2.5px;
  background: #ff5d73;
  border-radius: 1px;
}
.camp-result-card.lost .camp-result-icon::before {
  transform: rotate(45deg);
}
.camp-result-card.lost .camp-result-icon::after {
  transform: rotate(-45deg);
}

.camp-result-title {
  position: relative; z-index: 1;
  font-family: 'Cinzel', serif;
  font-size: 34px; font-weight: 700;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
  line-height: 1.2;
}
.camp-result-card.won .camp-result-title {
  color: #57e08a;
  text-shadow: 0 0 40px rgba(87,224,138,0.28);
}
.camp-result-card.lost .camp-result-title {
  color: #ff5d73;
  text-shadow: 0 0 40px rgba(255,93,115,0.28);
}

.camp-result-sub {
  position: relative; z-index: 1;
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  margin-bottom: 24px;
  line-height: 1.5;
  max-width: 220px;
  margin-left: auto; margin-right: auto;
}

.camp-error-text {
  color: #ffb3bd;
  display: block;
}

/* ── Reusable buttons ──────────────────────────────────────────────── */

.camp-btn {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center;
  padding: 11px 24px; border-radius: 10px; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e2e4ec;
  transition: background 0.12s, border-color 0.12s, transform 0.1s;
}
.camp-btn:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.18); }
.camp-btn:active { transform: scale(0.98); }
.camp-btn.primary {
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  color: #04140f;
  border: none;
  font-weight: 700;
  box-shadow:
    0 4px 14px rgba(43,191,166,0.25),
    inset 0 1px 0 rgba(255,255,255,0.2);
}
.camp-btn.primary:hover {
  box-shadow:
    0 6px 20px rgba(43,191,166,0.35),
    inset 0 1px 0 rgba(255,255,255,0.2);
}

/* ── Animations ────────────────────────────────────────────────────── */

@keyframes camp-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes camp-pop {
  from { opacity: 0; transform: scale(0.92) translateY(12px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes camp-spin {
  to { transform: rotate(360deg); }
}

/* ── Character selection ───────────────────────────────────────────── */

.camp-char-grid {
  display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  margin: 18px 0;
}
.camp-char-card {
  background: rgba(255,255,255,0.04); border: 2px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 8px; cursor: pointer; transition: all 0.15s;
  min-width: 90px; text-align: center;
}
.camp-char-card:hover { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.07); }
.camp-char-card.on { border-color: #3b82f6; background: rgba(59,130,246,0.12); box-shadow: 0 0 12px rgba(59,130,246,0.25); }
.camp-char-card:disabled { opacity: 0.35; cursor: not-allowed; }
.camp-char-avatar canvas { display: block; width: 64px; height: 64px; border-radius: 8px; margin: 0 auto; }
.camp-char-avatar > div { margin: 0 auto; }
.camp-char-name { display: block; font-size: 11px; font-weight: 600; margin-top: 6px; color: #c8d6e5; }
.camp-char-card.on .camp-char-name { color: #60a5fa; }
.camp-char-lv { display: block; font-size: 10px; color: #667788; margin-top: 2px; }
`;
