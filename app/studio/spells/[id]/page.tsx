"use client";

// /studio/spells/[id] — EDIT page for one global spell.
// Loads the spell + the animation catalog from GET /api/config (spell found by
// the route id). A <canvas> preview plays the spell's animation on a mock-
// battle-like hex board, driven live by the playback config (FPS / Scale X /
// Scale Y / Loop). Edits Name / Power / Cooldown / the
// playback config locally, then Save → POST /api/config/spell { spell }. The
// animation itself is set ONLY by uploading an MP4 ("Convert & assign" →
// /api/spell/animation, which returns the new catalog key; the catalog is then
// refreshed so the preview picks it up). The spell's `type` ("attack") is
// preserved as loaded. Missing id is handled.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { MapConfig, SpellDef, SpellTransition } from "@/lib/battle/types";
import {
  BOARD,
  DEFAULT_MAP_CONFIG as DEFAULT_MAP,
  SPELL_BOUNDS,
  DEFAULT_SPELL_FPS,
  DEFAULT_SPELL_DURATION,
  SPELL_FADE_MS,
  DEFAULT_SPELL_TRANSITION,
  SPELL_TRANSITIONS,
} from "@/lib/battle/types";
import { getHexRowsFromCounts, isoHex, isoPos } from "../../studioHelpers";
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

/** Coerce to a finite number, falling back on NaN/±Infinity/missing. Unlike `??`,
 *  this also rejects NaN — a NaN knob (e.g. a bad persisted value) would otherwise
 *  poison the flight cycle and produce a NaN frame index. */
function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
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

const PREVIEW_ROWS = getHexRowsFromCounts([...BOARD.rowCounts]);
const PREVIEW_HEXES = PREVIEW_ROWS.flatMap((cols, ri) => {
  const r = ri - (PREVIEW_ROWS.length - 1) / 2;
  return cols.map((q) => ({ q, r }));
});
const BOARD_REF_SIDE = 640;
const BOTTOM_INSET = 8;

