"use client";

import { useEffect, useRef } from "react";
import type {
  Application as PixiApplication,
  Texture as PixiTexture,
} from "pixi.js";
import type {
  UnitStats,
  CharacterRoleMap,
  BattleEventRole,
} from "@/lib/battle/types";
import { STAT_BOUNDS } from "@/lib/battle/types";
import {
  SOURCE_FPS,
  TICKER_FPS,
  PREVIEW_TICK_MS,
  PANEL_W,
  DUAL_PANEL_W,
  GRID,
  DEFAULT_CHARACTER,
} from "./studioConstants";
import { STUDIO_CSS } from "./studioStyles";
import {
  slugify,
  getHexRowsFromCounts,
  isoPos,
  isoHex,
  defaultCharConfig,
} from "./studioHelpers";
import type {
  AnimConfig,
  AnimationRow,
  CatalogEntry,
  AnimStep,
  ActionStep,
  Action,
  CharConfigData,
  ServerConfig,
  StoredAction,
  CharacterSeed,
  BootstrapPayload,
} from "./studioTypes";

export default function StudioClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleCharPanelRef = useRef<(() => void) | null>(null);
  const toggleBattlePanelRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    let pixiApp!: PixiApplication;
    let injectedStyle: HTMLStyleElement | null = null;
    let resizeHandler: (() => void) | null = null;
    let destroyed = false;

    async function init() {
      const {
        Application,
        Assets,
        AnimatedSprite,
        Graphics,
        Spritesheet,
        Texture,
      } = await import("pixi.js");

      if (destroyed) return;

      const canvasWrapper = document.createElement("div");
      canvasWrapper.style.cssText = `position: absolute; top: 0; bottom: 0; left: ${DUAL_PANEL_W}; right: ${PANEL_W};`;
      container.appendChild(canvasWrapper);

      pixiApp = new Application();
      await pixiApp.init({
        resizeTo: canvasWrapper,
        backgroundAlpha: 0,
        antialias: true,
      });

      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      canvasWrapper.appendChild(pixiApp.canvas);

      // Bootstrap everything from the SQLite-backed API in one request: mutable
      // user state + the animation catalog (manifest + spritesheet frame data)
      // + the per-character animation seed.
      let bootstrap: BootstrapPayload = {
        activeCharacter: DEFAULT_CHARACTER.id,
        characters: [{ ...DEFAULT_CHARACTER }],
        animationConfigs: {},
        actions: {},
        animations: [],
        characterSeed: {},
        battleStats: {},
        roleMaps: {},
      };
      try {
        const res = await fetch("/api/config");
        if (res.ok) bootstrap = await res.json();
      } catch {
        /* use defaults */
      }

      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      const catalog: CatalogEntry[] = bootstrap.animations ?? [];

      // Build frame textures from each sheet's PNG (on disk) + frame data (from
      // SQLite) via Pixi's Spritesheet. A single bad/missing/oversized sheet
      // must not abort the whole studio, so failures are isolated per row.
      const framesByKey: Record<string, PixiTexture[]> = {};
      for (const c of catalog) {
        if (!c.image || !c.frameData) continue;
        try {
          const texture = (await Assets.load(`/assets/${c.image}`)) as PixiTexture;
          if (destroyed) {
            pixiApp.destroy();
            return;
          }
          const sheet = new Spritesheet(texture, c.frameData);
          await sheet.parse();
          framesByKey[c.key] = Object.keys(sheet.data.frames).map(
            (n: string) => sheet.textures[n],
          );
        } catch (err) {
          console.error(`Failed to load spritesheet "${c.key}":`, err);
        }
      }

      // Derived entries reuse another row's frames (optionally reversed). Rows
      // that produced no frames are dropped so an empty texture list never
      // reaches AnimatedSprite (which throws on []).
      const animations: AnimationRow[] = catalog
        .map((c) => {
          let frames = framesByKey[c.key];
          if (!frames && c.deriveFrom) {
            const base = framesByKey[c.deriveFrom] ?? [];
            frames = c.reverse ? [...base].reverse() : [...base];
          }
          return {
            label: c.label,
            configKey: c.key,
            frames: frames ?? [],
            config: { duration: 0, loop: true, alpha: 1, rotation: 0 },
          };
        })
        .filter((a) => a.frames.length > 0);

      // Per-character animation seed (was public/character-configs.json), now
      // delivered by the API from SQLite as part of the bootstrap payload.
      const allFileConfigs: CharacterSeed = bootstrap.characterSeed ?? {};

      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      const serverConfig: ServerConfig = {
        activeCharacter: bootstrap.activeCharacter ?? DEFAULT_CHARACTER.id,
        characters: bootstrap.characters ?? [{ ...DEFAULT_CHARACTER }],
        animationConfigs: bootstrap.animationConfigs ?? {},
        actions: bootstrap.actions ?? {},
        characterConfigs: bootstrap.characterConfigs,
        characterAnimations: bootstrap.characterAnimations,
      };

      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      function saveToServer() {
        fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serverConfig),
        }).catch(() => {});
      }

      function saveCharacters(chars: Array<{ id: string; name: string }>) {
        serverConfig.characters = chars;
        saveToServer();
      }

      // The animation "kit" a character owns: which catalog keys it can use.
      // DB-seed rows win when present; otherwise an explicit characterAnimations
      // entry is authoritative — including an empty [] for a freshly created,
      // intentionally-blank character. null means no kit is defined (legacy /
      // unseeded character) and the caller should fall back to the full catalog.
      function resolveCharAnimKeys(id: string): string[] | null {
        const seed = allFileConfigs[id]?.animations;
        if (seed && Object.keys(seed).length > 0) return Object.keys(seed);
        const explicit = serverConfig.characterAnimations?.[id];
        if (explicit) return explicit;
        return null;
      }

      function migrateAction(raw: StoredAction): Action {
        if (Array.isArray(raw.steps)) return raw as Action;
        return {
          id: raw.id,
          name: raw.name,
          steps: (raw.animationKeys ?? []).map((key: string) => {
            const def = animations.find((a) => a.configKey === key);
            return {
              type: "animation" as const,
              animationKey: key,
              duration: def?.config.duration ?? 1.0,
            };
          }),
        };
      }

      function getCharacterActions(): Action[] {
        return (serverConfig.actions?.[CHARACTER] ?? []).map(migrateAction);
      }

      function saveActions(acts: Action[]) {
        if (!serverConfig.actions) serverConfig.actions = {};
        serverConfig.actions[CHARACTER] = acts;
        saveToServer();
      }

      // Respect an intentionally empty character list from the API (zero
      // characters). DEFAULT_CHARACTER only backstops a failed fetch, which the
      // bootstrap default already supplies, so the list is copied as-is here.
      let characters: Array<{ id: string; name: string }> = [
        ...(serverConfig.characters ?? []),
      ];

      const existingIds = new Set(characters.map((c: { id: string }) => c.id));
      Object.keys(allFileConfigs).forEach((id) => {
        if (!existingIds.has(id)) {
          const name = id
            .split("-")
            .map((w: string) => w[0].toUpperCase() + w.slice(1))
            .join(" ");
          characters.push({ id, name });
        }
      });

      let activeCharacterId = serverConfig.activeCharacter;
      if (
        !activeCharacterId ||
        !characters.find((c: { id: string }) => c.id === activeCharacterId)
      ) {
        activeCharacterId = characters[0]?.id ?? "";
      }

      let CHARACTER = activeCharacterId;
      let fileDefaults: Record<string, unknown> =
        allFileConfigs[CHARACTER]?.animations ?? {};

      let charConfig: CharConfigData = defaultCharConfig();

      function persistCharConfig() {
        if (!serverConfig.characterConfigs) serverConfig.characterConfigs = {};
        serverConfig.characterConfigs[CHARACTER] = { ...charConfig };
        serverConfig.activeCharacter = CHARACTER;
        serverConfig.characters = characters;
        saveToServer();
      }

      function persistConfigs() {
        const out: Record<string, object> = {};
        animations.forEach((def) => {
          out[def.configKey] = {
            duration: def.config.duration,
            loop: def.config.loop,
            alpha: def.config.alpha,
            rotation: def.config.rotation,
          };
        });
        serverConfig.animationConfigs[CHARACTER] = out;
        serverConfig.activeCharacter = CHARACTER;
        serverConfig.characters = characters;
        saveToServer();
      }

      animations.forEach((def) => {
        const fd = (allFileConfigs[CHARACTER]?.animations?.[def.configKey] ??
          {}) as Partial<AnimConfig>;
        const sv = (serverConfig.animationConfigs?.[CHARACTER]?.[
          def.configKey
        ] ?? {}) as Partial<AnimConfig>;
        def.config = {
          duration:
            sv?.duration ?? fd?.duration ?? def.frames.length / SOURCE_FPS,
          loop: sv?.loop ?? fd?.loop ?? true,
          alpha: sv?.alpha ?? 1,
          rotation: sv?.rotation ?? 0,
        };
      });

      const savedCharCfg = serverConfig.characterConfigs?.[CHARACTER];
      if (savedCharCfg) charConfig = { ...charConfig, ...savedCharCfg };

      let currentIndex = 0;
      {
        // Start on the active character's first kit animation (seed- or
        // blob-defined), so first paint matches what switchCharacter would show.
        const startKit = resolveCharAnimKeys(CHARACTER);
        if (startKit && startKit.length > 0) {
          const i = animations.findIndex((d) => startKit.includes(d.configKey));
          if (i !== -1) currentIndex = i;
        }
      }

      // Hex grid — pointy-top hexagons, 5-6-7-6-5 layout centered on canvas
      let tileOffset = { px: 0, py: 0 };
      let isoTileW = GRID.tileW;
      let isoTileHRatio = GRID.tileHRatio;
      const hexGrid = new Graphics();
      const tilePosMap: { label: string; px: number; py: number }[] = [];

      function drawIsoGrid() {
        hexGrid.clear();
        const tW = isoTileW;
        const tH = isoTileW * isoTileHRatio;
        const rowCols: number[][] = getHexRowsFromCounts(GRID.rows);
        const cR = (rowCols.length - 1) / 2;

        // Iso-hex floor matching the mock-battle board: 6-point honeycomb tiles
        // (shared isoPos lattice + isoHex corners at 94% for the seam gap),
        // neutral fill + faint cyan stroke. No tile/center dots.
        tilePosMap.length = 0;
        rowCols.forEach((cols, ri) => {
          const r = ri - cR;
          cols.forEach((q) => {
            const { x, y } = isoPos(q, r, tW, tH);
            hexGrid.poly(isoHex(x, y, tW * 0.94, tH * 0.94).flat());
            hexGrid.fill({ color: GRID.tileFill, alpha: 0.55 });
            hexGrid.stroke({ color: GRID.tileStroke, width: 1.5, alpha: 0.2 });
            tilePosMap.push({
              label: `Tile ${tilePosMap.length + 1}`,
              px: x,
              py: y,
            });
          });
        });
      }

      function refreshIsoGrid() {
        drawIsoGrid();
        tileSelect.innerHTML = "";
        tilePosMap.forEach((t, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = t.label;
          tileSelect.appendChild(opt);
        });
        const parsed = parseInt(tileSelect.value, 10);
        const fallback = Math.floor(tilePosMap.length / 2);
        const curIdx = Math.max(
          0,
          Math.min(
            Number.isNaN(parsed) ? fallback : parsed,
            tilePosMap.length - 1,
          ),
        );
        tileSelect.value = String(curIdx);
        const t = tilePosMap[curIdx];
        if (t) {
          tileOffset = { px: t.px, py: t.py };
          repositionStage();
        }
      }

      drawIsoGrid();
      hexGrid.position.set(pixiApp.screen.width / 2, pixiApp.screen.height / 2);
      pixiApp.stage.addChild(hexGrid);

      const anim = new AnimatedSprite(
        animations[currentIndex]?.frames ?? [Texture.EMPTY],
      );
      anim.anchor.set(0.5);
      pixiApp.stage.addChild(anim);
      applyAnimation(currentIndex);

      function repositionStage() {
        const cx = pixiApp.screen.width / 2;
        const cy = pixiApp.screen.height / 2;
        hexGrid.position.set(cx, cy);
        anim.position.set(cx + tileOffset.px, cy + tileOffset.py);
      }

      // Tile position dropdown — overlaid at top-center of canvas
      const tileSelect = document.createElement("select");
      tileSelect.className = "tile-select";
      tilePosMap.forEach((t, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = t.label;
        if (t.px === 0 && t.py === 0) opt.selected = true;
        tileSelect.appendChild(opt);
      });
      tileSelect.addEventListener("change", () => {
        const t = tilePosMap[parseInt(tileSelect.value)];
        tileOffset = { px: t.px, py: t.py };
        repositionStage();
      });
      const mapOverlay = document.createElement("div");
      mapOverlay.className = "map-overlay";
      mapOverlay.appendChild(tileSelect);

      const tWLabel = document.createElement("span");
      tWLabel.className = "map-overlay-label";
      tWLabel.textContent = "W:";
      const tWInp = document.createElement("input");
      tWInp.type = "number";
      tWInp.className = "map-overlay-input";
      tWInp.min = "40";
      tWInp.max = "300";
      tWInp.step = "4";
      tWInp.value = String(isoTileW);
      tWInp.addEventListener("input", () => {
        const v = parseFloat(tWInp.value);
        if (!isNaN(v) && v > 0) {
          isoTileW = v;
          refreshIsoGrid();
        }
      });

      const tHLabel = document.createElement("span");
      tHLabel.className = "map-overlay-label";
      tHLabel.textContent = "H:";
      const tHInp = document.createElement("input");
      tHInp.type = "number";
      tHInp.className = "map-overlay-input";
      tHInp.min = "0.1";
      tHInp.max = "1.0";
      tHInp.step = "0.05";
      tHInp.value = String(isoTileHRatio);
      tHInp.addEventListener("input", () => {
        const v = parseFloat(tHInp.value);
        if (!isNaN(v) && v > 0) {
          isoTileHRatio = v;
          refreshIsoGrid();
        }
      });

      mapOverlay.appendChild(tWLabel);
      mapOverlay.appendChild(tWInp);
      mapOverlay.appendChild(tHLabel);
      mapOverlay.appendChild(tHInp);
      canvasWrapper.appendChild(mapOverlay);

      // Empty-state hint shown on the canvas when there is no active character.
      const emptyHint = document.createElement("div");
      emptyHint.style.cssText =
        "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:0 24px; color:rgba(255,255,255,0.38); font-family:system-ui,sans-serif; font-size:14px; pointer-events:none;";
      emptyHint.textContent =
        "No character yet — add one in the left panel to begin.";
      canvasWrapper.appendChild(emptyHint);
      function updateEmptyHint() {
        const has = !!CHARACTER;
        emptyHint.style.display = has ? "none" : "flex";
        // A character with an explicit empty kit (newly created, no animations
        // assigned yet) shows an empty canvas instead of a leftover animation.
        const blank = resolveCharAnimKeys(CHARACTER)?.length === 0;
        anim.visible = has && !blank;
      }
      updateEmptyHint();

      // Single source of truth for painting an animation onto the sprite: its
      // textures + speed/loop AND the active character's transforms
      // (scale/anchor/alpha/rotation/tint). Every entry point (startup, switch
      // animation, switch character, preview restore) goes through here so the
      // sprite never renders with a stale or partial transform set.
      function applyAnimation(idx: number) {
        const def = animations[idx];
        if (!def) return;
        const cfg = def.config;
        anim.stop();
        anim.textures = def.frames;
        anim.animationSpeed = anim.totalFrames / (cfg.duration * TICKER_FPS);
        anim.loop = cfg.loop;
        anim.scale.set(charConfig.scaleX, charConfig.scaleY);
        anim.anchor.set(charConfig.anchorX, charConfig.anchorY);
        anim.alpha = cfg.alpha;
        anim.rotation = (cfg.rotation * Math.PI) / 180;
        anim.tint = charConfig.tint;
        repositionStage();
        anim.play();
      }

      function switchTo(index: number) {
        currentIndex = index;
        applyAnimation(index);
        renderPlaybackPanel(currentIndex);
        renderAnimList();
      }

      resizeHandler = () => {
        repositionStage();
      };
      window.addEventListener("resize", resizeHandler);

      // --- Styles ---
      const styleTag = document.createElement("style");
      injectedStyle = styleTag;
      styleTag.textContent = STUDIO_CSS;
      document.head.appendChild(styleTag);

      // --- Right panel (Playback Settings / Action Editor) ---
      const panel = document.createElement("div");
      panel.className = "config-panel";

      const panelTitle = document.createElement("div");
      panelTitle.className = "config-panel-title";
      panelTitle.textContent = "Playback Settings";
      panel.appendChild(panelTitle);

      const playbackContent = document.createElement("div");
      playbackContent.className = "playback-content";
      panel.appendChild(playbackContent);

      function renderPlaybackPanel(idx: number) {
        const def = animations[idx];
        if (!def) return;
        const cfg = def.config;
        playbackContent.innerHTML = "";
        panelTitle.textContent = def.label;

        function makeNumRow(
          label: string,
          val: number,
          min: number,
          max: number,
          step: number,
          onChange: (v: number) => void,
        ) {
          const section = document.createElement("div");
          section.className = "config-section";
          const row = document.createElement("div");
          row.className = "config-label-row";
          const lbl = document.createElement("span");
          lbl.className = "config-label";
          lbl.textContent = label;
          const inp = document.createElement("input");
          inp.type = "number";
          inp.className = "config-number-input";
          inp.min = String(min);
          inp.max = String(max);
          inp.step = String(step);
          inp.value = Number(val ?? 0).toFixed(step < 1 ? 2 : 0);
          inp.addEventListener("input", () => {
            const v = parseFloat(inp.value);
            if (!isNaN(v)) onChange(v);
          });
          row.appendChild(lbl);
          section.appendChild(row);
          section.appendChild(inp);
          playbackContent.appendChild(section);
        }

        function makeToggleRow(
          label: string,
          checked: boolean,
          onChange: (v: boolean) => void,
        ) {
          const section = document.createElement("div");
          section.className = "config-section";
          const row = document.createElement("div");
          row.className = "config-label-row";
          const lbl = document.createElement("span");
          lbl.className = "config-label";
          lbl.textContent = label;
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "toggle-switch";
          const inp = document.createElement("input");
          inp.type = "checkbox";
          inp.checked = checked;
          const track = document.createElement("span");
          track.className = "toggle-track";
          toggleLabel.appendChild(inp);
          toggleLabel.appendChild(track);
          inp.addEventListener("change", () => onChange(inp.checked));
          row.appendChild(lbl);
          row.appendChild(toggleLabel);
          section.appendChild(row);
          playbackContent.appendChild(section);
        }

        function makeColorRow(
          label: string,
          tintVal: number,
          onChange: (v: number) => void,
        ) {
          const section = document.createElement("div");
          section.className = "config-section";
          const row = document.createElement("div");
          row.className = "config-label-row";
          const lbl = document.createElement("span");
          lbl.className = "config-label";
          lbl.textContent = label;
          const inp = document.createElement("input");
          inp.type = "color";
          inp.className = "config-color-input";
          inp.value = "#" + tintVal.toString(16).padStart(6, "0");
          inp.addEventListener("input", () => {
            const hex = parseInt(inp.value.replace("#", ""), 16);
            if (!isNaN(hex)) onChange(hex);
          });
          row.appendChild(lbl);
          row.appendChild(inp);
          section.appendChild(row);
          playbackContent.appendChild(section);
        }

        makeNumRow("Duration", cfg.duration, 0.05, 60, 0.05, (v) => {
          cfg.duration = v;
          if (idx === currentIndex)
            anim.animationSpeed = anim.totalFrames / (v * TICKER_FPS);
          persistConfigs();
        });
        makeToggleRow("Loop", cfg.loop, (v) => {
          cfg.loop = v;
          if (idx === currentIndex) anim.loop = v;
          persistConfigs();
        });
        makeNumRow("Alpha", cfg.alpha, 0, 1, 0.01, (v) => {
          cfg.alpha = v;
          if (idx === currentIndex) anim.alpha = v;
          persistConfigs();
        });
        makeNumRow("Rotation °", cfg.rotation, -360, 360, 1, (v) => {
          cfg.rotation = v;
          if (idx === currentIndex) anim.rotation = (v * Math.PI) / 180;
          persistConfigs();
        });
      }

      const actionEditorEl = document.createElement("div");
      actionEditorEl.className = "ae-container";
      actionEditorEl.style.display = "none";
      panel.appendChild(actionEditorEl);

      container.appendChild(panel);

      const gearBtn = document.createElement("button");
      gearBtn.className = "gear-btn";
      gearBtn.textContent = "⚙";
      gearBtn.setAttribute("aria-label", "Toggle settings panel");
      container.appendChild(gearBtn);

      let panelOpen = true;
      panel.classList.add("open");
      gearBtn.classList.add("panel-open");
      gearBtn.addEventListener("click", () => {
        panelOpen = !panelOpen;
        panel.classList.toggle("open", panelOpen);
        gearBtn.classList.toggle("panel-open", panelOpen);
        canvasWrapper.style.right = panelOpen ? PANEL_W : "0px";
        setTimeout(() => {
          if (!destroyed) repositionStage();
        }, 300);
      });

      let selectedActionId: string | null = null;
      let previewCancelled = false;
      let isPreviewing = false;
      let previewLoop = false;
      let previewGenId = 0;

      function showPlaybackPanel() {
        panelTitle.style.display = "";
        playbackContent.style.display = "";
        actionEditorEl.style.display = "none";
      }

      function showActionEditor() {
        panelTitle.style.display = "none";
        playbackContent.style.display = "none";
        actionEditorEl.style.display = "";
      }

      async function previewAction(steps: ActionStep[]) {
        previewCancelled = false;
        isPreviewing = true;
        const myId = ++previewGenId;

        do {
          for (const step of steps) {
            if (previewCancelled || destroyed || previewGenId !== myId) break;

            if (step.type === "animation") {
              const def = animations.find(
                (a) => a.configKey === step.animationKey,
              );
              if (!def) continue;
              const allFrames = def.frames;
              const animStep = step as AnimStep;
              const sf = Math.max(
                0,
                Math.min(animStep.startFrame ?? 0, allFrames.length - 1),
              );
              const ef = Math.max(
                sf,
                Math.min(
                  animStep.endFrame ?? allFrames.length - 1,
                  allFrames.length - 1,
                ),
              );
              const sliced = allFrames.slice(sf, ef + 1);
              anim.stop();
              anim.textures = sliced;
              anim.loop = false;
              anim.animationSpeed = sliced.length / (step.duration * TICKER_FPS);
              await new Promise<void>((resolve) => {
                anim.onComplete = () => {
                  anim.onComplete = undefined;
                  resolve();
                };
                anim.play();
              });
            } else {
              await new Promise<void>((resolve) => {
                let elapsed = 0;
                const id = setInterval(() => {
                  elapsed += PREVIEW_TICK_MS;
                  if (
                    previewCancelled ||
                    destroyed ||
                    previewGenId !== myId ||
                    elapsed >= step.duration * 1000
                  ) {
                    clearInterval(id);
                    resolve();
                  }
                }, PREVIEW_TICK_MS);
              });
            }
          }
        } while (
          previewLoop &&
          !previewCancelled &&
          !destroyed &&
          previewGenId === myId
        );

        if (previewGenId !== myId) return;

        isPreviewing = false;
        previewCancelled = false;

        if (!destroyed) applyAnimation(currentIndex);

        if (selectedActionId) {
          const act = getCharacterActions().find(
            (a) => a.id === selectedActionId,
          );
          if (act) renderActionEditor(act);
        }
      }

      function renderActionEditor(action: Action) {
        actionEditorEl.innerHTML = "";
        showActionEditor();

        const header = document.createElement("div");
        header.className = "ae-header";

        const backBtn = document.createElement("button");
        backBtn.className = "ae-back-btn";
        backBtn.textContent = "←";
        backBtn.addEventListener("click", () => {
          previewCancelled = true;
          selectedActionId = null;
          showPlaybackPanel();
          renderActionList();
        });

        const nameSpan = document.createElement("span");
        nameSpan.className = "ae-action-name";
        nameSpan.textContent = action.name;

        header.appendChild(backBtn);
        header.appendChild(nameSpan);
        actionEditorEl.appendChild(header);

        const stepsList = document.createElement("div");
        stepsList.className = "ae-steps";

        function renderSteps() {
          stepsList.innerHTML = "";
          if (action.steps.length === 0) {
            const empty = document.createElement("div");
            empty.className = "ae-empty";
            empty.textContent = "No steps yet.";
            stepsList.appendChild(empty);
            return;
          }
          action.steps.forEach((step, idx) => {
            const row = document.createElement("div");
            row.className = "ae-step";

            const icon = document.createElement("span");
            icon.className = "ae-step-icon";
            icon.textContent = step.type === "animation" ? "▶" : "❄";

            const label = document.createElement("span");
            label.className = "ae-step-label";
            if (step.type === "animation") {
              label.textContent =
                animations.find((a) => a.configKey === step.animationKey)
                  ?.label ?? step.animationKey;
            } else {
              label.textContent = "Freeze";
            }

            const durInput = document.createElement("input");
            durInput.type = "number";
            durInput.className = "ae-step-dur";
            durInput.min = "0.05";
            durInput.max = "60";
            durInput.step = "0.05";
            durInput.value = step.duration.toFixed(2);
            durInput.addEventListener("change", () => {
              const d = parseFloat(durInput.value);
              if (!isNaN(d) && d > 0) {
                step.duration = d;
                const acts = getCharacterActions();
                saveActions(acts.map((a) => (a.id === action.id ? action : a)));
              }
            });

            const unit = document.createElement("span");
            unit.className = "ae-step-unit";
            unit.textContent = "s";

            const delBtn = document.createElement("button");
            delBtn.className = "ae-step-del";
            delBtn.textContent = "×";
            delBtn.addEventListener("click", () => {
              action.steps.splice(idx, 1);
              saveActions(
                getCharacterActions().map((a) =>
                  a.id === action.id ? action : a,
                ),
              );
              renderSteps();
              renderActionList();
            });

            if (step.type === "animation") {
              const def = animations.find(
                (a) => a.configKey === step.animationKey,
              );
              const totalF = (def?.frames.length ?? 1) - 1;
              const animStep = step as AnimStep;

              const startFInput = document.createElement("input");
              startFInput.type = "number";
              startFInput.className = "ae-step-frame";
              startFInput.min = "0";
              startFInput.max = String(totalF);
              startFInput.step = "1";
              startFInput.value = String(animStep.startFrame ?? 0);
              startFInput.title = "Start frame";
              startFInput.addEventListener("change", () => {
                const v = parseInt(startFInput.value);
                if (!isNaN(v)) {
                  animStep.startFrame = Math.max(0, Math.min(v, totalF));
                  saveActions(
                    getCharacterActions().map((a) =>
                      a.id === action.id ? action : a,
                    ),
                  );
                }
              });

              const frameSep = document.createElement("span");
              frameSep.className = "ae-step-sep";
              frameSep.textContent = "–";

              const endFInput = document.createElement("input");
              endFInput.type = "number";
              endFInput.className = "ae-step-frame";
              endFInput.min = "0";
              endFInput.max = String(totalF);
              endFInput.step = "1";
              endFInput.value = String(animStep.endFrame ?? totalF);
              endFInput.title = "End frame";
              endFInput.addEventListener("change", () => {
                const v = parseInt(endFInput.value);
                if (!isNaN(v)) {
                  animStep.endFrame = Math.max(0, Math.min(v, totalF));
                  saveActions(
                    getCharacterActions().map((a) =>
                      a.id === action.id ? action : a,
                    ),
                  );
                }
              });

              row.appendChild(icon);
              row.appendChild(label);
              row.appendChild(startFInput);
              row.appendChild(frameSep);
              row.appendChild(endFInput);
              row.appendChild(durInput);
              row.appendChild(unit);
              row.appendChild(delBtn);
            } else {
              row.appendChild(icon);
              row.appendChild(label);
              row.appendChild(durInput);
              row.appendChild(unit);
              row.appendChild(delBtn);
            }
            stepsList.appendChild(row);
          });
        }

        renderSteps();
        actionEditorEl.appendChild(stepsList);

        const controls = document.createElement("div");
        controls.className = "ae-controls";

        const charAnimKeys =
          resolveCharAnimKeys(CHARACTER) ?? animations.map((a) => a.configKey);

        const addAnimRow = document.createElement("div");
        addAnimRow.className = "ae-add-row";
        const animSelect = document.createElement("select");
        animSelect.className = "ae-select";
        charAnimKeys.forEach((key) => {
          const def = animations.find((a) => a.configKey === key);
          if (!def) return;
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = def.label;
          animSelect.appendChild(opt);
        });
        const addAnimBtn = document.createElement("button");
        addAnimBtn.className = "ae-add-btn";
        addAnimBtn.textContent = "+ Anim";
        addAnimBtn.addEventListener("click", () => {
          const key = animSelect.value;
          const def = animations.find((a) => a.configKey === key);
          if (!def) return;
          action.steps.push({
            type: "animation",
            animationKey: key,
            duration: def.config.duration,
            startFrame: 0,
            endFrame: def.frames.length - 1,
          });
          saveActions(
            getCharacterActions().map((a) => (a.id === action.id ? action : a)),
          );
          renderSteps();
          renderActionList();
        });
        addAnimRow.appendChild(animSelect);
        addAnimRow.appendChild(addAnimBtn);

        const addFreezeRow = document.createElement("div");
        addFreezeRow.className = "ae-add-row";
        const freezeLabel = document.createElement("span");
        freezeLabel.style.cssText =
          "font-size:11px;color:rgba(255,255,255,0.3);flex-shrink:0;";
        freezeLabel.textContent = "❄ Freeze";
        const freezeDurInput = document.createElement("input");
        freezeDurInput.type = "number";
        freezeDurInput.className = "ae-dur-input";
        freezeDurInput.min = "0.05";
        freezeDurInput.max = "30";
        freezeDurInput.step = "0.1";
        freezeDurInput.value = "0.5";
        const addFreezeBtn = document.createElement("button");
        addFreezeBtn.className = "ae-add-btn";
        addFreezeBtn.textContent = "+ Add";
        addFreezeBtn.addEventListener("click", () => {
          const d = parseFloat(freezeDurInput.value);
          if (isNaN(d) || d <= 0) return;
          action.steps.push({ type: "freeze", duration: d });
          saveActions(
            getCharacterActions().map((a) => (a.id === action.id ? action : a)),
          );
          renderSteps();
          renderActionList();
        });
        addFreezeRow.appendChild(freezeLabel);
        addFreezeRow.appendChild(freezeDurInput);
        addFreezeRow.appendChild(addFreezeBtn);

        const loopRow = document.createElement("div");
        loopRow.className = "ae-add-row";
        const loopLabelSpan = document.createElement("span");
        loopLabelSpan.style.cssText =
          "font-size:11px;color:rgba(255,255,255,0.3);flex:1;";
        loopLabelSpan.textContent = "Loop";
        const loopToggle = document.createElement("label");
        loopToggle.className = "toggle-switch";
        const loopCheck = document.createElement("input");
        loopCheck.type = "checkbox";
        loopCheck.checked = previewLoop;
        const loopTrackEl = document.createElement("span");
        loopTrackEl.className = "toggle-track";
        loopToggle.appendChild(loopCheck);
        loopToggle.appendChild(loopTrackEl);
        loopCheck.addEventListener("change", () => {
          previewLoop = loopCheck.checked;
        });
        loopRow.appendChild(loopLabelSpan);
        loopRow.appendChild(loopToggle);

        controls.appendChild(addAnimRow);
        controls.appendChild(addFreezeRow);
        controls.appendChild(loopRow);
        actionEditorEl.appendChild(controls);
      }

      // --- Character panel ---
      const charPanel = document.createElement("div");
      charPanel.className = "char-panel";

      const charPanelTitle = document.createElement("div");
      charPanelTitle.className = "config-panel-title";
      charPanelTitle.textContent = "Characters";
      charPanel.appendChild(charPanelTitle);

      const charList = document.createElement("div");
      charList.className = "char-list";
      charPanel.appendChild(charList);

      const charNewForm = document.createElement("div");
      charNewForm.className = "char-new-form";
      const charNewInput = document.createElement("input");
      charNewInput.type = "text";
      charNewInput.className = "char-new-input";
      charNewInput.placeholder = "Character name";
      const charAddBtn = document.createElement("button");
      charAddBtn.className = "char-add-btn";
      charAddBtn.textContent = "Add";
      charNewForm.appendChild(charNewInput);
      charNewForm.appendChild(charAddBtn);
      charPanel.appendChild(charNewForm);
      container.appendChild(charPanel);

      const charBtn = document.createElement("button");
      charBtn.className = "char-btn";
      charBtn.textContent = "☰";
      container.appendChild(charBtn);

      // --- Anim panel ---
      const animPanel = document.createElement("div");
      animPanel.className = "anim-panel";

      const animPanelTitle = document.createElement("div");
      animPanelTitle.className = "config-panel-title";
      animPanelTitle.textContent =
        characters.find((c: { id: string }) => c.id === CHARACTER)?.name ??
        CHARACTER;
      animPanel.appendChild(animPanelTitle);

      const charCfgSection = document.createElement("div");
      charCfgSection.className = "char-cfg-section";
      animPanel.appendChild(charCfgSection);

      function renderCharConfig() {
        charCfgSection.innerHTML = "";
        if (!CHARACTER) return;

        function makeCharCfgRow(
          label: string,
          val: number,
          min: number,
          max: number,
          step: number,
          onChange: (v: number) => void,
        ) {
          const row = document.createElement("div");
          row.className = "char-cfg-row";
          const lbl = document.createElement("span");
          lbl.className = "char-cfg-label";
          lbl.textContent = label;
          const inp = document.createElement("input");
          inp.type = "number";
          inp.className = "char-cfg-input";
          inp.min = String(min);
          inp.max = String(max);
          inp.step = String(step);
          inp.value = val.toFixed(step < 0.1 ? 2 : 0);
          inp.addEventListener("input", () => {
            const v = parseFloat(inp.value);
            if (!isNaN(v)) onChange(v);
          });
          row.appendChild(lbl);
          row.appendChild(inp);
          charCfgSection.appendChild(row);
        }

        makeCharCfgRow("Scale X", charConfig.scaleX, 0.01, 10, 0.01, (v) => {
          charConfig.scaleX = v;
          anim.scale.x = v;
          persistCharConfig();
        });
        makeCharCfgRow("Scale Y", charConfig.scaleY, 0.01, 10, 0.01, (v) => {
          charConfig.scaleY = v;
          anim.scale.y = v;
          persistCharConfig();
        });
        makeCharCfgRow("Anchor X", charConfig.anchorX, 0, 1, 0.01, (v) => {
          charConfig.anchorX = v;
          anim.anchor.x = v;
          repositionStage();
          persistCharConfig();
        });
        makeCharCfgRow("Anchor Y", charConfig.anchorY, 0, 1, 0.01, (v) => {
          charConfig.anchorY = v;
          anim.anchor.y = v;
          repositionStage();
          persistCharConfig();
        });

        const tintRow = document.createElement("div");
        tintRow.className = "char-cfg-row";
        const tintLbl = document.createElement("span");
        tintLbl.className = "char-cfg-label";
        tintLbl.textContent = "Tint";
        const tintInp = document.createElement("input");
        tintInp.type = "color";
        tintInp.className = "config-color-input";
        tintInp.value = "#" + charConfig.tint.toString(16).padStart(6, "0");
        tintInp.addEventListener("input", () => {
          const hex = parseInt(tintInp.value.replace("#", ""), 16);
          if (!isNaN(hex)) {
            charConfig.tint = hex;
            anim.tint = hex;
            persistCharConfig();
          }
        });
        tintRow.appendChild(tintLbl);
        tintRow.appendChild(tintInp);
        charCfgSection.appendChild(tintRow);
      }

      renderCharConfig();

      const subTabBar = document.createElement("div");
      subTabBar.className = "sub-tab-bar";
      const animTabBtn = document.createElement("button");
      animTabBtn.className = "sub-tab active";
      animTabBtn.textContent = "Animations";
      const actionsTabBtn = document.createElement("button");
      actionsTabBtn.className = "sub-tab";
      actionsTabBtn.textContent = "Actions";
      subTabBar.appendChild(animTabBtn);
      subTabBar.appendChild(actionsTabBtn);
      animPanel.appendChild(subTabBar);

      const animList = document.createElement("div");
      animList.className = "anim-list";
      animPanel.appendChild(animList);

      // --- Add Animation: upload a video + name -> POST /api/animation, which
      // runs the add_animation.py pipeline (writes the spritesheet PNG, the
      // catalog row, and a character_animations row for the active character).
      // On success we reload so the new frames load and resolveCharAnimKeys
      // picks up the freshly-seeded kit.
      let animTabActive = true;
      const animAddForm = document.createElement("div");
      animAddForm.className = "anim-add-form";

      const animFileLabel = document.createElement("label");
      animFileLabel.className = "anim-file-label";
      const animFileInput = document.createElement("input");
      animFileInput.type = "file";
      animFileInput.accept = "video/*";
      animFileInput.className = "anim-file-input";
      const animFileText = document.createElement("span");
      animFileText.className = "anim-file-text";
      animFileText.textContent = "Choose video…";
      animFileLabel.appendChild(animFileInput);
      animFileLabel.appendChild(animFileText);

      const animNameRow = document.createElement("div");
      animNameRow.className = "anim-name-row";
      const animNameInput = document.createElement("input");
      animNameInput.type = "text";
      animNameInput.className = "char-new-input";
      animNameInput.placeholder = "Animation name";
      const animAddBtn = document.createElement("button");
      animAddBtn.className = "char-add-btn";
      animAddBtn.textContent = "Add";
      animNameRow.appendChild(animNameInput);
      animNameRow.appendChild(animAddBtn);

      const animAddStatus = document.createElement("div");
      animAddStatus.className = "anim-add-status";

      animAddForm.appendChild(animFileLabel);
      animAddForm.appendChild(animNameRow);
      animAddForm.appendChild(animAddStatus);
      animPanel.appendChild(animAddForm);

      function updateAnimAddVisibility() {
        animAddForm.style.display = CHARACTER && animTabActive ? "flex" : "none";
      }

      function setAnimStatus(msg: string, kind: "" | "busy" | "ok" | "err") {
        animAddStatus.textContent = msg;
        animAddStatus.className = "anim-add-status" + (kind ? " " + kind : "");
      }

      animFileInput.addEventListener("change", () => {
        animFileText.textContent =
          animFileInput.files?.[0]?.name ?? "Choose video…";
      });

      // Hot-load a single freshly-created spritesheet into the running catalog
      // (mirrors the init loader at the top of this effect) so a new animation
      // shows up without a full page reload. Returns the new catalog index, or
      // -1 if frames couldn't be built (caller falls back to a reload).
      async function loadAnimationLive(
        row: Pick<CatalogEntry, "key" | "label" | "image" | "frameData">,
        seedDuration: number | null,
      ): Promise<number> {
        if (!row.image || !row.frameData) return -1;
        const texture = (await Assets.load(`/assets/${row.image}`)) as PixiTexture;
        if (destroyed) return -1;
        const sheet = new Spritesheet(texture, row.frameData);
        await sheet.parse();
        const frames = Object.keys(sheet.data.frames).map(
          (n: string) => sheet.textures[n],
        );
        if (frames.length === 0) return -1;
        const duration = seedDuration ?? frames.length / SOURCE_FPS;
        const entry = {
          label: row.label,
          configKey: row.key,
          frames,
          config: { duration, loop: true, alpha: 1, rotation: 0 },
        };
        const existing = animations.findIndex((a) => a.configKey === row.key);
        if (existing >= 0) animations[existing] = entry;
        else animations.push(entry);
        // Seed the active character's kit so resolveCharAnimKeys (seed wins)
        // includes the new key in the list, dropdowns, and on the canvas.
        if (!allFileConfigs[CHARACTER])
          allFileConfigs[CHARACTER] = { animations: {} };
        allFileConfigs[CHARACTER].animations[row.key] = { duration, loop: true };
        // The blank-marker blob ([]) is now superseded by a real seed row; drop
        // it so it isn't re-persisted as misleading empty state.
        const blob = serverConfig.characterAnimations;
        if (blob && Array.isArray(blob[CHARACTER]) && blob[CHARACTER].length === 0)
          delete blob[CHARACTER];
        return animations.findIndex((a) => a.configKey === row.key);
      }

      async function submitAnimation() {
        if (!CHARACTER) return;
        const file = animFileInput.files?.[0];
        const name = slugify(animNameInput.value.trim(), "");
        if (!file) {
          setAnimStatus("Choose a video file first.", "err");
          return;
        }
        if (!name) {
          setAnimStatus("Enter an animation name.", "err");
          return;
        }
        const fd = new FormData();
        fd.append("video", file);
        fd.append("name", name);
        fd.append("character", CHARACTER);
        animAddBtn.disabled = true;
        animFileInput.disabled = true;
        setAnimStatus("Processing video… this can take a few seconds.", "busy");
        try {
          const res = await fetch("/api/animation", {
            method: "POST",
            body: fd,
          });
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            key?: string;
            animation?: Pick<
              CatalogEntry,
              "key" | "label" | "image" | "frameData"
            > | null;
            seed?: { duration?: number; loop?: boolean } | null;
          };
          if (!res.ok || !data.ok) {
            throw new Error(data.error || `Failed (${res.status})`);
          }
          const idx = data.animation
            ? await loadAnimationLive(
                data.animation,
                data.seed?.duration ?? null,
              )
            : -1;
          if (idx < 0) {
            // Frames couldn't be hot-loaded — fall back to a full refresh.
            setAnimStatus("Added — refreshing…", "ok");
            window.location.reload();
            return;
          }
          animAddBtn.disabled = false;
          animFileInput.disabled = false;
          animFileInput.value = "";
          animNameInput.value = "";
          animFileText.textContent = "Choose video…";
          setAnimStatus("Added.", "ok");
          updateEmptyHint();
          switchTo(idx);
        } catch (err) {
          setAnimStatus(
            err instanceof Error ? err.message : "Something went wrong.",
            "err",
          );
          animAddBtn.disabled = false;
          animFileInput.disabled = false;
        }
      }

      animAddBtn.addEventListener("click", submitAnimation);
      animNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitAnimation();
      });

      const actionListContainer = document.createElement("div");
      actionListContainer.className = "action-list-container";
      actionListContainer.style.display = "none";
      const actionsList = document.createElement("div");
      actionsList.className = "actions-list";
      actionListContainer.appendChild(actionsList);
      const actionNewForm = document.createElement("div");
      actionNewForm.className = "char-new-form";
      const actionNewInput = document.createElement("input");
      actionNewInput.type = "text";
      actionNewInput.className = "char-new-input";
      actionNewInput.placeholder = "Action name";
      const actionAddBtn = document.createElement("button");
      actionAddBtn.className = "char-add-btn";
      actionAddBtn.textContent = "Add";
      actionNewForm.appendChild(actionNewInput);
      actionNewForm.appendChild(actionAddBtn);
      actionListContainer.appendChild(actionNewForm);
      animPanel.appendChild(actionListContainer);
      container.appendChild(animPanel);

      function renderAnimList() {
        updateAnimAddVisibility();
        if (!CHARACTER) {
          animPanelTitle.textContent = "No character";
          animList.innerHTML = "";
          return;
        }
        const kit = resolveCharAnimKeys(CHARACTER);
        animPanelTitle.textContent =
          characters.find((c: { id: string }) => c.id === CHARACTER)?.name ??
          CHARACTER;
        animList.innerHTML = "";
        animations.forEach((def, i) => {
          if (kit && !kit.includes(def.configKey)) return;
          const row = document.createElement("div");
          row.className = "anim-row" + (i === currentIndex ? " active" : "");
          const nameSpan = document.createElement("span");
          nameSpan.className = "anim-row-name";
          nameSpan.textContent = def.label;
          row.appendChild(nameSpan);
          animList.appendChild(row);
          row.addEventListener("click", () => switchTo(i));
        });
      }

      function renderActionList() {
        const charActions = getCharacterActions();
        actionsList.innerHTML = "";
        charActions.forEach((action) => {
          const row = document.createElement("div");
          row.className =
            "action-row" + (action.id === selectedActionId ? " active" : "");

          const nameSpan = document.createElement("span");
          nameSpan.className = "action-row-name";
          nameSpan.textContent = action.name;

          const countSpan = document.createElement("span");
          countSpan.className = "action-row-count";
          countSpan.textContent = `${action.steps.length} step${action.steps.length !== 1 ? "s" : ""}`;

          const editBtn = document.createElement("button");
          editBtn.className = "char-action-btn";
          editBtn.textContent = "✎";
          editBtn.title = "Rename action";

          const delBtn = document.createElement("button");
          delBtn.className = "char-action-btn";
          delBtn.textContent = "×";
          delBtn.title = "Delete action";

          const rowBtns = document.createElement("div");
          rowBtns.className = "char-row-actions";
          rowBtns.appendChild(editBtn);
          rowBtns.appendChild(delBtn);

          editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const inp = document.createElement("input");
            inp.type = "text";
            inp.className = "char-rename-input";
            inp.value = action.name;
            row.replaceChild(inp, nameSpan);
            inp.focus();
            inp.select();
            let committed = false;
            function commit() {
              if (committed) return;
              committed = true;
              const newName = inp.value.trim();
              if (newName && newName !== action.name) {
                action.name = newName;
                saveActions(
                  getCharacterActions().map((a) =>
                    a.id === action.id ? action : a,
                  ),
                );
                if (selectedActionId === action.id) renderActionEditor(action);
              }
              renderActionList();
            }
            inp.addEventListener("blur", commit);
            inp.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") commit();
              if (ev.key === "Escape") {
                committed = true;
                renderActionList();
              }
            });
          });

          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = charActions.findIndex((a) => a.id === action.id);
            charActions.splice(idx, 1);
            saveActions(charActions);
            if (selectedActionId === action.id) {
              selectedActionId = null;
              showPlaybackPanel();
            }
            renderActionList();
          });

          row.appendChild(nameSpan);
          row.appendChild(countSpan);
          row.appendChild(rowBtns);
          actionsList.appendChild(row);

          row.addEventListener("click", (e) => {
            if (rowBtns.contains(e.target as Node)) return;
            if (row.querySelector(".char-rename-input")) return;
            selectedActionId = action.id;
            if (!panelOpen) {
              panelOpen = true;
              panel.classList.add("open");
              gearBtn.classList.add("panel-open");
            }
            renderActionEditor(action);
            renderActionList();
            if (action.steps.length > 0) previewAction(action.steps);
          });
        });
      }

      function addAction() {
        const name = actionNewInput.value.trim();
        if (!name) return;
        const charActions = getCharacterActions();
        const base = slugify(name, "action");
        let id = base;
        let n = 2;
        while (charActions.find((a) => a.id === id)) {
          id = `${base}-${n}`;
          n++;
        }
        charActions.push({ id, name, steps: [] });
        saveActions(charActions);
        actionNewInput.value = "";
        renderActionList();
      }

      actionAddBtn.addEventListener("click", addAction);
      actionNewInput.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") addAction();
      });

      let charPanelOpen = true;
      charPanel.classList.add("open");
      charBtn.classList.add("panel-open");
      animPanel.classList.add("open");
      charBtn.classList.add("anim-open");
      charBtn.style.display = "none";

      function doToggleCharPanel() {
        charPanelOpen = !charPanelOpen;
        charPanel.classList.toggle("open", charPanelOpen);
        charBtn.classList.toggle("panel-open", charPanelOpen);
        animPanel.classList.toggle("open", charPanelOpen);
        charBtn.classList.toggle("anim-open", charPanelOpen);
        canvasWrapper.style.left = charPanelOpen ? DUAL_PANEL_W : "0px";
        setTimeout(() => {
          if (!destroyed) repositionStage();
        }, 300);
      }

      charBtn.addEventListener("click", doToggleCharPanel);
      toggleCharPanelRef.current = doToggleCharPanel;

      animTabBtn.addEventListener("click", () => {
        animTabBtn.classList.add("active");
        actionsTabBtn.classList.remove("active");
        animList.style.display = "";
        actionListContainer.style.display = "none";
        animTabActive = true;
        updateAnimAddVisibility();
        previewCancelled = true;
        selectedActionId = null;
        showPlaybackPanel();
      });

      actionsTabBtn.addEventListener("click", () => {
        actionsTabBtn.classList.add("active");
        animTabBtn.classList.remove("active");
        animList.style.display = "none";
        actionListContainer.style.display = "";
        animTabActive = false;
        updateAnimAddVisibility();
        renderActionList();
      });

      function renderCharacterList() {
        charList.innerHTML = "";
        characters.forEach((char: { id: string; name: string }) => {
          const row = document.createElement("div");
          row.className = "char-row" + (char.id === CHARACTER ? " active" : "");

          const nameSpan = document.createElement("span");
          nameSpan.className = "char-row-name";
          nameSpan.textContent = char.name;

          const rowActions = document.createElement("div");
          rowActions.className = "char-row-actions";

          const editBtn = document.createElement("button");
          editBtn.className = "char-action-btn";
          editBtn.textContent = "✎";
          editBtn.title = "Rename";

          const deleteBtn = document.createElement(
            "button",
          ) as HTMLButtonElement;
          deleteBtn.className = "char-action-btn";
          deleteBtn.textContent = "×";
          deleteBtn.title = "Delete";

          const dupBtn = document.createElement("button");
          dupBtn.className = "char-action-btn";
          dupBtn.textContent = "⧉";
          dupBtn.title = "Duplicate";
          dupBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            duplicateCharacter(char);
          });
          rowActions.appendChild(editBtn);
          rowActions.appendChild(dupBtn);
          rowActions.appendChild(deleteBtn);
          row.appendChild(nameSpan);
          row.appendChild(rowActions);
          charList.appendChild(row);

          row.addEventListener("click", (e) => {
            if (rowActions.contains(e.target as Node)) return;
            if (row.querySelector(".char-rename-input")) return;
            if (char.id !== CHARACTER) switchCharacter(char.id);
          });

          editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const inp = document.createElement("input");
            inp.type = "text";
            inp.className = "char-rename-input";
            inp.value = char.name;
            row.replaceChild(inp, nameSpan);
            inp.focus();
            inp.select();
            let committed = false;
            function commit() {
              if (committed) return;
              committed = true;
              const newName = inp.value.trim();
              if (newName && newName !== char.name) {
                char.name = newName;
                saveCharacters(characters);
              }
              renderCharacterList();
            }
            inp.addEventListener("blur", commit);
            inp.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter") commit();
              if (ev.key === "Escape") {
                committed = true;
                renderCharacterList();
              }
            });
          });

          deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = characters.findIndex(
              (c: { id: string }) => c.id === char.id,
            );
            if (idx === -1) return;
            characters.splice(idx, 1);
            // Persist removal: clears the character's seed rows + prunes the
            // blob server-side, so it does not reappear on reload.
            serverConfig.characters = characters;
            if (serverConfig.animationConfigs)
              delete serverConfig.animationConfigs[char.id];
            if (serverConfig.actions) delete serverConfig.actions[char.id];
            if (serverConfig.characterConfigs)
              delete serverConfig.characterConfigs[char.id];
            if (serverConfig.characterAnimations)
              delete serverConfig.characterAnimations[char.id];
            delete allFileConfigs[char.id];
            fetch(`/api/config?character=${encodeURIComponent(char.id)}`, {
              method: "DELETE",
            }).catch(() => {});
            if (CHARACTER === char.id) {
              if (characters.length > 0) {
                switchCharacter(characters[Math.max(0, idx - 1)].id);
              } else {
                enterEmptyState();
              }
            } else {
              renderCharacterList();
            }
          });
        });
      }

      function switchCharacter(id: string) {
        previewCancelled = true;
        selectedActionId = null;
        showPlaybackPanel();

        CHARACTER = id;
        charConfig = defaultCharConfig();
        const savedCC = serverConfig.characterConfigs?.[CHARACTER];
        if (savedCC) charConfig = { ...charConfig, ...savedCC };
        serverConfig.activeCharacter = id;
        fileDefaults = allFileConfigs[CHARACTER]?.animations ?? {};
        const newSaved = (serverConfig.animationConfigs?.[id] ??
          {}) as Record<string, Partial<AnimConfig>>;

        animations.forEach((def) => {
          const fd =
            (fileDefaults as Record<string, Partial<AnimConfig>>)[
              def.configKey
            ] ?? {};
          const sv = newSaved[def.configKey] ?? {};
          def.config = {
            duration:
              sv.duration ?? fd.duration ?? def.frames.length / SOURCE_FPS,
            loop: sv.loop ?? fd.loop ?? true,
            alpha: sv.alpha ?? 1,
            rotation: sv.rotation ?? 0,
          };
        });

        const kit = resolveCharAnimKeys(id);
        if (kit && kit.length > 0) {
          const idx = animations.findIndex((def) =>
            kit.includes(def.configKey),
          );
          if (idx !== -1) currentIndex = idx;
        }

        renderPlaybackPanel(currentIndex);
        applyAnimation(currentIndex);
        renderCharacterList();
        animPanel.classList.add("open");
        charBtn.classList.add("anim-open");
        renderCharConfig();
        renderAnimList();
        updateEmptyHint();
      }

      function enterEmptyState() {
        previewCancelled = true;
        selectedActionId = null;
        showPlaybackPanel();
        CHARACTER = "";
        serverConfig.activeCharacter = "";
        charConfig = defaultCharConfig();
        fileDefaults = {};
        anim.stop();
        playbackContent.innerHTML = "";
        panelTitle.textContent = "Playback Settings";
        renderCharacterList();
        renderCharConfig();
        renderAnimList();
        updateEmptyHint();
      }

      function uniqueId(base: string): string {
        if (!characters.find((c: { id: string }) => c.id === base)) return base;
        let n = 2;
        while (characters.find((c: { id: string }) => c.id === `${base}-${n}`))
          n++;
        return `${base}-${n}`;
      }

      function addCharacter() {
        const name = charNewInput.value.trim();
        if (!name) return;
        const id = uniqueId(slugify(name));
        characters.push({ id, name });
        // New characters start with no animations — they must not inherit the
        // catalog. Persist an explicit empty kit so it stays blank on reload.
        if (!serverConfig.characterAnimations)
          serverConfig.characterAnimations = {};
        serverConfig.characterAnimations[id] = [];
        saveCharacters(characters);
        charNewInput.value = "";
        switchCharacter(id);
      }

      function duplicateCharacter(char: { id: string; name: string }) {
        let newName = `${char.name} Copy`;
        if (
          characters.find(
            (c: { id: string; name: string }) => c.name === newName,
          )
        ) {
          let n = 2;
          while (
            characters.find(
              (c: { id: string; name: string }) =>
                c.name === `${char.name} Copy ${n}`,
            )
          )
            n++;
          newName = `${char.name} Copy ${n}`;
        }
        const newId = uniqueId(slugify(newName));
        if (allFileConfigs[char.id])
          allFileConfigs[newId] = JSON.parse(
            JSON.stringify(allFileConfigs[char.id]),
          );
        const srcAnimKeys =
          serverConfig.characterAnimations?.[char.id] ??
          Object.keys(allFileConfigs[char.id]?.animations ?? {});
        // Always copy the kit (even when empty) so duplicating a blank
        // character produces a blank character.
        if (!serverConfig.characterAnimations)
          serverConfig.characterAnimations = {};
        serverConfig.characterAnimations[newId] = [...srcAnimKeys];
        if (serverConfig.characterConfigs?.[char.id]) {
          if (!serverConfig.characterConfigs)
            serverConfig.characterConfigs = {};
          serverConfig.characterConfigs[newId] = {
            ...serverConfig.characterConfigs[char.id],
          };
        }
        if (serverConfig.animationConfigs?.[char.id]) {
          serverConfig.animationConfigs[newId] = JSON.parse(
            JSON.stringify(serverConfig.animationConfigs[char.id]),
          );
        }
        if (serverConfig.actions?.[char.id]) {
          serverConfig.actions[newId] = JSON.parse(
            JSON.stringify(serverConfig.actions[char.id]),
          );
        }
        characters.push({ id: newId, name: newName });
        saveCharacters(characters);
        switchCharacter(newId);
      }

      charAddBtn.addEventListener("click", addCharacter);
      charNewInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addCharacter();
      });

      renderCharacterList();
      renderAnimList();

      // --- Battle Data panel (CMS: stats / event-role→Action / skills) ---
      // Management surface for the mock-battle feature. Reads the bootstrap
      // keys Lane B surfaces on GET /api/config (battleStats + roleMaps) and
      // writes via POST /api/config/battle { characterId, stats?, roles? }.
      const BATTLE_ROLES: BattleEventRole[] = [
        "idle",
        "move",
        "attack",
        "hit",
        "death",
      ];
      const KNOWN_SKILLS: Array<{ id: string; name: string }> = [
        { id: "shield_bash", name: "Shield Bash" },
      ];

      // Mutable working copies seeded from the bootstrap payload. Row handlers
      // mutate these in place; Save sends the live object back.
      const battleStatsState: Record<string, UnitStats> = {
        ...(bootstrap.battleStats ?? {}),
      };
      const roleMapsState: Record<string, CharacterRoleMap> = {
        ...(bootstrap.roleMaps ?? {}),
      };

      // Normalize + store the live stats/roles object for a character (created
      // on first view so Save always has a complete object to send). Called
      // once per render; row handlers then mutate the returned object directly.
      function getStats(id: string): UnitStats {
        const s = battleStatsState[id];
        const stats: UnitStats = {
          hp: s?.hp ?? 100,
          attack: s?.attack ?? 10,
          defense: s?.defense ?? 0,
          actionSpeed: s?.actionSpeed ?? 100,
          range: s?.range ?? 1,
          skills: Array.isArray(s?.skills) ? [...s!.skills] : [],
        };
        battleStatsState[id] = stats;
        return stats;
      }

      function getRoles(id: string): CharacterRoleMap {
        const roles: CharacterRoleMap = { ...(roleMapsState[id] ?? {}) };
        roleMapsState[id] = roles;
        return roles;
      }

      // The role→Action dropdowns offer THIS character's authored Actions — the
      // same per-character actions array the studio Action editor edits
      // (serverConfig.actions[charId]; cf. getCharacterActions()).
      function getActionsForChar(
        id: string,
      ): Array<{ id: string; name: string }> {
        const raw = serverConfig.actions?.[id] ?? [];
        return raw
          .filter((a) => a && typeof a.id === "string")
          .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) }));
      }

      // Raw Animation catalog keys available to a character — same source the
      // studio's Action editor uses (resolveCharAnimKeys: the character's own
      // kit, or the full catalog when none is defined), intersected with catalog
      // rows that actually loaded frames so each key resolves to a label.
      function getAnimationsForChar(
        id: string,
      ): Array<{ key: string; label: string }> {
        const keys =
          resolveCharAnimKeys(id) ?? animations.map((a) => a.configKey);
        const out: Array<{ key: string; label: string }> = [];
        const seen = new Set<string>();
        keys.forEach((key) => {
          if (seen.has(key)) return;
          const def = animations.find((a) => a.configKey === key);
          if (!def) return;
          seen.add(key);
          out.push({ key, label: def.label });
        });
        return out;
      }

      function saveBattle(body: {
        characterId: string;
        stats?: UnitStats;
        roles?: CharacterRoleMap;
      }) {
        fetch("/api/config/battle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {});
      }

      function flashSaved(btn: HTMLButtonElement) {
        const original = btn.textContent;
        btn.textContent = "Saved ✓";
        btn.classList.add("battle-saved");
        setTimeout(() => {
          if (destroyed) return;
          btn.textContent = original;
          btn.classList.remove("battle-saved");
        }, 1200);
      }

      const battlePanel = document.createElement("div");
      battlePanel.className = "battle-panel";

      const battleTitle = document.createElement("div");
      battleTitle.className = "config-panel-title";
      battleTitle.textContent = "Battle Data";
      battlePanel.appendChild(battleTitle);

      const battleCharRow = document.createElement("div");
      battleCharRow.className = "battle-char-row";
      const battleCharLabel = document.createElement("span");
      battleCharLabel.className = "config-label";
      battleCharLabel.textContent = "Character";
      const battleCharSelect = document.createElement("select");
      battleCharSelect.className = "battle-select";
      battleCharRow.appendChild(battleCharLabel);
      battleCharRow.appendChild(battleCharSelect);
      battlePanel.appendChild(battleCharRow);

      const battleContent = document.createElement("div");
      battleContent.className = "battle-content";
      battlePanel.appendChild(battleContent);

      // Rebuilt on open so added/renamed/deleted characters stay in sync.
      function populateBattleCharSelect() {
        const prev = battleCharSelect.value;
        battleCharSelect.innerHTML = "";
        characters.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.name;
          battleCharSelect.appendChild(opt);
        });
        if (characters.find((c) => c.id === prev)) {
          battleCharSelect.value = prev;
        } else if (characters.find((c) => c.id === CHARACTER)) {
          battleCharSelect.value = CHARACTER;
        }
      }

      function makeBattleNumRow(
        label: string,
        val: number,
        min: number,
        max: number,
        step: number,
        onChange: (v: number) => void,
      ) {
        const row = document.createElement("div");
        row.className = "battle-row";
        const lbl = document.createElement("span");
        lbl.className = "battle-row-label";
        lbl.textContent = label;
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "battle-input";
        inp.min = String(min);
        inp.max = String(max);
        inp.step = String(step);
        inp.value = String(val);
        inp.addEventListener("input", () => {
          const v = parseFloat(inp.value);
          if (!isNaN(v)) onChange(v);
        });
        row.appendChild(lbl);
        row.appendChild(inp);
        battleContent.appendChild(row);
      }

      function addBattleSectionTitle(text: string) {
        const t = document.createElement("div");
        t.className = "config-section-title";
        t.textContent = text;
        battleContent.appendChild(t);
      }

      function makeBattleSaveBtn(text: string, onSave: () => void) {
        const btn = document.createElement("button");
        btn.className = "battle-save-btn";
        btn.textContent = text;
        btn.addEventListener("click", () => {
          onSave();
          flashSaved(btn);
        });
        battleContent.appendChild(btn);
        return btn;
      }

      function renderBattlePanel(id: string) {
        battleContent.innerHTML = "";
        if (!id) {
          const empty = document.createElement("div");
          empty.className = "ae-empty";
          empty.textContent = "No character selected.";
          battleContent.appendChild(empty);
          return;
        }

        // Live objects the row handlers mutate; Save closes over these.
        const stats = getStats(id);
        const roles = getRoles(id);

        // 1) Battle stats — bounds from STAT_BOUNDS (the route clamps too).
        addBattleSectionTitle("Battle Stats");
        makeBattleNumRow("HP", stats.hp, STAT_BOUNDS.hp.min, STAT_BOUNDS.hp.max, 1, (v) => {
          stats.hp = v;
        });
        makeBattleNumRow("Attack", stats.attack, STAT_BOUNDS.attack.min, STAT_BOUNDS.attack.max, 1, (v) => {
          stats.attack = v;
        });
        makeBattleNumRow("Defense", stats.defense, STAT_BOUNDS.defense.min, STAT_BOUNDS.defense.max, 1, (v) => {
          stats.defense = v;
        });
        makeBattleNumRow("Action Speed", stats.actionSpeed, STAT_BOUNDS.actionSpeed.min, STAT_BOUNDS.actionSpeed.max, 1, (v) => {
          stats.actionSpeed = v;
        });
        makeBattleNumRow("Range", stats.range, STAT_BOUNDS.range.min, STAT_BOUNDS.range.max, 1, (v) => {
          stats.range = v;
        });
        makeBattleSaveBtn("Save Stats", () =>
          saveBattle({ characterId: id, stats }),
        );

        // 2) Event role → Action / Animation mapping. Each dropdown offers the
        //    character's authored Actions AND the raw Animation catalog keys
        //    available to it (grouped in optgroups). The stored value is a
        //    plain id/key string the replayer resolves (Action-id →
        //    animation-key → inference → base-pose), so no encoding is needed.
        addBattleSectionTitle("Event Roles → Actions");
        const charActions = getActionsForChar(id);
        const charAnims = getAnimationsForChar(id);
        BATTLE_ROLES.forEach((role) => {
          const row = document.createElement("div");
          row.className = "battle-row";
          const lbl = document.createElement("span");
          lbl.className = "battle-row-label";
          lbl.textContent = role;
          const sel = document.createElement("select");
          sel.className = "battle-select";
          const noneOpt = document.createElement("option");
          noneOpt.value = "";
          noneOpt.textContent = "(none → fallback)";
          sel.appendChild(noneOpt);
          if (charActions.length > 0) {
            const grp = document.createElement("optgroup");
            grp.label = "Actions";
            charActions.forEach((a) => {
              const opt = document.createElement("option");
              opt.value = a.id;
              opt.textContent = a.name;
              grp.appendChild(opt);
            });
            sel.appendChild(grp);
          }
          if (charAnims.length > 0) {
            const grp = document.createElement("optgroup");
            grp.label = "Animations";
            charAnims.forEach((a) => {
              const opt = document.createElement("option");
              opt.value = a.key;
              opt.textContent = a.label;
              grp.appendChild(opt);
            });
            sel.appendChild(grp);
          }
          sel.value = roles[role] ?? "";
          sel.addEventListener("change", () => {
            if (sel.value) roles[role] = sel.value;
            else delete roles[role];
          });
          row.appendChild(lbl);
          row.appendChild(sel);
          battleContent.appendChild(row);
        });
        if (charActions.length === 0 && charAnims.length === 0) {
          const hint = document.createElement("div");
          hint.className = "battle-hint";
          hint.textContent =
            "No Actions or Animations available for this character; roles fall back until some exist.";
          battleContent.appendChild(hint);
        }
        makeBattleSaveBtn("Save Roles", () =>
          saveBattle({ characterId: id, roles }),
        );

        // 3) Skill assignment — persisted inside stats.skills.
        addBattleSectionTitle("Skills");
        KNOWN_SKILLS.forEach((skill) => {
          const row = document.createElement("div");
          row.className = "battle-row";
          const lbl = document.createElement("span");
          lbl.className = "battle-row-label";
          lbl.textContent = skill.name;
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "toggle-switch";
          const inp = document.createElement("input");
          inp.type = "checkbox";
          inp.checked = stats.skills.includes(skill.id);
          const track = document.createElement("span");
          track.className = "toggle-track";
          toggleLabel.appendChild(inp);
          toggleLabel.appendChild(track);
          inp.addEventListener("change", () => {
            const has = stats.skills.includes(skill.id);
            if (inp.checked && !has) stats.skills.push(skill.id);
            else if (!inp.checked && has)
              stats.skills = stats.skills.filter((s) => s !== skill.id);
          });
          row.appendChild(lbl);
          row.appendChild(toggleLabel);
          battleContent.appendChild(row);
        });
        makeBattleSaveBtn("Save Skills", () =>
          saveBattle({ characterId: id, stats }),
        );
      }

      battleCharSelect.addEventListener("change", () => {
        renderBattlePanel(battleCharSelect.value);
      });

      container.appendChild(battlePanel);

      let battlePanelOpen = false;
      function doToggleBattlePanel(): boolean {
        battlePanelOpen = !battlePanelOpen;
        if (battlePanelOpen) {
          populateBattleCharSelect();
          renderBattlePanel(battleCharSelect.value);
        }
        battlePanel.classList.toggle("open", battlePanelOpen);
        return battlePanelOpen;
      }
      toggleBattlePanelRef.current = doToggleBattlePanel;

      // First paint: currentIndex was resolved from the active character's kit
      // before the sprite was created (applyAnimation already painted it), and
      // renderAnimList already ran — just populate the playback panel to match.
      if (CHARACTER && animations.length > 0) {
        renderPlaybackPanel(currentIndex);
      }
    }

    init().catch(console.error);

    return () => {
      destroyed = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (pixiApp) {
        try {
          pixiApp.destroy();
        } catch {
          /* ignore */
        }
      }
      if (injectedStyle?.parentNode)
        injectedStyle.parentNode.removeChild(injectedStyle);
      container.innerHTML = "";
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
      }}
    >
      <nav className="menu-bar">
        <button
          className="menu-bar-item"
          onClick={() => toggleCharPanelRef.current?.()}
        >
          Characters
        </button>
        <button
          className="menu-bar-item"
          onClick={(e) =>
            e.currentTarget.classList.toggle(
              "active",
              !!toggleBattlePanelRef.current?.(),
            )
          }
        >
          Battle
        </button>
        <a className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
        </a>
      </nav>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative" }}
      />
    </div>
  );
}
