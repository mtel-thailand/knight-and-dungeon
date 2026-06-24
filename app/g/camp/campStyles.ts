/* ------------------------------------------------------------------ *
 * Camp page styles — minimal/functional for P4/P5; designer polishes
 * in P6. Scoped under .camp-page to coexist with other routes.
 * ------------------------------------------------------------------ */
export const CAMP_PAGE_CSS = `
.camp-page {
  display: flex; flex-direction: column;
  width: 100vw; height: 100vh;
  font-family: system-ui, sans-serif; color: #e8e8f0;
  background:
    radial-gradient(1200px 700px at 50% -10%, rgba(56,224,196,0.06), transparent 60%),
    radial-gradient(1000px 600px at 50% 110%, rgba(255,93,115,0.06), transparent 60%),
    #0a0a0f;
}

.camp-body {
  flex: 1; position: relative; overflow: hidden;
}

/* Center message (loading, error, result) */
.camp-center-msg {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; gap: 10px;
  color: rgba(255,255,255,0.5); font-size: 15px; line-height: 1.6; padding: 0 24px;
}
.camp-center-msg a { color: #38e0c4; }
.camp-center-msg h1 { font-size: 22px; font-weight: 700; margin: 0; color: #e8e8f0; }

/* Idle screen — campaign title + start button */
.camp-idle { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.camp-idle h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
.camp-idle p { font-size: 13px; color: rgba(255,255,255,0.5); margin: 0; }
.camp-start-btn {
  padding: 14px 36px; border-radius: 12px; cursor: pointer;
  font-size: 15px; font-weight: 700; letter-spacing: 0.02em; color: #04140f;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border: 1px solid rgba(56,224,196,0.6);
  box-shadow: 0 8px 24px rgba(43,191,166,0.28);
  transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
}
.camp-start-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(43,191,166,0.4); }
.camp-start-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }

/* Guard message */
.camp-guard { text-align: center; max-width: 360px; }
.camp-guard .icon { font-size: 32px; margin-bottom: 4px; }

/* HUD overlay during fight */
.camp-hud {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 6; pointer-events: none;
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
  color: rgba(255,255,255,0.55);
  background: rgba(10,12,18,0.7); padding: 5px 14px; border-radius: 20px;
  backdrop-filter: blur(8px);
}

/* Result screen (won/lost) */
.camp-result-scrim {
  position: absolute; inset: 0; z-index: 10;
  display: flex; align-items: center; justify-content: center;
  background: rgba(5,6,10,0.55); backdrop-filter: blur(4px);
  animation: camp-fade 0.25s ease both;
}
.camp-result-card {
  text-align: center; padding: 34px 44px; border-radius: 18px;
  background: rgba(16,17,24,0.92); border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5);
  animation: camp-pop 0.32s cubic-bezier(0.2,0.9,0.3,1.3) both;
}
.camp-result-title { font-size: 40px; font-weight: 800; letter-spacing: 0.01em; margin-bottom: 6px; }
.camp-result-card.won .camp-result-title { color: #57e08a; text-shadow: 0 0 30px rgba(87,224,138,0.4); }
.camp-result-card.lost .camp-result-title { color: #ff5d73; text-shadow: 0 0 30px rgba(255,93,115,0.4); }
.camp-result-sub { font-size: 13px; color: rgba(255,255,255,0.55); margin-bottom: 22px; }
.camp-btn {
  padding: 11px 20px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 600;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #e8e8f0;
  transition: background 0.12s, border-color 0.12s;
}
.camp-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); }
.camp-btn.primary { background: linear-gradient(180deg, #46eccf, #2bbfa6); color: #04140f; border-color: rgba(56,224,196,0.6); }
.camp-btn.primary:hover { box-shadow: 0 6px 18px rgba(43,191,166,0.35); }

@keyframes camp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes camp-pop { from { opacity: 0; transform: scale(0.92) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
`;
