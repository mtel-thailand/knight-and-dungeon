/* ------------------------------------------------------------------ *
 * Character Detail styles — dark fantasy, scoped under
 * .char-detail-page to coexist with other routes.
 * ------------------------------------------------------------------ */
export const DETAIL_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&display=swap');

/* ── Root ──────────────────────────────────────────────────────────── */

.char-detail-page {
  display: flex; flex-direction: column;
  width: 100vw; height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  color: #c8d6e5;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(59,130,246,0.06), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(139,92,246,0.05), transparent 60%),
    linear-gradient(180deg, #0a0b12 0%, #0d0e18 50%, #080911 100%);
  position: relative;
}

.char-detail-scanlines {
  position: fixed; inset: 0;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
  pointer-events: none; z-index: 0;
}

.char-detail-vignette-top {
  position: fixed; top: 0; left: 0; right: 0; height: 12vh;
  background: linear-gradient(to bottom, rgba(8,11,18,0.5) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

.char-detail-vignette-bottom {
  position: fixed; bottom: 0; left: 0; right: 0; height: 16vh;
  background: linear-gradient(to top, rgba(8,11,18,0.7) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

/* ── Container ─────────────────────────────────────────────────────── */

.char-container {
  position: relative; z-index: 1;
  width: 100%; max-width: 660px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  display: flex; flex-direction: column;
  gap: 20px;
}

/* ── Header bar ──────────────────────────────────────────────────── */

.char-header-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 8px;
}

.char-back-link {
  display: inline-flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,0.3);
  font-size: 13px; font-weight: 600; text-decoration: none;
  padding: 6px 12px; border-radius: 8px;
  transition: color 0.12s, background 0.12s;
  border: none; background: transparent; cursor: pointer;
  font-family: inherit;
  margin-left: -6px;
}
.char-back-link:hover {
  color: #c8d6e5;
  background: rgba(255,255,255,0.05);
}

.char-header-actions {
  display: flex; align-items: center; gap: 8px;
}

/* ── Character hero card ──────────────────────────────────────────── */

.char-hero-card {
  display: flex; flex-direction: column;
  gap: 16px;
  padding: 24px;
  border-radius: 16px;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(139,92,246,0.06), transparent 58%),
    linear-gradient(180deg, rgba(20,24,36,0.96), rgba(12,14,22,0.96));
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 12px 32px rgba(0,0,0,0.35);
}

.char-hero-card.dead {
  border-color: rgba(255,93,115,0.12);
  opacity: 0.7;
}

.char-hero-row {
  display: flex; align-items: center; gap: 16px;
}

.char-hero-avatar {
  width: 56px; height: 56px;
  border-radius: 12px;
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; line-height: 1;
  flex-shrink: 0;
}

.char-hero-info {
  flex: 1; min-width: 0;
}

.char-hero-name {
  font-family: 'Cinzel', serif;
  font-size: 22px; font-weight: 700;
  color: #e8edf5;
  line-height: 1.2;
  margin: 0;
}

.char-hero-level {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 4px;
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.35);
}

.char-hero-level strong {
  font-family: 'Cinzel', serif;
  font-size: 16px; font-weight: 700;
  color: #8b5cf6;
}

.char-dead-tag {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 4px;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255,93,115,0.6);
  background: rgba(255,93,115,0.06);
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,93,115,0.12);
}

/* ── Stats grid ────────────────────────────────────────────────────── */

.char-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.char-stat-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
}

.char-stat-icon {
  font-size: 16px; line-height: 1;
  flex-shrink: 0;
}

.char-stat-body {
  display: flex; flex-direction: column;
  min-width: 0;
}

.char-stat-label {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.2);
}

.char-stat-value {
  font-family: 'Cinzel', serif;
  font-size: 18px; font-weight: 900;
  color: #e8edf5;
  line-height: 1.2;
  letter-spacing: 0.01em;
}

.char-stat-value.hp-current {
  color: #46eccf;
}

.char-stat-value.hp-max {
  font-size: 13px; font-weight: 700;
  color: rgba(255,255,255,0.2);
}

