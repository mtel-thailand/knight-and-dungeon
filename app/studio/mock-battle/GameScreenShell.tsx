// Portable game-screen shell — no mock-battle deps; intended to move to a
// shared/`/play` location later.
//
// A presentational, slot-based portrait frame (9:19.5). Full-bleed on phones;
// centered + letterboxed on desktop. Three stacked zones — top 30% / center
// 40% / bottom 30%. `top`/`bottom` are reserved HUD placeholders (rendered
// faintly, intentionally empty for now); `center` is the gameplay field and
// the visual focus. Styles are co-located in a <style> tag so the component
// carries over verbatim with no external CSS dependency.
import type { ReactNode } from "react";

type GameScreenShellProps = {
  top?: ReactNode;
  center: ReactNode;
  bottom?: ReactNode;
  className?: string;
};

export default function GameScreenShell({
  top,
  center,
  bottom,
  className,
}: GameScreenShellProps) {
  return (
    <div className={className ? `gss-root ${className}` : "gss-root"}>
      <style>{GSS_CSS}</style>
      <div className="gss-frame">
        <div className="gss-zone gss-zone-top">{top}</div>
        <div className="gss-center">
          <div className="gss-center-field">{center}</div>
        </div>
        <div className="gss-zone gss-zone-bottom">{bottom}</div>
      </div>
    </div>
  );
}

const GSS_CSS = `
.gss-root {
  position: absolute; inset: 0;
  container-type: size;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(120% 70% at 50% -8%, rgba(56,224,196,0.05), transparent 60%),
    radial-gradient(120% 70% at 50% 108%, rgba(255,93,115,0.05), transparent 60%),
    #06070b;
}
.gss-frame {
  position: relative;
  /* Fit a 9:19.5 portrait. Tiered fallback: vh -> svh -> container units. The
     container-query units size the frame to the shell's own box, so it fits
     whether the host is the full viewport (/play) or a smaller embed (e.g.
     under the studio menu bar) — ratio preserved, no overflow. */
  width: min(100vw, 100vh * 9 / 19.5);
  height: min(100vh, 100vw * 19.5 / 9);
  width: min(100vw, 100svh * 9 / 19.5);
  height: min(100svh, 100vw * 19.5 / 9);
  width: min(100cqw, 100cqh * 9 / 19.5);
  height: min(100cqh, 100cqw * 19.5 / 9);
  display: flex; flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background:
    radial-gradient(130% 46% at 50% 40%, rgba(38,58,76,0.20), transparent 72%),
    linear-gradient(180deg, #0c0f15, #0a0c12 52%, #0c0f15);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
}
/* Desktop / letterboxed: lift the frame off the backdrop. */
@media (min-aspect-ratio: 9 / 19.5) {
  .gss-frame {
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.05),
      0 30px 80px rgba(0,0,0,0.55);
  }
}

/* Reserved HUD zones — recessed, calm, intentionally empty (future HUD). */
.gss-zone {
  position: relative; flex: 0 0 30%; min-height: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.26), rgba(0,0,0,0.10));
}
.gss-zone-top {
  box-shadow: inset 0 -14px 26px -18px rgba(0,0,0,0.7);
  border-bottom: 1px solid rgba(255,255,255,0.035);
}
.gss-zone-bottom {
  box-shadow: inset 0 14px 26px -18px rgba(0,0,0,0.7);
  border-top: 1px solid rgba(255,255,255,0.035);
}
.gss-zone::after {
  content: ""; position: absolute; inset: 12px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.025); pointer-events: none;
}

/* Center — the combat field, the focal centerpiece. The inner field is a real,
   position:relative sized box so an absolutely-positioned child (e.g. a Pixi
   canvas host with inset:0) fills it and a renderer's resizeTo reads the band's
   true dimensions. Padding gives units/effects breathing room. */
.gss-center {
  position: relative; flex: 0 0 40%; min-height: 0;
  display: flex; box-sizing: border-box; padding: 12px;
}
.gss-center-field {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;
  border-radius: 14px; overflow: hidden;
  background: radial-gradient(78% 64% at 50% 50%, rgba(40,72,92,0.16), transparent 76%);
}
/* Soft vignette + faint inner ring framing the field, over the board edges. */
.gss-center-field::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: 14px;
  box-shadow:
    inset 0 0 42px 8px rgba(5,8,14,0.5),
    inset 0 0 0 1px rgba(120,200,230,0.07);
}
`;
