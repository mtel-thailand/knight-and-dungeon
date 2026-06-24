"use client";

// Self-contained sound-settings overlay for the battle game screen.
// A gear icon button (top-right) toggles a compact modal with BGM/SFX
// volume sliders and a master mute toggle. Changes apply live through
// the shared audio-settings store. Designed to be mounted as the last
// child inside .gss-frame (position:relative; see placement notes below).

import {
  useState,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "@/app/studio/audioSettings";

export default function SoundSettings({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  const settings = useSyncExternalStore(
    subscribeAudioSettings,
    getAudioSettings,
    getAudioSettings,
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  const bgmPct = Math.round(settings.bgmVolume * 100);
  const sfxPct = Math.round(settings.sfxVolume * 100);

  return (
    <div className={`ss-root${className ? " " + className : ""}`}>
      <style>{SS_CSS}</style>

      {/* Gear button — pinned top-right of .gss-frame */}
      <button className="ss-gear" onClick={toggle} aria-label="Sound settings">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Modal */}
      {open && (
        <>
          <div className="ss-scrim" onClick={close} />
          <div className="ss-modal" role="dialog" aria-label="Sound settings">
            <div className="ss-modal-head">
              <span className="ss-modal-title">Sound settings</span>
              <button className="ss-modal-close" onClick={close} aria-label="Close">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* BGM slider */}
            <div className="ss-row">
              <div className="ss-row-head">
                <span className="ss-label">BGM</span>
                <span className="ss-value">{bgmPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={bgmPct}
                onChange={(e) =>
                  setAudioSettings({ bgmVolume: Number(e.target.value) / 100 })
                }
                className="ss-slider"
              />
            </div>

            {/* SFX slider */}
            <div className="ss-row">
              <div className="ss-row-head">
                <span className="ss-label">SFX</span>
                <span className="ss-value">{sfxPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={sfxPct}
                onChange={(e) =>
                  setAudioSettings({ sfxVolume: Number(e.target.value) / 100 })
                }
                className="ss-slider"
              />
            </div>

            {/* Master Mute toggle */}
            <div className="ss-row">
              <div className="ss-row-head">
                <span className="ss-label">Master</span>
                <span className="ss-value">{settings.muted ? "Muted" : "Active"}</span>
              </div>
              <button
                className={`ss-toggle${settings.muted ? " on" : ""}`}
                onClick={() => setAudioSettings({ muted: !settings.muted })}
              >
                {settings.muted ? "Mute On" : "Mute Off"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const SS_CSS = `
/* ---- Root: overlays the entire .gss-frame (position:relative).
       pointer-events:none so clicks pass through to the game by
       default; only the gear, scrim, and modal are interactive. ---- */
.ss-root {
  position: absolute; inset: 0; z-index: 20;
  pointer-events: none;
}

/* ---- Gear button (top-right corner) ---- */
.ss-gear {
  position: absolute; top: 10px; right: 10px; z-index: 21;
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  pointer-events: auto;
  background: rgba(15,15,20,0.78); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 9px; color: rgba(255,255,255,0.6); cursor: pointer;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  outline: none; user-select: none;
  transition: color 0.14s, background 0.14s, border-color 0.14s, transform 0.14s;
}
.ss-gear:hover {
  color: #fff; background: rgba(35,35,45,0.92);
  border-color: rgba(255,255,255,0.25); transform: scale(1.05);
}
.ss-gear:active { transform: scale(0.95); }
.ss-gear svg { display: block; }

/* ---- Scrim ---- */
.ss-scrim {
  position: absolute; inset: 0; z-index: 22;
  pointer-events: auto;
  background: rgba(5,6,10,0.55);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  animation: ss-fade 0.18s ease both;
}

/* ---- Modal card ---- */
.ss-modal {
  position: absolute; top: 50%; left: 50%; z-index: 23;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  width: min(220px, 72cqw);
  box-sizing: border-box; padding: 18px 18px 14px;
  border-radius: 14px;
  background: rgba(16,17,24,0.94);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 16px 48px rgba(0,0,0,0.55);
  animation: ss-pop 0.22s cubic-bezier(0.2,0.9,0.3,1.25) both;
}

/* ---- Modal header ---- */
.ss-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.ss-modal-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255,255,255,0.4);
}
.ss-modal-close {
  background: none; border: none; cursor: pointer; padding: 2px;
  color: rgba(255,255,255,0.35); outline: none;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; transition: color 0.12s, background 0.12s;
}
.ss-modal-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
.ss-modal-close svg { display: block; }

/* ---- Slider rows ---- */
.ss-row { margin-bottom: 14px; }
.ss-row:last-of-type { margin-bottom: 0; }
.ss-row-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.ss-label {
  font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.02em;
}
.ss-value {
  font-size: 11px; color: rgba(255,255,255,0.78);
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono','Fira Code',monospace;
}

/* ---- Range slider (matches mb-ui-slider language) ---- */
.ss-slider {
  width: 100%; height: 4px; border-radius: 3px; outline: none; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.12);
  transition: background 0.12s;
}
.ss-slider:hover { background: rgba(255,255,255,0.18); }
.ss-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: #38e0c4; border: 2px solid #0a0a0f; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.ss-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: #38e0c4; border: 2px solid #0a0a0f; cursor: pointer;
}

/* ---- Mute toggle ---- */
.ss-toggle {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; line-height: 1;
  color: rgba(255,255,255,0.55); cursor: pointer; white-space: nowrap;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; padding: 6px 13px; outline: none; user-select: none;
  transition: background 0.14s, border-color 0.14s, color 0.14s, box-shadow 0.14s;
}
.ss-toggle:hover {
  color: #fff; background: rgba(255,255,255,0.09);
  border-color: rgba(255,255,255,0.3);
}
.ss-toggle.on {
  color: #04140f;
  background: linear-gradient(180deg, #46eccf, #2bbfa6);
  border-color: rgba(56,224,196,0.6);
  box-shadow: 0 2px 10px rgba(43,191,166,0.35);
}

/* ---- Animations ---- */
@keyframes ss-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes ss-pop {
  from { opacity: 0; transform: translate(-50%,-50%) scale(0.92); }
  to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
}
`;