.char-stat-value.attack {
  color: #ef4444;
}

.char-stat-value.defense {
  color: #60a5fa;
}

.char-stat-value.speed {
  color: #f59e0b;
}

.char-stat-value.range {
  color: #a78bfa;
}

/* ── Section title ─────────────────────────────────────────────────── */

.char-section-title {
  font-family: 'Cinzel', serif;
  font-size: 14px; font-weight: 700;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 0 0 12px;
  display: flex; align-items: center; justify-content: space-between;
}

/* ── Divider ────────────────────────────────────────────────────────── */

.char-divider {
  display: flex; align-items: center; gap: 12px;
}

.char-divider-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139,92,246,0.18), transparent);
}

.char-divider-diamond {
  font-size: 8px; color: rgba(139,92,246,0.3);
}

/* ── Spells sub-menu ────────────────────────────────────────────────── */

.char-spells-panel {
  padding: 20px;
  border-radius: 14px;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(139,92,246,0.04), transparent 58%),
    linear-gradient(180deg, rgba(20,24,36,0.96), rgba(12,14,22,0.96));
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
}

.char-spells-empty {
  font-size: 13px; color: rgba(255,255,255,0.2);
  text-align: center;
  padding: 20px;
  line-height: 1.5;
}

.char-spells-list {
  display: flex; flex-direction: column;
  gap: 8px;
}

.char-spell-row {
  display: flex; align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  transition: border-color 0.12s, background 0.12s;
}

.char-spell-row:hover {
  border-color: rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
}

.char-spell-icon {
  font-size: 20px; line-height: 1;
  flex-shrink: 0;
  width: 32px; text-align: center;
}

.char-spell-info {
  flex: 1; min-width: 0;
}

.char-spell-name {
  font-family: 'Cinzel', serif;
  font-size: 14px; font-weight: 700;
  color: #e8edf5;
  line-height: 1.2;
}

.char-spell-meta {
  display: flex; align-items: center; gap: 8px;
  margin-top: 3px;
  font-size: 11px; color: rgba(255,255,255,0.3);
}

.char-spell-badge {
  display: inline-block;
  font-size: 9px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 4px;
  line-height: 1.2;
}

.char-spell-badge.attack {
  color: rgba(239,68,68,0.6);
  background: rgba(239,68,68,0.06);
  border: 1px solid rgba(239,68,68,0.1);
}

.char-spell-badge.heal {
  color: rgba(70,236,207,0.6);
  background: rgba(70,236,207,0.06);
  border: 1px solid rgba(70,236,207,0.1);
}

.char-spell-badge.buff {
  color: rgba(96,165,250,0.6);
  background: rgba(96,165,250,0.06);
  border: 1px solid rgba(96,165,250,0.1);
}

.char-spell-badge.debuff {
  color: rgba(245,158,11,0.6);
  background: rgba(245,158,11,0.06);
  border: 1px solid rgba(245,158,11,0.1);
}

.char-spell-mana {
  font-size: 12px; font-weight: 700;
  color: #60a5fa;
  white-space: nowrap;
}

/* ── HP threshold slider ────────────────────────────────────────────── */

.char-threshold-panel {
  padding: 20px;
  border-radius: 14px;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(70,236,207,0.04), transparent 58%),
    linear-gradient(180deg, rgba(20,24,36,0.96), rgba(12,14,22,0.96));
  border: 1px solid rgba(70,236,207,0.08);
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
}

.char-threshold-label {
  font-size: 13px; color: rgba(255,255,255,0.55);
  line-height: 1.5;
  margin-bottom: 16px;
}

.char-threshold-label strong {
  font-family: 'Cinzel', serif;
  color: #46eccf;
  font-weight: 700;
}

.char-threshold-controls {
  display: flex; align-items: center; gap: 14px;
}

.char-threshold-slider-wrap {
  flex: 1; position: relative;
}

.char-threshold-slider {
  width: 100%; height: 6px;
  -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.char-threshold-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border: 2px solid rgba(8,11,18,0.8);
  box-shadow: 0 0 12px rgba(70,236,207,0.3);
  cursor: pointer;
  transition: box-shadow 0.12s;
}

