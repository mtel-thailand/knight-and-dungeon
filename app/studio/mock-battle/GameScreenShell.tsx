"use client";

// Portable game-screen shell — no mock-battle deps; intended to move to a
// shared/`/play` location later.
//
// A presentational, slot-based portrait frame (9:19.5). Full-bleed on phones;
// centered + letterboxed on desktop. Three stacked zones — a square (1:1)
// `center` field (sized by aspect-ratio at full frame width), with the
// top/bottom HUD bands splitting the remaining height equally (≈27% each at
// this frame ratio). `top`/`bottom` are reserved HUD placeholders (rendered
// faintly, intentionally empty for now); `center` is the gameplay field and
// the visual focus. Styles are co-located in a <style> tag so the component
// carries over verbatim with no external CSS dependency.
import { type ReactNode, useEffect, useRef } from "react";
import { effectiveBgmVolume, subscribeAudioSettings } from "@/app/studio/audioSettings";
import SoundSettings from "./SoundSettings";

type GameScreenShellProps = {
  top?: ReactNode;
  center: ReactNode;
  /** Optional still-image backdrop for the (square) center field; also the video poster/fallback. */
  centerBg?: string;
  /** Optional looping video backdrop (plays over `centerBg`); muted + playsInline for mobile autoplay. */
  centerVideo?: string;
  /** Optional looping background-music track (path under /assets). Plays with sound after the
   *  user gesture that mounts the screen; volume is dialed back so per-action SFX sit on top. */
  bgm?: string;
  bottom?: ReactNode;
  className?: string;
};

export default function GameScreenShell({
  top,
  center,
  centerBg,
  centerVideo,
  bgm,
  bottom,
  className,
}: GameScreenShellProps) {
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  // Drive the BGM element's volume from the shared audio-settings store (default
  // 20%) and keep it live: re-apply on every settings change and resume playback
  // in case autoplay needed the prior user gesture.
  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    const apply = () => {
      el.volume = effectiveBgmVolume();
    };
    apply();
    void el.play().catch(() => {});
    return subscribeAudioSettings(apply);
  }, [bgm]);
  return (
    <div className={className ? `gss-root ${className}` : "gss-root"}>
      <style>{GSS_CSS}</style>
      <div className="gss-frame">
        <div className="gss-zone gss-zone-top">{top}</div>
        <div className="gss-center">
          {/* Center field, layered back-to-front: still image (CSS bg) ->
              looping video -> scrim -> gameplay (`center`) -> edge vignette
              (::after). `centerBg` doubles as the video poster/fallback, so the
              shell stays asset-agnostic and degrades gracefully; when neither bg
              is set the stylesheet's radial-gradient shows through. */}
          <div
            className="gss-center-field"
            style={
              centerBg
                ? {
                    backgroundImage: `url("${centerBg}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }
                : undefined
            }
          >
            {centerVideo ? (
              <video
                className="gss-center-video"
                src={centerVideo}
                poster={centerBg}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                ref={(el) => {
                  if (el) el.muted = true; // ensure muted before autoplay (React attr quirk)
                }}
              />
            ) : null}
            {bgm ? (
              <audio ref={bgmRef} src={bgm} autoPlay loop preload="auto" />
            ) : null}
            {centerBg || centerVideo ? <div className="gss-center-scrim" /> : null}
            <div className="gss-center-content">{center}</div>
          </div>
        </div>
        <div className="gss-zone gss-zone-bottom">{bottom}</div>
        <SoundSettings />
      </div>
    </div>
  );
}

export const GSS_CSS = `
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
  border-radius: 0;
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
  position: relative; flex: 1 1 0; min-height: 0;
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
/* (zone inset frame removed — full-bleed sections, square corners) */

/* Center — the combat field, the focal centerpiece. The inner field is a real,
   position:relative sized box so an absolutely-positioned child (e.g. a Pixi
   canvas host with inset:0) fills it and a renderer's resizeTo reads the band's
   true dimensions. Padding gives units/effects breathing room. */
.gss-center {
  position: relative; flex: 0 0 auto; aspect-ratio: 1 / 1; min-height: 0;
  display: flex; box-sizing: border-box; padding: 0;
}
.gss-center-field {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;
  border-radius: 0; overflow: hidden; isolation: isolate;
  background: radial-gradient(78% 64% at 50% 50%, rgba(40,72,92,0.16), transparent 76%);
}
/* Center-field layers (back -> front): looping video, scrim, gameplay content.
   The field's CSS background (still image / radial) sits behind all of these. */
.gss-center-video {
  position: absolute; inset: 0; z-index: 0;
  width: 100%; height: 100%; object-fit: cover; object-position: center;
  pointer-events: none;
}
.gss-center-scrim {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg, rgba(5,7,13,0.20), rgba(5,7,13,0.40));
}
.gss-center-content { position: absolute; inset: 0; z-index: 2; }
/* Soft vignette + faint inner ring framing the field, over the board edges. */
.gss-center-field::after {
  content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; border-radius: 0;
  box-shadow:
    inset 0 0 42px 8px rgba(5,8,14,0.5),
    inset 0 0 0 1px rgba(120,200,230,0.07);
}
`;
