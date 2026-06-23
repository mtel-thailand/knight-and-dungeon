"use client";

// /studio/spells/[id] — EDIT page for one global spell.
// Loads the spell + the animation catalog from GET /api/config (spell found by
// the route id). A <canvas> preview plays the spell's animation, driven live by
// the playback config (FPS / Scale / Loop). Edits Name / Power / Cooldown / the
// playback config locally, then Save → POST /api/config/spell { spell }. The
// animation itself is set ONLY by uploading an MP4 ("Convert & assign" →
// /api/spell/animation, which returns the new catalog key; the catalog is then
// refreshed so the preview picks it up). The spell's `type` ("attack") is
// preserved as loaded. Missing id is handled.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { SpellDef } from "@/lib/battle/types";
import { SPELL_BOUNDS, DEFAULT_SPELL_FPS, DEFAULT_SPELL_DURATION } from "@/lib/battle/types";
import type { BootstrapPayload, CatalogEntry } from "../../studioTypes";
import { SPELLS_PAGE_CSS } from "../spellsStyles";

/** Parse an input value to a number, falling back when it isn't one. */
function numOr(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Linear interpolation between a and b at t∈[0,1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease-in-out (quadratic) — the same flight easing the battle projectile uses. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** One source rectangle inside the spritesheet PNG. */
type FrameRect = { x: number; y: number; w: number; h: number };
/** A spell's animation loaded and ready to play on the preview canvas. */
type LoadedSheet = { img: HTMLImageElement; frames: FrameRect[] };

export default function SpellEditPage() {
  const params = useParams<{ id: string }>();
  const routeId = params?.id ?? "";

  const [spell, setSpell] = useState<SpellDef | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // MP4 → animation conversion (local-dev only; needs ffmpeg server-side).
  const [file, setFile] = useState<File | null>(null);
  const [chroma, setChroma] = useState(true);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  // Animation catalog (from GET /api/config) + the spell's sheet loaded for preview.
  const [animations, setAnimations] = useState<CatalogEntry[]>([]);
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (!res.ok) throw new Error("config fetch failed");
        const data: BootstrapPayload = await res.json();
        if (cancelled) return;
        setAnimations(data.animations ?? []);
        const found = (data.spells ?? []).find((s) => s.id === routeId);
        if (found) setSpell({ ...found });
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  // Load the PNG + ordered frame rects for the spell's animation whenever the
  // catalog or the assigned animationKey changes. Frame order comes from the
  // sheet's `animations` map (first prefix) when present, else Object.keys(frames).
  useEffect(() => {
    const key = spell?.animationKey ?? "";
    const entry = key ? animations.find((a) => a.key === key) : undefined;
    if (!entry || !entry.image || !entry.frameData) {
      setSheet(null);
      return;
    }
    const fd = entry.frameData;
    const animMap = fd.animations;
    const firstKey = animMap ? Object.keys(animMap)[0] : undefined;
    const order: string[] =
      animMap && firstKey ? animMap[firstKey] : Object.keys(fd.frames);
    const frames: FrameRect[] = order
      .map((name) => fd.frames[name]?.frame)
      .filter((f): f is FrameRect => !!f)
      .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
    if (frames.length === 0) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setSheet({ img, frames });
    };
    img.onerror = () => {
      if (!cancelled) setSheet(null);
    };
    img.src = `/assets/${entry.image}`;
    return () => {
      cancelled = true;
    };
  }, [animations, spell?.animationKey]);

  // Demo the spell "in use": fly the projectile in a straight line across the
  // preview (caster → target), looping the flight, while cycling the sheet
  // frames at `fps` and aiming the sprite along the travel vector — mirroring
  // the battle's flyProjectile. `loop` governs the FRAMES (on → cycle while
  // flying; off → play once then hold the last frame); the flight itself always
  // repeats. Re-runs (and cancels its rAF) whenever the sheet or any knob
  // changes, so edits restart it cleanly.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !sheet || sheet.frames.length === 0) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const { img, frames } = sheet;
    const fps = clamp(spell?.fps ?? DEFAULT_SPELL_FPS, SPELL_BOUNDS.fps.min, SPELL_BOUNDS.fps.max);
    const scale = clamp(spell?.scale ?? 1, SPELL_BOUNDS.scale.min, SPELL_BOUNDS.scale.max);
    const loop = spell?.loop ?? true;
    // Flight knobs — re-clamped here like fps/scale (the form clamps on edit too).
    const duration = clamp(spell?.duration ?? DEFAULT_SPELL_DURATION, SPELL_BOUNDS.duration.min, SPELL_BOUNDS.duration.max);
    const offX = clamp(spell?.offsetX ?? 0, SPELL_BOUNDS.offsetX.min, SPELL_BOUNDS.offsetX.max);
    const offY = clamp(spell?.offsetY ?? 0, SPELL_BOUNDS.offsetY.min, SPELL_BOUNDS.offsetY.max);
    const rotDeg = clamp(spell?.rotation ?? 0, SPELL_BOUNDS.rotation.min, SPELL_BOUNDS.rotation.max);

    // Drawn footprint of the largest frame, plus a left→right, slightly rising
    // flight path so the aim rotation actually reads on screen.
    const spriteW = Math.max(...frames.map((f) => f.w)) * scale;
    const spriteH = Math.max(...frames.map((f) => f.h)) * scale;
    const travelX = Math.max(spriteW * 1.4, 190);
    const travelY = travelX * 0.26; // gentle diagonal rise (~14.5°)
    // Aim along the travel vector, plus the config's rotation offset (degrees).
    const theta = Math.atan2(-travelY, travelX) + (rotDeg * Math.PI) / 180;

    // Rotated-sprite half extents, so nothing clips at either end of the path.
    const cosT = Math.abs(Math.cos(theta));
    const sinT = Math.abs(Math.sin(theta));
    const halfW = (spriteW * cosT + spriteH * sinT) / 2;
    const halfH = (spriteW * sinT + spriteH * cosT) / 2;
    const pad = 10;
    // Shift the whole flight by the config offset. Canvas Y is down, so a positive
    // Offset Y reads as "up" (matches the studio) → subtract from y. Grow the canvas
    // by the shift and translate the start so negative shifts stay on-canvas (no clip).
    const shiftX = offX;
    const shiftY = -offY;
    const baseW = travelX + 2 * halfW + 2 * pad;
    const baseH = travelY + 2 * halfH + 2 * pad;
    const tx = Math.max(0, -shiftX);
    const ty = Math.max(0, -shiftY);
    cv.width = Math.max(1, Math.round(baseW + Math.abs(shiftX)));
    cv.height = Math.max(1, Math.round(baseH + Math.abs(shiftY)));

    // Caster (bottom-left) → target (top-right) centers, shifted by the offset.
    const ax = halfW + pad + tx + shiftX;
    const ay = baseH - halfH - pad + ty + shiftY;
    const bx = ax + travelX;
    const by = ay - travelY;

    const FLIGHT_MS = duration * 1000; // one pass — the spell's Flight (s), in ms
    const GAP_MS = 220; // brief pause (impact) before the flight repeats
    const cycle = FLIGHT_MS + GAP_MS;
    const frameInterval = 1000 / fps;

    let raf = 0;
    let stopped = false;
    const t0 = performance.now();

    // Faint trajectory + caster/target markers to convey the flight direction.
    const drawField = () => {
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(159,231,173,0.16)";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.22)"; // caster dot
      ctx.beginPath();
      ctx.arc(ax, ay, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(159,231,173,0.45)"; // target ring
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    // t: ms into the current pass (0..cycle). Projectile only shows while flying;
    // the gap leaves just the field, reading as a brief impact pause.
    const render = (t: number) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      drawField();
      if (t >= FLIGHT_MS) return; // gap between passes
      const e = easeInOutQuad(t / FLIGHT_MS);
      const cx = lerp(ax, bx, e);
      const cy = lerp(ay, by, e);
      const fi = loop
        ? Math.floor(t / frameInterval) % frames.length
        : Math.min(frames.length - 1, Math.floor(t / frameInterval));
      const f = frames[fi];
      const dw = f.w * scale;
      const dh = f.h * scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(theta);
      ctx.drawImage(img, f.x, f.y, f.w, f.h, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    };

    const tick = (now: number) => {
      if (stopped) return;
      render((now - t0) % cycle); // modulo → no backgrounded-tab spiral
      raf = requestAnimationFrame(tick);
    };

    render(0); // paint the first frame immediately (projectile at the caster)
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [
    sheet,
    spell?.fps,
    spell?.scale,
    spell?.loop,
    spell?.duration,
    spell?.offsetX,
    spell?.offsetY,
    spell?.rotation,
  ]);

  function update<K extends keyof SpellDef>(key: K, value: SpellDef[K]) {
    setSpell((prev) => (prev ? ({ ...prev, [key]: value } as SpellDef) : prev));
  }

  async function save() {
    if (!spell || saving) return;
    setSaving(true);
    try {
      await fetch("/api/config/spell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spell }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch {
      /* leave the form as-is so the user can retry */
    } finally {
      setSaving(false);
    }
  }

  // Upload an MP4 → the parallel /api/spell/animation route runs ffmpeg and
  // returns the new catalog key. We assign it, refresh the catalog so the
  // preview can resolve it, then persist the spell with the new animationKey.
  async function convertAndAssign() {
    if (!file || !spell || converting) return;
    setConverting(true);
    setConvertError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", spell.id); // reuse the spell id so re-uploads overwrite
      fd.append("chroma", String(chroma));
      const res = await fetch("/api/spell/animation", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `Conversion failed (${res.status}).`;
        try {
          const err = await res.json();
          if (err?.error) msg = String(err.error);
        } catch {
          /* non-JSON error body — keep the status message */
        }
        setConvertError(msg);
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        key?: string;
        label?: string;
        frames?: number;
      };
      if (!data?.ok || !data.key) {
        setConvertError("Conversion returned no animation.");
        return;
      }
      const next: SpellDef = { ...spell, animationKey: data.key };
      setSpell(next);
      // Refresh the catalog so the preview can resolve the freshly created
      // animation (its catalog entry didn't exist at page load).
      try {
        const cfg = await fetch("/api/config");
        if (cfg.ok) {
          const cd: BootstrapPayload = await cfg.json();
          setAnimations(cd.animations ?? []);
        }
      } catch {
        /* preview will resolve on the next full page load */
      }
      // Persist the spell with its freshly converted animation.
      await fetch("/api/config/spell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spell: next }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch {
      setConvertError("Could not reach the conversion service.");
    } finally {
      setConverting(false);
    }
  }

  const animKey = spell?.animationKey ?? "";
  const previewEntry = animKey
    ? animations.find((a) => a.key === animKey) ?? null
    : null;
  const canPreview = !!(previewEntry && previewEntry.image && previewEntry.frameData);
  const fps = spell?.fps ?? DEFAULT_SPELL_FPS;
  const scale = spell?.scale ?? 1;
  const loop = spell?.loop ?? true;
  const duration = spell?.duration ?? DEFAULT_SPELL_DURATION;
  const offsetX = spell?.offsetX ?? 0;
  const offsetY = spell?.offsetY ?? 0;
  const rotation = spell?.rotation ?? 0;

  return (
    <div className="spells-page">
      <style>{SPELLS_PAGE_CSS}</style>

      <nav className="menu-bar">
        <Link className="menu-bar-item" href="/studio">
          Studio
        </Link>
        <Link className="menu-bar-item" href="/studio/spells">
          Spells
        </Link>
      </nav>

      <div className="spells-wrap">
        <Link className="spell-back" href="/studio/spells">
          ← Back to spells
        </Link>

        {loading ? (
          <div className="spells-empty">Loading spell…</div>
        ) : notFound || !spell ? (
          <div className="spells-empty">
            <p>No spell found{routeId ? ` for “${routeId}”` : ""}.</p>
            <Link className="spell-btn primary" href="/studio/spells">
              Back to spells
            </Link>
          </div>
        ) : (
          <div className="spell-edit">
            <h1 className="spells-title">{spell.name || spell.id}</h1>

            <div className="spell-preview">
              <span className="spell-field-label">Preview</span>
              {canPreview ? (
                <>
                  <div className="spell-preview-stage">
                    <canvas ref={canvasRef} className="spell-preview-canvas" />
                  </div>
                  <div className="spell-preview-cap">{spell.animationKey}</div>
                </>
              ) : (
                <div className="spell-preview-empty">
                  (no animation — upload an MP4 to set one)
                </div>
              )}
            </div>

            <div className="spell-field">
              <span className="spell-field-label">Playback</span>
              <div className="spell-playback">
                <div className="spell-playback-grid">
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>FPS</span>
                      <span className="spell-slider-val">{fps}</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.fps.min}
                      max={SPELL_BOUNDS.fps.max}
                      step={1}
                      value={fps}
                      onChange={(e) =>
                        update(
                          "fps",
                          clamp(
                            numOr(e.target.value, DEFAULT_SPELL_FPS),
                            SPELL_BOUNDS.fps.min,
                            SPELL_BOUNDS.fps.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Scale</span>
                      <span className="spell-slider-val">{scale.toFixed(2)}×</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.scale.min}
                      max={SPELL_BOUNDS.scale.max}
                      step={0.05}
                      value={scale}
                      onChange={(e) =>
                        update(
                          "scale",
                          clamp(
                            numOr(e.target.value, 1),
                            SPELL_BOUNDS.scale.min,
                            SPELL_BOUNDS.scale.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Flight (s)</span>
                      <span className="spell-slider-val">{duration.toFixed(2)}s</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.duration.min}
                      max={SPELL_BOUNDS.duration.max}
                      step={0.01}
                      value={duration}
                      onChange={(e) =>
                        update(
                          "duration",
                          clamp(
                            numOr(e.target.value, DEFAULT_SPELL_DURATION),
                            SPELL_BOUNDS.duration.min,
                            SPELL_BOUNDS.duration.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Rotation°</span>
                      <span className="spell-slider-val">{rotation}°</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.rotation.min}
                      max={SPELL_BOUNDS.rotation.max}
                      step={1}
                      value={rotation}
                      onChange={(e) =>
                        update(
                          "rotation",
                          clamp(
                            numOr(e.target.value, 0),
                            SPELL_BOUNDS.rotation.min,
                            SPELL_BOUNDS.rotation.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Offset X</span>
                      <span className="spell-slider-val">{offsetX}px</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.offsetX.min}
                      max={SPELL_BOUNDS.offsetX.max}
                      step={1}
                      value={offsetX}
                      onChange={(e) =>
                        update(
                          "offsetX",
                          clamp(
                            numOr(e.target.value, 0),
                            SPELL_BOUNDS.offsetX.min,
                            SPELL_BOUNDS.offsetX.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Offset Y</span>
                      <span className="spell-slider-val">{offsetY}px</span>
                    </span>
                    <input
                      className="spell-range"
                      type="range"
                      min={SPELL_BOUNDS.offsetY.min}
                      max={SPELL_BOUNDS.offsetY.max}
                      step={1}
                      value={offsetY}
                      onChange={(e) =>
                        update(
                          "offsetY",
                          clamp(
                            numOr(e.target.value, 0),
                            SPELL_BOUNDS.offsetY.min,
                            SPELL_BOUNDS.offsetY.max,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <label className="spell-check">
                  <input
                    type="checkbox"
                    checked={loop}
                    onChange={(e) => update("loop", e.target.checked)}
                  />
                  <span>Loop animation</span>
                </label>
              </div>
            </div>

            <label className="spell-field">
              <span className="spell-field-label">Name</span>
              <input
                className="spell-input"
                value={spell.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>

            <div className="spell-upload">
              <span className="spell-field-label">Convert MP4 → animation</span>
              <div className="spell-upload-row">
                <label className="spell-file">
                  <input
                    className="spell-file-input"
                    type="file"
                    accept="video/mp4,video/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <span className="spell-file-text">
                    {file ? file.name : "Choose an MP4…"}
                  </span>
                </label>
                <button
                  className="spell-btn primary"
                  onClick={convertAndAssign}
                  disabled={!file || converting}
                >
                  {converting ? "Converting…" : "Convert & assign"}
                </button>
              </div>
              <label className="spell-check">
                <input
                  type="checkbox"
                  checked={chroma}
                  onChange={(e) => setChroma(e.target.checked)}
                />
                <span>Remove green background (chroma-key)</span>
              </label>
              {convertError && <p className="spell-error">{convertError}</p>}
              <p className="spell-hint">
                Conversion runs locally via ffmpeg — it won’t work on the deployed
                site.
              </p>
            </div>

            <label className="spell-field">
              <span className="spell-field-label">Power</span>
              <input
                className="spell-input"
                type="number"
                min={SPELL_BOUNDS.power.min}
                max={SPELL_BOUNDS.power.max}
                step={0.1}
                value={spell.power}
                onChange={(e) => update("power", numOr(e.target.value, spell.power))}
              />
            </label>

            <label className="spell-field">
              <span className="spell-field-label">Cooldown (seconds)</span>
              <input
                className="spell-input"
                type="number"
                min={SPELL_BOUNDS.cooldown.min}
                max={SPELL_BOUNDS.cooldown.max}
                step={0.5}
                value={spell.cooldown}
                onChange={(e) =>
                  update("cooldown", numOr(e.target.value, spell.cooldown))
                }
              />
            </label>

            <div className="spell-edit-actions">
              <button
                className={"spell-btn primary" + (saved ? " saved" : "")}
                onClick={save}
                disabled={saving}
              >
                {saved ? "Saved ✓" : saving ? "Saving…" : "Save spell"}
              </button>
              <Link className="spell-btn" href="/studio/spells">
                Done
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
