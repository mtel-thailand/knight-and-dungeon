/* ------------------------------------------------------------------ *
 * Spell Shop styles — dark fantasy, game-feel. Scoped under
 * .spell-shop-page to coexist with other routes.
 * ------------------------------------------------------------------ */
export const SHOP_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&display=swap');

/* ── Root ──────────────────────────────────────────────────────────── */

.spell-shop-page {
  display: flex; flex-direction: column;
  width: 100vw; min-height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  color: #c8d6e5;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(59,130,246,0.07), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(139,92,246,0.06), transparent 60%),
    linear-gradient(180deg, #0a0b12 0%, #0d0e18 50%, #080911 100%);
  position: relative;
  overflow-x: hidden;
}

/* ── Scan line overlay ─────────────────────────────────────────────── */

.shop-scanlines {
  position: fixed; inset: 0;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
  pointer-events: none; z-index: 0;
}

/* ── Container ─────────────────────────────────────────────────────── */

.shop-container {
  position: relative; z-index: 1;
  width: 100%; max-width: 880px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  display: flex; flex-direction: column;
  gap: 24px;
}

/* ── Header bar ──────────────────────────────────────────────────── */

.shop-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-top: 8px;
}

.shop-brand {
  display: flex; align-items: center; gap: 12px;
}

.shop-brand-icon {
  font-size: 28px; line-height: 1;
  filter: drop-shadow(0 0 8px rgba(139,92,246,0.4));
}

.shop-brand-title {
  font-family: 'Cinzel', serif;
  font-size: 26px; font-weight: 700;
  color: #e8edf5; letter-spacing: 0.02em;
  margin: 0; line-height: 1.1;
}

.shop-brand-sub {
  font-size: 10px; color: #556688;
  text-transform: uppercase; letter-spacing: 0.18em;
  margin: 2px 0 0;
}

/* ── Wallet display ────────────────────────────────────────────────── */

.shop-wallet {
  display: flex; align-items: center; gap: 8px;
  background: rgba(139,92,246,0.07);
  border: 1px solid rgba(139,92,246,0.15);
  border-radius: 12px;
  padding: 10px 16px;
  flex-shrink: 0;
}

.shop-wallet-icon {
  font-size: 18px; line-height: 1;
}

.shop-wallet-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(139,92,246,0.5);
}

.shop-wallet-value {
  font-family: 'Cinzel', serif;
  font-size: 22px; font-weight: 900;
  color: #d4baff;
  line-height: 1;
  letter-spacing: 0.01em;
}

/* ── Divider ────────────────────────────────────────────────────────── */

.shop-divider {
  display: flex; align-items: center; gap: 12px;
}
.shop-divider-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(139,92,246,0.2), transparent);
}
.shop-divider-diamond {
  font-size: 8px; color: rgba(139,92,246,0.35);
}

/* ── Section titles ────────────────────────────────────────────────── */

.shop-section-title {
  font-family: 'Cinzel', serif;
  font-size: 14px; font-weight: 700;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 0;
}

/* ── Character roster ──────────────────────────────────────────────── */

.shop-char-roster {
  display: flex; gap: 10px; flex-wrap: wrap;
}

.shop-char-card {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px;
  padding: 12px 18px;
  border-radius: 12px;
  cursor: pointer;
  background: rgba(255,255,255,0.03);
  border: 2px solid rgba(255,255,255,0.08);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  min-width: 80px;
  text-align: center;
  font-family: inherit;
  color: #c8d6e5;
  outline: none;
}

.shop-char-card:hover:not(.dead) {
  border-color: rgba(139,92,246,0.35);
  background: rgba(139,92,246,0.06);
}

.shop-char-card.selected {
  border-color: #8b5cf6;
  background: rgba(139,92,246,0.1);
  box-shadow: 0 0 14px rgba(139,92,246,0.2);
}

.shop-char-card.dead {
  opacity: 0.4;
  cursor: not-allowed;
  border-style: dashed;
}

.shop-char-avatar {
  font-size: 28px; line-height: 1;
}

.shop-char-name {
  font-size: 12px; font-weight: 600;
  line-height: 1.2;
}

.shop-char-name.fallen {
  color: rgba(255,93,115,0.5);
}

.shop-char-lv {
  font-size: 10px; color: #556677;
}

.shop-char-dead-tag {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255,93,115,0.5);
  background: rgba(255,93,115,0.06);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255,93,115,0.12);
}

/* ── Spell grid ─────────────────────────────────────────────────────── */

.shop-spell-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 12px;
}

.shop-spell-card {
  display: flex; flex-direction: column;
  padding: 16px;
  border-radius: 14px;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(139,92,246,0.08), transparent 58%),
    linear-gradient(180deg, rgba(20,24,36,0.96), rgba(12,14,22,0.96));
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
  position: relative;
  overflow: hidden;
}

.shop-spell-card:hover {
  border-color: rgba(139,92,246,0.25);
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  transform: translateY(-1px);
}

.shop-spell-card.owned {
  border-color: rgba(70,236,207,0.2);
}

.shop-spell-card.owned::before {
  content: '';
  position: absolute; top: 0; right: 0;
  width: 48px; height: 48px;
  background: linear-gradient(135deg, transparent 50%, rgba(70,236,207,0.06) 50%);
  pointer-events: none;
}

.shop-spell-icon {
  font-size: 26px; line-height: 1;
  margin-bottom: 8px;
}

.shop-spell-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}

.shop-spell-name {
  font-family: 'Cinzel', serif;
  font-size: 16px; font-weight: 700;
  color: #e8edf5;
  line-height: 1.2;
}

.shop-spell-type {
  font-size: 9px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.04);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.06);
}

