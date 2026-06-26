/* ------------------------------------------------------------------ *
 * Character Shop styles — dark fantasy, scoped under
 * .character-shop-page to coexist with other routes.
 * ------------------------------------------------------------------ */
export const CHAR_SHOP_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&display=swap');

/* ── Root ──────────────────────────────────────────────────────────── */

.character-shop-page {
  display: flex; flex-direction: column;
  width: 100vw; min-height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  color: #c8d6e5;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(96,165,250,0.06), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(34,211,238,0.05), transparent 60%),
    linear-gradient(180deg, #0a0b12 0%, #0d0e18 50%, #080911 100%);
  position: relative;
  overflow-x: hidden;
}

/* ── Scan line overlay ─────────────────────────────────────────────── */

.char-shop-scanlines {
  position: fixed; inset: 0;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
  pointer-events: none; z-index: 0;
}

/* ── Container ─────────────────────────────────────────────────────── */

.char-shop-container {
  position: relative; z-index: 1;
  width: 100%; max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  display: flex; flex-direction: column;
  gap: 24px;
}

/* ── Header bar ──────────────────────────────────────────────────── */

.char-shop-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-top: 8px;
}

.char-shop-brand {
  display: flex; align-items: center; gap: 12px;
}

.char-shop-brand-icon {
  font-size: 28px; line-height: 1;
  filter: drop-shadow(0 0 8px rgba(96,165,250,0.4));
}

.char-shop-brand-title {
  font-family: 'Cinzel', serif;
  font-size: 26px; font-weight: 700;
  color: #e8edf5; letter-spacing: 0.02em;
  margin: 0; line-height: 1.1;
}

.char-shop-brand-sub {
  font-size: 10px; color: #556688;
  text-transform: uppercase; letter-spacing: 0.18em;
  margin: 2px 0 0;
}

/* ── Divider ────────────────────────────────────────────────────────── */

.char-shop-divider {
  display: flex; align-items: center; gap: 12px;
}
.char-shop-divider-line {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(34,211,238,0.18), transparent);
}
.char-shop-divider-diamond {
  font-size: 8px; color: rgba(34,211,238,0.3);
}

/* ── Section titles ────────────────────────────────────────────────── */

.char-shop-section-title {
  font-family: 'Cinzel', serif;
  font-size: 14px; font-weight: 700;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin: 0;
}

/* ── Notice banner (hasLiving) ─────────────────────────────────────── */

.char-shop-notice {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  background: rgba(245,158,11,0.04);
  border: 1px solid rgba(245,158,11,0.1);
  border-radius: 10px;
  font-size: 12px; line-height: 1.5;
  color: rgba(255,255,255,0.35);
}

.char-shop-notice-icon {
  font-size: 14px; line-height: 1.3;
  flex-shrink: 0;
}

/* ── Catalog cards ─────────────────────────────────────────────────── */

.char-shop-catalog {
  display: flex; flex-direction: column;
  gap: 14px;
}

.char-shop-card {
  display: flex; align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 14px;
  background:
    radial-gradient(130% 80% at 50% 0%, rgba(96,165,250,0.06), transparent 58%),
    linear-gradient(180deg, rgba(20,24,36,0.96), rgba(12,14,22,0.96));
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  transition: border-color 0.15s, box-shadow 0.15s;
  position: relative;
  overflow: hidden;
}

.char-shop-card:hover {
  border-color: rgba(96,165,250,0.25);
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
}

.char-shop-card.owned {
  border-color: rgba(70,236,207,0.15);
}

.char-shop-card.owned::before {
  content: '';
  position: absolute; top: 0; right: 0;
  width: 60px; height: 60px;
  background: linear-gradient(135deg, transparent 50%, rgba(70,236,207,0.04) 50%);
  pointer-events: none;
}

.char-shop-card.fallen {
  border-color: rgba(255,93,115,0.12);
  opacity: 0.55;
}

.char-shop-card.fallen::before {
  content: '';
  position: absolute; top: 0; right: 0;
  width: 60px; height: 60px;
  background: linear-gradient(135deg, transparent 50%, rgba(255,93,115,0.04) 50%);
  pointer-events: none;
}

.char-shop-card-avatar {
  width: 52px; height: 52px;
  border-radius: 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; line-height: 1;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.char-shop-card:hover .char-shop-card-avatar {
  border-color: rgba(96,165,250,0.2);
}

.char-shop-card-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  gap: 2px;
}

.char-shop-card-name {
  font-family: 'Cinzel', serif;
  font-size: 18px; font-weight: 700;
  color: #e8edf5;
  line-height: 1.2;
}

.char-shop-card-id {
  font-size: 11px;
  color: rgba(255,255,255,0.15);
  line-height: 1.2;
  font-family: monospace;
}

.char-shop-card-status {
  font-size: 10px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 5px;
  line-height: 1.2;
  white-space: nowrap;
  flex-shrink: 0;
}

.char-shop-card.owned .char-shop-card-status {
  color: #46eccf;
  background: rgba(70,236,207,0.06);
  border: 1px solid rgba(70,236,207,0.1);
}