.char-threshold-slider::-webkit-slider-thumb:hover {
  box-shadow: 0 0 20px rgba(70,236,207,0.5);
}

.char-threshold-slider::-moz-range-thumb {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border: 2px solid rgba(8,11,18,0.8);
  box-shadow: 0 0 12px rgba(70,236,207,0.3);
  cursor: pointer;
}

.char-threshold-value {
  font-family: 'Cinzel', serif;
  font-size: 24px; font-weight: 900;
  color: #46eccf;
  min-width: 48px;
  text-align: center;
  line-height: 1;
  letter-spacing: 0.01em;
}

.char-threshold-pct {
  font-size: 14px; font-weight: 700;
  color: rgba(70,236,207,0.4);
}

.char-threshold-save-btn {
  padding: 8px 20px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px; font-weight: 700; font-family: inherit;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  color: #04140f;
  box-shadow: 0 4px 14px rgba(43,191,166,0.25), inset 0 1px 0 rgba(255,255,255,0.2);
  transition: opacity 0.12s, transform 0.1s;
  white-space: nowrap;
}

.char-threshold-save-btn:hover:not(:disabled) {
  box-shadow: 0 6px 20px rgba(43,191,166,0.35), inset 0 1px 0 rgba(255,255,255,0.2);
}

.char-threshold-save-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.char-threshold-save-btn:disabled {
  opacity: 0.4; cursor: not-allowed; box-shadow: none;
}

.char-threshold-save-btn.saved {
  background: rgba(70,236,207,0.08);
  color: #46eccf;
  border: 1px solid rgba(70,236,207,0.15);
  box-shadow: none;
  cursor: default;
}

.char-threshold-slider-labels {
  display: flex; justify-content: space-between;
  margin-top: 6px;
  font-size: 10px; color: rgba(255,255,255,0.12);
}

/* ── Loading / error / empty ────────────────────────────────────────── */

.char-loader {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 80px 20px;
  color: rgba(255,255,255,0.25);
  font-size: 14px;
}

.char-spinner {
  width: 24px; height: 24px;
  border: 2px solid rgba(139,92,246,0.1);
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: char-spin 0.7s linear infinite;
}

@keyframes char-spin {
  to { transform: rotate(360deg); }
}

.char-error {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,93,115,0.06);
  border: 1px solid rgba(255,93,115,0.12);
  padding: 10px 14px;
  border-radius: 10px;
  color: rgba(255,93,115,0.6);
  font-size: 13px;
  font-weight: 500;
}

.char-error button {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,93,115,0.15);
  background: transparent;
  color: rgba(255,93,115,0.5);
  cursor: pointer;
  font-size: 12px; font-family: inherit;
}

.char-error button:hover {
  background: rgba(255,93,115,0.08);
}

.char-not-found {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; text-align: center;
  padding: 80px 20px;
  color: rgba(255,255,255,0.3);
  font-size: 14px; line-height: 1.5;
}

.char-not-found-icon {
  font-size: 40px; line-height: 1;
  opacity: 0.4;
}

/* ── Toast ──────────────────────────────────────────────────────────── */

.char-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 100;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px; font-weight: 600;
  animation: char-pop-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  pointer-events: none;
}

.char-toast.success {
  background: rgba(70,236,207,0.1);
  color: #46eccf;
  border: 1px solid rgba(70,236,207,0.15);
}

.char-toast.error {
  background: rgba(255,93,115,0.1);
  color: #ff5d73;
  border: 1px solid rgba(255,93,115,0.15);
}

@keyframes char-pop-up {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 600px) {
  .char-hero-card {
    padding: 16px;
  }
  .char-hero-name {
    font-size: 18px;
  }
  .char-stats-grid {
    grid-template-columns: 1fr;
  }
  .char-threshold-controls {
    flex-wrap: wrap;
  }
  .char-threshold-save-btn {
    width: 100%; margin-top: 8px;
  }
  .char-threshold-value {
    min-width: 40px; font-size: 20px;
  }
}
`;