function transformPoint(
  x: number,
  y: number,
  rotRad: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const c = Math.cos(rotRad);
  const s = Math.sin(rotRad);
  return {
    x: (x * c - y * s) * sx,
    y: (x * s + y * c) * sy,
  };
}

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
  const [mapConfig, setMapConfig] = useState<MapConfig>(() => ({ ...DEFAULT_MAP }));
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [previewSide, setPreviewSide] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
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
        setMapConfig({ ...DEFAULT_MAP, ...(data.mapConfig ?? {}) });
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

  const animKey = spell?.animationKey ?? "";
  const previewEntry = animKey
    ? animations.find((a) => a.key === animKey) ?? null
    : null;
  const canPreview = !!(previewEntry && previewEntry.image && previewEntry.frameData);

  // Demo the spell on the full mock-battle-like [5,6,7,6,5] board; the spell
  // sweeps across the wide middle row while the board uses the same iso
  // geometry + view transform as the battle board.
  // `loop` still governs only the FRAMES (on → cycle while flying; off → play
  // once then hold the last frame); the flight itself always repeats. Re-runs
  // (and cancels the rAF) whenever the sheet, knobs, field size, or map config
  // changes.
  useEffect(() => {
    if (!canPreview) {
      setPreviewSide(0);
      return;
    }
    const el = stageRef.current;
    if (!el) return;

    let raf = 0;
    const sync = () => {
      const next = Math.max(0, Math.round(el.getBoundingClientRect().width));
      setPreviewSide((prev) => (prev === next ? prev : next));
    };

    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [canPreview]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !sheet || sheet.frames.length === 0 || previewSide <= 0) return;

    const { img, frames } = sheet;
    // finiteOr (not ??) so a NaN/±Infinity persisted value can't leak through and
    // poison the flight cycle (NaN cycle → NaN `t` → NaN frame index → crash).
    const fps = clamp(
      finiteOr(spell?.fps, DEFAULT_SPELL_FPS),
      SPELL_BOUNDS.fps.min,
      SPELL_BOUNDS.fps.max,
    );
    const scaleX = clamp(
      finiteOr(spell?.scaleX, 1),
      SPELL_BOUNDS.scaleX.min,
      SPELL_BOUNDS.scaleX.max,
    );
    const scaleY = clamp(
      finiteOr(spell?.scaleY, 1),
      SPELL_BOUNDS.scaleY.min,
      SPELL_BOUNDS.scaleY.max,
    );
    const loop = spell?.loop ?? true;
    // Flight knobs — re-clamped here like fps/scaleX/scaleY (the form clamps on edit too).
    const duration = clamp(
      finiteOr(spell?.duration, DEFAULT_SPELL_DURATION),
      SPELL_BOUNDS.duration.min,
      SPELL_BOUNDS.duration.max,
    );
    const offX = clamp(
      finiteOr(spell?.offsetX, 0),
      SPELL_BOUNDS.offsetX.min,
      SPELL_BOUNDS.offsetX.max,
    );
    const offY = clamp(
      finiteOr(spell?.offsetY, 0),
      SPELL_BOUNDS.offsetY.min,
      SPELL_BOUNDS.offsetY.max,
    );
    const rotDeg = clamp(
      finiteOr(spell?.rotation, 0),
      SPELL_BOUNDS.rotation.min,
      SPELL_BOUNDS.rotation.max,
    );

    const map = mapConfig ?? DEFAULT_MAP;
    const tileW = map.tileWidth;
    const tileH = tileW * map.tileHeightRatio;
    const boardScale = map.scale;
    const rotRad = (map.rotation * Math.PI) / 180;
    const rotXRad = (map.rotationX * Math.PI) / 180;
    const rotYRad = (map.rotationY * Math.PI) / 180;
    const fitScale = previewSide / BOARD_REF_SIDE;
    const viewScaleX = boardScale * fitScale * Math.cos(rotYRad);
    const viewScaleY = boardScale * fitScale * Math.cos(rotXRad);
    const rotOffRad = (rotDeg * Math.PI) / 180;

    const hexes = PREVIEW_HEXES;
    const hw = tileW / 2;
    const hh = tileH / 2;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const h of hexes) {
      const p = isoPos(h.q, h.r, tileW, tileH);
      minX = Math.min(minX, p.x - hw);
      maxX = Math.max(maxX, p.x + hw);
      minY = Math.min(minY, p.y - hh);
      maxY = Math.max(maxY, p.y + hh);
    }
    const pivotX = (minX + maxX) / 2;
    const pivotY = (minY + maxY) / 2;
    const halfW = (maxX - minX) / 2;
    const halfH = (maxY - minY) / 2;
    const bottomDrop =
      (Math.abs(halfW * Math.sin(rotRad)) + Math.abs(halfH * Math.cos(rotRad))) *
      boardScale *
      fitScale *
      Math.cos(rotXRad);
    const originX = previewSide / 2;
    const originY = previewSide - BOTTOM_INSET - bottomDrop;

    const project = (pt: { x: number; y: number }) => {
      const local = transformPoint(pt.x - pivotX, pt.y - pivotY, rotRad, viewScaleX, viewScaleY);
      return { x: originX + local.x, y: originY + local.y };
    };

    const boardPolys = hexes.map((h) => {
      const p = isoPos(h.q, h.r, tileW, tileH);
      return {
        r: h.r,
        points: isoHex(p.x, p.y, tileW * 0.94, tileH * 0.94),
      };
    });
    const casterLocal = isoPos(0, BOARD.playerRow, tileW, tileH);
    const targetLocal = isoPos(0, BOARD.enemyRow, tileW, tileH);
    const casterPos = project(casterLocal);
    const targetPos = project(targetLocal);
    const shiftX = offX;
    const shiftY = -offY;
    const lineStart = { x: casterPos.x + shiftX, y: casterPos.y + shiftY };
    const lineEnd = { x: targetPos.x + shiftX, y: targetPos.y + shiftY };
    const travelAngle =
      Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x) + rotOffRad;
    const base = boardScale * fitScale * (tileW / DEFAULT_MAP.tileWidth);
    const spriteScaleX = (scaleX * base) / Math.cos(rotYRad);
    const spriteScaleY = (scaleY * base) / Math.cos(rotXRad);
    const tileScreenW = tileW * viewScaleX;
    const tileScreenH = tileH * viewScaleY;
    const unitH = Math.max(36, tileScreenH * 1.55);
    const unitW = Math.max(20, tileScreenW * 0.68);
    const unitBodyW = unitW * 0.74;
    const unitBodyH = unitH * 0.82;
    const unitHeadR = Math.max(5, unitW * 0.24);
    const shadowRX = unitW * 0.34;
    const shadowRY = unitW * 0.1;

    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(previewSide * dpr));
    cv.height = Math.max(1, Math.round(previewSide * dpr));

    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const drawMockUnit = (p: { x: number; y: number }, team: "player" | "enemy", facing: 1 | -1) => {
      const bodyTop = -unitBodyH * 0.78;
      const headY = bodyTop - unitHeadR * 0.08;
      const fillTop = team === "player" ? "rgba(104,255,238,0.98)" : "rgba(255,170,181,0.98)";
      const fillBottom = team === "player" ? "rgba(22,58,74,0.98)" : "rgba(70,32,46,0.98)";
      const outline = team === "player" ? "rgba(160,255,246,0.24)" : "rgba(255,184,194,0.24)";
      const sideGlow = team === "player" ? "rgba(56,224,196,0.26)" : "rgba(255,93,115,0.26)";
      const visorX = facing > 0 ? unitHeadR * 0.26 : -unitHeadR * 0.26;
      const tabX = facing > 0 ? unitBodyW * 0.12 : -unitBodyW * 0.24;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(0, 6, shadowRX, shadowRY, 0, 0, Math.PI * 2);
      ctx.fill();

      const bodyGrad = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + unitBodyH);
      bodyGrad.addColorStop(0, fillTop);
      bodyGrad.addColorStop(1, fillBottom);
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(1, unitW * 0.04);
      ctx.beginPath();
      ctx.roundRect(-unitBodyW / 2, bodyTop, unitBodyW, unitBodyH, unitBodyW * 0.42);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = sideGlow;
      ctx.beginPath();
      ctx.roundRect(tabX, bodyTop + unitBodyH * 0.12, unitBodyW * 0.2, unitBodyH * 0.28, unitBodyW * 0.1);
      ctx.fill();

      const headGrad = ctx.createLinearGradient(0, headY - unitHeadR, 0, headY + unitHeadR);
      headGrad.addColorStop(0, fillTop);
      headGrad.addColorStop(1, fillBottom);
      ctx.fillStyle = headGrad;
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(1, unitW * 0.03);
      ctx.beginPath();
      ctx.arc(0, headY, unitHeadR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(6,8,12,0.48)";
      ctx.beginPath();
      ctx.roundRect(visorX - unitHeadR * 0.08, headY - unitHeadR * 0.18, unitHeadR * 0.16, unitHeadR * 0.34, 999);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = Math.max(1, unitW * 0.02);
      ctx.beginPath();
      ctx.moveTo(-unitBodyW * 0.16, bodyTop + unitBodyH * 0.2);
      ctx.lineTo(unitBodyW * 0.16, bodyTop + unitBodyH * 0.2);
      ctx.stroke();

      ctx.restore();
    };

    const drawImpact = (p: { x: number; y: number }, pulse: number) => {
      if (pulse <= 0) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(255,93,115,0.34)";
      ctx.lineWidth = Math.max(1.5, unitW * 0.05);
      ctx.beginPath();
      ctx.ellipse(0, -unitH * 0.08, unitW * 0.5, unitH * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.arc(0, -unitH * 0.08, unitHeadR * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const casterFacing = ((Math.sign(targetPos.x - casterPos.x) || 1) as 1 | -1);
    const targetFacing: 1 | -1 = casterFacing === 1 ? -1 : 1;

    const FLIGHT_MS = duration * 1000; // one pass — the spell's Flight (s), in ms
    const GAP_MS = 220; // brief pause (impact) before the flight repeats
    const cycle = FLIGHT_MS + GAP_MS;
    const frameInterval = 1000 / fps;

    let raf = 0;
    let stopped = false;
    const t0 = performance.now();

    const drawBoard = () => {
      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(viewScaleX, viewScaleY);
      ctx.rotate(rotRad);
      ctx.translate(-pivotX, -pivotY);
      for (const poly of boardPolys) {
        ctx.beginPath();
        poly.points.forEach(([x, y], idx) => {
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle =
          poly.r === BOARD.playerRow
            ? "rgba(22,58,74,0.55)"
            : poly.r === BOARD.enemyRow
              ? "rgba(70,32,46,0.55)"
              : "rgba(26,32,48,0.55)";
        ctx.strokeStyle = "rgba(111,183,214,0.2)";
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    };

    // Alpha fade for transition-in/out. Clamp fade duration to at most half the
    // flight so the transition never dominates the travel.
    const fadeMs = Math.min(SPELL_FADE_MS, FLIGHT_MS / 2);
    const projectileAlpha = (tMs: number): number => {
      if (tMs >= FLIGHT_MS) return 1; // not flying → no projectile drawn
      // Transition in: alpha 0→1 over the first fadeMs
      if (transitionIn === "fade" && tMs < fadeMs) {
        return tMs / fadeMs;
      }
      // Transition out: alpha 1→0 over the last fadeMs
      if (transitionOut === "fade" && FLIGHT_MS - tMs <= fadeMs) {
        return (FLIGHT_MS - tMs) / fadeMs;
      }
      return 1;
    };
    // t: ms into the current pass (0..cycle). Projectile only shows while flying;
    // the gap leaves just the field, reading as a brief impact pause.
    const render = (t: number) => {
      ctx.clearRect(0, 0, previewSide, previewSide);
      drawBoard();
      drawMockUnit(casterPos, "player", casterFacing);
      drawMockUnit(targetPos, "enemy", targetFacing);
      const impactPulse = t >= FLIGHT_MS ? Math.max(0, 1 - (t - FLIGHT_MS) / 120) : 0;
      if (t < FLIGHT_MS) {
        const e = easeInOutQuad(t / FLIGHT_MS);
        const cx = lerp(lineStart.x, lineEnd.x, e);
        const cy = lerp(lineStart.y, lineEnd.y, e);
        // The first rAF `now` can precede `t0` (frame-start timestamp) → `t` < 0, and
        // a degenerate interval could be ≤0/non-finite — either makes the raw index
        // negative/NaN. Floor to 0 then normalize into [0, len-1] so we never index
        // frames[NaN] / frames[-1].
        const raw =
          Number.isFinite(frameInterval) && frameInterval > 0
            ? Math.floor(t / frameInterval)
            : 0;
        const fi = loop
          ? ((raw % frames.length) + frames.length) % frames.length
          : Math.min(frames.length - 1, Math.max(0, raw));
        const f = frames[fi];
        if (!f) return; // degenerate index → skip the sprite this frame, keep the field
        const dw = f.w * spriteScaleX;
        const dh = f.h * spriteScaleY;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(travelAngle);
        ctx.globalAlpha = projectileAlpha(t);
        ctx.drawImage(img, f.x, f.y, f.w, f.h, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
      drawImpact(targetPos, impactPulse);
    };

    const tick = (now: number) => {
      if (stopped) return;
      const elapsed = ((now - t0) % cycle + cycle) % cycle;
      render(elapsed); // modulo-time → no backgrounded-tab spiral
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
    spell?.scaleX,
    spell?.scaleY,
    spell?.loop,
    spell?.duration,
    spell?.offsetX,
    spell?.offsetY,
    spell?.rotation,
    spell?.transitionIn,
    spell?.transitionOut,
    mapConfig,
    previewSide,
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

  // finiteOr (not ??) so a bad NaN value renders as the default in the sliders
  // (and a Save then persists a valid number — self-healing the stored spell).
  const fps = finiteOr(spell?.fps, DEFAULT_SPELL_FPS);
  const scaleX = finiteOr(spell?.scaleX, 1);
  const scaleY = finiteOr(spell?.scaleY, 1);
  const loop = spell?.loop ?? true;
  const duration = finiteOr(spell?.duration, DEFAULT_SPELL_DURATION);
  const offsetX = finiteOr(spell?.offsetX, 0);
  const offsetY = finiteOr(spell?.offsetY, 0);
  const rotation = finiteOr(spell?.rotation, 0);
  const transitionIn: SpellTransition = spell?.transitionIn ?? DEFAULT_SPELL_TRANSITION;
  const transitionOut: SpellTransition = spell?.transitionOut ?? DEFAULT_SPELL_TRANSITION;

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
        <Link className="menu-bar-item" href="/studio/campaigns">
          Campaigns
        </Link>
        <Link className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
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
                  <div
                    ref={stageRef}
                    className="spell-preview-stage"
                    style={{
                      backgroundImage: 'url("/assets/dungeon-bg.png")',
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat",
                    }}
                  >
                    <video
                      className="spell-preview-video"
                      src="/assets/dungeon-bg.mp4"
                      poster="/assets/dungeon-bg.png"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      ref={(el) => {
                        if (el) el.muted = true;
                      }}
                    />
                    <div className="spell-preview-scrim" />
                    <div className="spell-preview-content">
                      <canvas ref={canvasRef} className="spell-preview-canvas" />
                    </div>
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
                      <span>Scale X</span>
                      <span className="spell-slider-val">{scaleX.toFixed(3)}×</span>
                    </span>
                    <input
                      className="spell-num"
                      type="number"
                      min={SPELL_BOUNDS.scaleX.min}
                      max={SPELL_BOUNDS.scaleX.max}
                      step={0.001}
                      value={scaleX}
                      onChange={(e) =>
                        update(
                          "scaleX",
                          clamp(
                            Math.round(numOr(e.target.value, 1) * 1000) / 1000,
                            SPELL_BOUNDS.scaleX.min,
                            SPELL_BOUNDS.scaleX.max,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="spell-slider">
                    <span className="spell-slider-head">
                      <span>Scale Y</span>
                      <span className="spell-slider-val">{scaleY.toFixed(3)}×</span>
                    </span>
                    <input
                      className="spell-num"
                      type="number"
                      min={SPELL_BOUNDS.scaleY.min}
                      max={SPELL_BOUNDS.scaleY.max}
                      step={0.001}
                      value={scaleY}
                      onChange={(e) =>
                        update(
                          "scaleY",
                          clamp(
                            Math.round(numOr(e.target.value, 1) * 1000) / 1000,
                            SPELL_BOUNDS.scaleY.min,
                            SPELL_BOUNDS.scaleY.max,
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
                <label className="spell-select-wrap">
                  <span className="spell-select-label">Transition In</span>
                  <select
                    className="spell-select"
                    value={transitionIn}
                    onChange={(e) =>
                      update(
                        "transitionIn",
                        SPELL_TRANSITIONS.includes(e.target.value as SpellTransition)
                          ? (e.target.value as SpellTransition)
                          : DEFAULT_SPELL_TRANSITION,
                      )
                    }
                  >
                    {SPELL_TRANSITIONS.map((t) => (
                      <option key={t} value={t}>
                        {t === "fade" ? "Fade" : "None"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="spell-select-wrap">
                  <span className="spell-select-label">Transition Out</span>
                  <select
                    className="spell-select"
                    value={transitionOut}
                    onChange={(e) =>
                      update(
                        "transitionOut",
                        SPELL_TRANSITIONS.includes(e.target.value as SpellTransition)
                          ? (e.target.value as SpellTransition)
                          : DEFAULT_SPELL_TRANSITION,
                      )
                    }
                  >
                    {SPELL_TRANSITIONS.map((t) => (
                      <option key={t} value={t}>
                        {t === "fade" ? "Fade" : "None"}
                      </option>
                    ))}
                  </select>
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