.char-shop-card.fallen .char-shop-card-status {
  color: rgba(255,93,115,0.5);
  background: rgba(255,93,115,0.06);
  border: 1px solid rgba(255,93,115,0.1);
}

.char-shop-card.free .char-shop-card-status {
  color: rgba(96,165,250,0.5);
  background: rgba(96,165,250,0.06);
  border: 1px solid rgba(96,165,250,0.1);
}

/* ── Claim / Reclaim button ─────────────────────────────────────────── */

.char-shop-claim-btn {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px; font-weight: 700; font-family: inherit;
  transition: opacity 0.12s, transform 0.1s, box-shadow 0.12s;
  white-space: nowrap;
  flex-shrink: 0;
}

.char-shop-claim-btn.can-claim {
  background: linear-gradient(180deg, #3b82f6, #2563eb);
  color: #fff;
  box-shadow: 0 4px 14px rgba(59,130,246,0.3), inset 0 1px 0 rgba(255,255,255,0.12);
}

.char-shop-claim-btn.can-claim:hover {
  box-shadow: 0 6px 20px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.12);
}

.char-shop-claim-btn.can-claim:active {
  transform: scale(0.97);
}

.char-shop-claim-btn.owned-btn {
  background: rgba(70,236,207,0.06);
  color: #46eccf;
  border: 1px solid rgba(70,236,207,0.15);
  cursor: default;
  font-weight: 600;
}

.char-shop-claim-btn.disabled {
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.06);
  cursor: not-allowed;
  pointer-events: none;
}

.char-shop-claim-btn.busy {
  background: rgba(96,165,250,0.12);
  color: rgba(255,255,255,0.5);
  border: 1px solid rgba(96,165,250,0.2);
  cursor: wait;
  pointer-events: none;
}

/* ── Loading / error / empty ────────────────────────────────────────── */

.char-shop-loader {
  display: flex; align-items: center; justify-content: center;
  gap: 10px; padding: 80px 20px;
  color: rgba(255,255,255,0.25);
  font-size: 14px;
}

.char-shop-spinner {
  width: 24px; height: 24px;
  border: 2px solid rgba(96,165,250,0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: char-shop-spin 0.7s linear infinite;
}

@keyframes char-shop-spin {
  to { transform: rotate(360deg); }
}

.char-shop-error {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,93,115,0.06);
  border: 1px solid rgba(255,93,115,0.12);
  padding: 10px 14px;
  border-radius: 10px;
  color: rgba(255,93,115,0.6);
  font-size: 13px;
  font-weight: 500;
}

.char-shop-error button {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255,93,115,0.15);
  background: transparent;
  color: rgba(255,93,115,0.5);
  cursor: pointer;
  font-size: 12px; font-family: inherit;
}
.char-shop-error button:hover {
  background: rgba(255,93,115,0.08);
}

.char-shop-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; text-align: center;
  padding: 60px 20px;
  color: rgba(255,255,255,0.3);
  font-size: 14px; line-height: 1.5;
}

.char-shop-empty-icon {
  font-size: 40px; line-height: 1;
  opacity: 0.4;
}

/* ── Back link ──────────────────────────────────────────────────────── */

.char-shop-back-link {
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
.char-shop-back-link:hover {
  color: #c8d6e5;
  background: rgba(255,255,255,0.05);
}

/* ── Toast ──────────────────────────────────────────────────────────── */

.char-shop-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 100;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px; font-weight: 600;
  animation: char-shop-pop-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  pointer-events: none;
}

.char-shop-toast.success {
  background: rgba(70,236,207,0.1);
  color: #46eccf;
  border: 1px solid rgba(70,236,207,0.15);
}

.char-shop-toast.error {
  background: rgba(255,93,115,0.1);
  color: #ff5d73;
  border: 1px solid rgba(255,93,115,0.15);
}

@keyframes char-shop-pop-up {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Corner vignettes ───────────────────────────────────────────────── */

.char-shop-vignette-top {
  position: fixed; top: 0; left: 0; right: 0; height: 12vh;
  background: linear-gradient(to bottom, rgba(8,11,18,0.5) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

.char-shop-vignette-bottom {
  position: fixed; bottom: 0; left: 0; right: 0; height: 16vh;
  background: linear-gradient(to top, rgba(8,11,18,0.7) 0%, transparent 100%);
  pointer-events: none; z-index: 0;
}

/* ── Intro text ─────────────────────────────────────────────────────── */

.char-shop-intro {
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255,255,255,0.35);
  padding: 0 2px;
  margin: 0;
}

.char-shop-intro strong {
  color: rgba(255,255,255,0.55);
  font-weight: 600;
}

/* ── Responsive ─────────────────────────────────────────────────────── */

@media (max-width: 600px) {
  .char-shop-header {
    flex-direction: column; gap: 12px;
  }
  .char-shop-brand-title {
    font-size: 22px;
  }
  .char-shop-card {
    flex-wrap: wrap;
  }
  .char-shop-card-avatar {
    width: 44px; height: 44px; font-size: 22px;
  }
  .char-shop-card-name {
    font-size: 16px;
  }
  .char-shop-claim-btn {
    width: 100%; margin-top: 4px;
  }
}
`;
