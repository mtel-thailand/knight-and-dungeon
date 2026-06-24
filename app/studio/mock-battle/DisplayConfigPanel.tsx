'use client';

import type { DamageConfig as DamageCfg, MapConfig } from "@/lib/battle/types";

// =============================================================================
// SECTION > DisplayConfigPanel (React subcomponent)
// Seam (Phase 1 -> DisplayConfigPanel.tsx): DisplayConfigPanel
// Owner: mock-battle (G) - see app/studio/mock-battle/AGENTS.md
// =============================================================================

type PanelGroup = "damage" | "board";

type SliderControl = {
  key: string; // a key of the section group's config (DamageCfg | MapConfig)
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  digits?: number; // fixed decimals in the readout (omit -> show as integer)
};

const MAP_BOUNDS = {
  tileWidth: { min: 16, max: 400 },
  tileHeightRatio: { min: 0.1, max: 1 },
  scale: { min: 0.25, max: 4 },
  rotation: { min: -180, max: 180 },
  rotationX: { min: -80, max: 80 },
  rotationY: { min: -80, max: 80 },
} as const;

const UI_SECTIONS: { title: string; group: PanelGroup; controls: SliderControl[] }[] = [
  {
    title: "Damage numbers",
    group: "damage",
    controls: [
      { key: "sizeNormal", label: "Damage size", min: 0.1, max: 0.8, step: 0.01, digits: 2 },
      { key: "sizeSkill", label: "Skill size", min: 0.1, max: 0.9, step: 0.01, digits: 2 },
      { key: "height", label: "Height", min: 0, max: 1, step: 0.02, digits: 2 },
      { key: "offsetX", label: "Offset X", min: -1, max: 1, step: 0.02, digits: 2 },
      { key: "offsetY", label: "Offset Y", min: -1, max: 1, step: 0.02, digits: 2 },
      { key: "rise", label: "Rise", min: 0, max: 1.2, step: 0.02, digits: 2 },
      { key: "stroke", label: "Stroke", min: 0, max: 12, step: 1, suffix: "px" },
      { key: "durationMs", label: "Float time", min: 200, max: 1500, step: 20, suffix: "ms" },
    ],
  },
  {
    title: "Health bar",
    group: "damage",
    controls: [
      { key: "barWidth", label: "Bar width", min: 0.2, max: 2, step: 0.05, digits: 2 },
      { key: "barHeight", label: "Bar height", min: 2, max: 20, step: 1, suffix: "px" },
      { key: "barGap", label: "Bar gap", min: -40, max: 60, step: 1, suffix: "px" },
    ],
  },
  {
    title: "Board view",
    group: "board",
    controls: [
      { key: "tileWidth", label: "Tile width", min: MAP_BOUNDS.tileWidth.min, max: MAP_BOUNDS.tileWidth.max, step: 2, suffix: "px" },
      { key: "tileHeightRatio", label: "Height ratio", min: MAP_BOUNDS.tileHeightRatio.min, max: MAP_BOUNDS.tileHeightRatio.max, step: 0.02, digits: 2 },
      { key: "scale", label: "Scale", min: MAP_BOUNDS.scale.min, max: MAP_BOUNDS.scale.max, step: 0.05, digits: 2 },
      { key: "rotation", label: "Rotation", min: MAP_BOUNDS.rotation.min, max: MAP_BOUNDS.rotation.max, step: 5, suffix: "°" },
      { key: "rotationX", label: "Tilt X", min: MAP_BOUNDS.rotationX.min, max: MAP_BOUNDS.rotationX.max, step: 5, suffix: "°" },
      { key: "rotationY", label: "Tilt Y", min: MAP_BOUNDS.rotationY.min, max: MAP_BOUNDS.rotationY.max, step: 5, suffix: "°" },
    ],
  },
];

export function DisplayConfigPanel({
  open,
  onToggle,
  dmgCfg,
  onDmgChange,
  mapCfg,
  onMapChange,
  topDown,
  onToggleTopDown,
  autoRewatch,
  onAutoRewatchChange,
  showGrid,
  onShowGridChange,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  dmgCfg: DamageCfg;
  onDmgChange: (key: keyof DamageCfg, value: number) => void;
  mapCfg: MapConfig;
  onMapChange: (key: keyof MapConfig, value: number) => void;
  topDown: boolean;
  onToggleTopDown: () => void;
  autoRewatch: boolean;
  onAutoRewatchChange: (value: boolean) => void;
  showGrid: boolean;
  onShowGridChange: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`mb-ui-toggle ${open ? "open" : ""}`}
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Display settings"
        title="Display settings"
      >
        UI
      </button>

      <aside className={`mb-ui-panel ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="mb-ui-head">
          <span className="mb-ui-title">Display</span>
          <button type="button" className="mb-ui-reset" onClick={onReset}>
            Reset
          </button>
        </div>

        <div className="mb-ui-scroll">
          {UI_SECTIONS.map((section) => {
            const isBoard = section.group === "board";
            return (
              <div key={section.title} className="mb-ui-section">
                <div className="mb-ui-section-title">{section.title}</div>
                {isBoard && (
                  <button
                    type="button"
                    className={`mb-ui-pill ${topDown ? "on" : ""}`}
                    onClick={onToggleTopDown}
                    aria-pressed={topDown}
                    title="Flatten to an overhead hex grid (a temporary view — your saved iso config is untouched)"
                  >
                    Top-down
                  </button>
                )}
                {isBoard && (
                  <label className="mb-ui-check">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => onShowGridChange(e.target.checked)}
                    />
                    <span>Show grid</span>
                  </label>
                )}
                {section.controls.map((c) => {
                  const value = isBoard
                    ? mapCfg[c.key as keyof MapConfig]
                    : dmgCfg[c.key as keyof DamageCfg];
                  // Top-down overrides tilt/rotation/ratio — lock those while it's
                  // on (tile width + scale stay live), mirroring the old overlay.
                  const locked =
                    isBoard && topDown && c.key !== "tileWidth" && c.key !== "scale";
                  return (
                    <div
                      key={c.key}
                      className={`mb-ui-row ${locked ? "is-locked" : ""}`}
                    >
                      <div className="mb-ui-row-head">
                        <span className="mb-ui-label">{c.label}</span>
                        <span className="mb-ui-value">
                          {c.digits != null ? value.toFixed(c.digits) : value}
                          {c.suffix ?? ""}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="mb-ui-slider"
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        value={value}
                        disabled={locked}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (isBoard) onMapChange(c.key as keyof MapConfig, v);
                          else onDmgChange(c.key as keyof DamageCfg, v);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playback — boolean view preferences (in-memory, not persisted). */}
          <div className="mb-ui-section">
            <div className="mb-ui-section-title">Playback</div>
            <label className="mb-ui-check">
              <input
                type="checkbox"
                checked={autoRewatch}
                onChange={(e) => onAutoRewatchChange(e.target.checked)}
              />
              <span>Auto-rewatch</span>
            </label>
          </div>
        </div>
      </aside>
    </>
  );
}