.shop-spell-power {
  font-size: 12px; color: rgba(255,255,255,0.45);
  margin-bottom: 4px;
  line-height: 1.4;
}

.shop-spell-detail {
  display: flex; gap: 10px; flex-wrap: wrap;
  margin-bottom: 14px;
}

.shop-spell-price {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px; font-weight: 700;
  color: #d4baff;
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.12);
}

.shop-spell-mana {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px; font-weight: 700;
  color: #60a5fa;
  background: rgba(96,165,250,0.08);
  border: 1px solid rgba(96,165,250,0.12);
}

.shop-spell-cooldown {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px; font-weight: 700;
  color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
}

/* ── Buy button ─────────────────────────────────────────────────────── */

.shop-buy-btn {
  width: 100%;
  padding: 10px 0;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 13px; font-weight: 700; font-family: inherit;
  transition: opacity 0.12s, transform 0.1s;
  margin-top: auto;
  text-align: center;
}

.shop-buy-btn.can-buy {
  background: linear-gradient(180deg, #8b5cf6, #7c3aed);
  color: #fff;
  box-shadow: 0 4px 14px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.12);
}
.shop-buy-btn.can-buy:hover {
  box-shadow: 0 6px 20px rgba(139,92,246,0.4), inset 0 1px 0 rgba(255,255,255,0.12);
}
.shop-buy-btn.can-buy:active {
  transform: scale(0.98);
}

.shop-buy-btn.owned-btn {
  background: rgba(70,236,207,0.06);
  color: #38e0c4;
  border: 1px solid rgba(70,236,207,0.15);
  cursor: default;
  font-weight: 600;
}

.shop-buy-btn.insufficient {
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.06);
  cursor: not-allowed;
}

.shop-buy-btn.buying {
  background: rgba(139,92,246,0.12);
  color: rgba(255,255,255,0.5);
  border: 1px solid rgba(139,92,246,0.2);
  cursor: wait;
  pointer-events: none;
}

/* ── Empty / state messages ─────────────────────────────────────────── */

.shop-empty-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; text-align: center;
  padding: 60px 20px;
  color: rgba(255,255,255,0.3);
  font-size: 14px; line-height: 1.5;
}

.shop-empty-icon {
  font-size: 40px; line-height: 1;
  opacity: 0.4;
}

/* ── Error message ──────────────────────────────────────────────────── */

.shop-error {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,93,115,0.06);
  border: 1px solid rgba(255,93,115,0.12);
  padding: 10px 14px;
  border-radius: 10px;
  color: rgba(255,93,115,0.6);
  font-size: 13px;
  font-weight: 500;
}

.shop-error button {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,93,115,0.15);
  background: transparent;
  color: rgba(255,93,115,0.5);
  cursor: pointer;
  font-size: 12px; font-family: inherit;
}
.shop-error button:hover {
  background: rgba(255,93,115,0.08);
}

/* ── Forfeit warning ────────────────────────────────────────────────── */

.shop-forfeit-warn {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  background: rgba(245,158,11,0.04);
  border: 1px solid rgba(245,158,11,0.1);
  border-radius: 10px;
  font-size: 12px; line-height: 1.5;
  color: rgba(255,255,255,0.35);
}

.shop-forfeit-warn-icon {
  font-size: 14px; line-height: 1.3;
  flex-shrink: 0;
}

/* ── Loading ────────────────────────────────────────────────────────── */

.shop-loader {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 60px 20px;
  color: rgba(255,255,255,0.25);
  font-size: 14px;
}

.shop-spinner {
  width: 24px; height: 24px;
  border: 2px solid rgba(139,92,246,0.1);
  border-top-color: #8b5cf6;
  border-radius: 50%;
  animation: shop-spin 0.7s linear infinite;
}

@keyframes shop-spin {
  to { transform: rotate(360deg); }
}

/* ── Back link ──────────────────────────────────────────────────────── */

.shop-back-link {
  display: inline-flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,0.3);
  font-size: 13px; font-weight: 600; text-decoration: none;
  padding: 6px 12px; border-radius: 8px;
  transition: color 0.12s, background 0.12s;
  width: fit-content;
  border: none; background: transparent; cursor: pointer;
  font-family: inherit;
  margin-left: -6px;
}
.shop-back-link:hover {
  color: #c8d6e5;
  background: rgba(255,255,255,0.05);
}

/* ── Toast (purchase feedback) ──────────────────────────────────────── */

.shop-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 100;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px; font-weight: 600;
  animation: shop-pop-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  pointer-events: none;
}

.shop-toast.success {
  background: rgba(70,236,207,0.1);
  color: #46eccf;
  border: 1px solid rgba(70,236,207,0.15);
}

.shop-toast.error {
  background: rgba(255,93,115,0.1);
  color: #ff5d73;
  border: 1px solid rgba(255,93,115,0.15);
}

@keyframes shop-pop-up {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Corner vignettes ───────────────────────────────────────────────── */

.shop-vignette-top {
  position: fixed; top: 0; left: 0; right: 0; height: 12vh;
  background: linear-gradient(to bottom, rgba(8,11,18,0.5) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

.shop-vignette-bottom {
  position: fixed; bottom: 0; left: 0; right: 0; height: 16vh;
  background: linear-gradient(to top, rgba(8,11,18,0.7) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 600px) {
  .shop-header {
    flex-direction: column; gap: 12px;
  }
  .shop-wallet {
    align-self: stretch; justify-content: center;
  }
  .shop-brand-title {
    font-size: 22px;
  }
  .shop-spell-grid {
    grid-template-columns: 1fr;
  }
  .shop-char-card {
    min-width: 64px; padding: 10px 12px;
  }
}
`;
