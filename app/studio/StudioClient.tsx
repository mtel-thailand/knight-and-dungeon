"use client";

import { useEffect, useRef } from "react";
import type {
  Application as PixiApplication,
  Texture as PixiTexture,
} from "pixi.js";
import type {
  HexPosition,
  UnitStats,
  CharacterRoleMap,
  SpellDef,
  MapConfig,
} from "@/lib/battle/types";
import { BOARD, DEFAULT_MAP_CONFIG, STAT_BOUNDS } from "@/lib/battle/types";
import {
  SOURCE_FPS,
  TICKER_FPS,
  PREVIEW_TICK_MS,
  PANEL_W,
  DUAL_PANEL_W,
  DEFAULT_CHARACTER,
} from "./studioConstants";
import { STUDIO_CSS } from "./studioStyles";
import {
  slugify,
  getHexRowsFromCounts,
  defaultCharConfig,
} from "./studioHelpers";
import { createStudioBattlePanel } from "./studioBattlePanel";
import { createBattleBoard } from "./mock-battle/battleBoard";
import { GSS_CSS } from "./mock-battle/GameScreenShell";
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
        Container,
        Graphics,
        Spritesheet,
        Texture,
      } = await import("pixi.js");

      if (destroyed) return;

      const canvasWrapper = document.createElement("div");
      canvasWrapper.style.cssText = `position: absolute; top: 0; bottom: 0; left: ${DUAL_PANEL_W}; right: ${PANEL_W};`;
      container.appendChild(canvasWrapper);

      // Build the game-screen shell frame inside canvasWrapper: the same 9:19.5
      // portrait frame + dungeon bg/video/scrim/vignette as the mock-battle game
      // screen. Pixi renders into the square center field.
      const gssRoot = canvasWrapper.appendChild(document.createElement("div"));
      gssRoot.className = "gss-root";
      const gssFrame = gssRoot.appendChild(document.createElement("div"));
      gssFrame.className = "gss-frame";
      gssFrame.appendChild(document.createElement("div")).className = "gss-zone gss-zone-top";
      const gssCenter = gssFrame.appendChild(document.createElement("div"));
      gssCenter.className = "gss-center";

      const gssField = gssCenter.appendChild(document.createElement("div"));
      gssField.className = "gss-center-field";
      gssField.style.backgroundImage = 'url("/assets/dungeon-bg.png")';
      gssField.style.backgroundSize = "cover";
      gssField.style.backgroundPosition = "center";
      gssField.style.backgroundRepeat = "no-repeat";

      const gssVideo = gssField.appendChild(document.createElement("video"));
      gssVideo.className = "gss-center-video";
      gssVideo.src = "/assets/dungeon-bg.mp4";
      gssVideo.poster = "/assets/dungeon-bg.png";
      gssVideo.autoplay = true;
      gssVideo.muted = true;
      gssVideo.loop = true;
      gssVideo.playsInline = true;
      gssVideo.preload = "auto";

      const gssScrim = gssField.appendChild(document.createElement("div"));
      gssScrim.className = "gss-center-scrim";

      const gssContent = gssField.appendChild(document.createElement("div"));
      gssContent.className = "gss-center-content";

      // Pixi host fills the square center field (inside gss-center-content).
      const pixiHost = gssContent.appendChild(document.createElement("div"));
      pixiHost.style.cssText = "position:absolute; inset:0;";

      gssFrame.appendChild(document.createElement("div")).className = "gss-zone gss-zone-bottom";

      // --- Styles --- Inject BEFORE pixiApp.init so the GSS frame CSS is applied
      // and pixiHost (absolute inset:0) resolves to the square center field rather
      // than the wide canvasWrapper, so resizeTo reads the right size on first paint
      // (without this the board mis-sizes until a window resize fires).
      const styleTag = document.createElement("style");
      injectedStyle = styleTag;
      styleTag.textContent = STUDIO_CSS + "\n" + GSS_CSS;
      document.head.appendChild(styleTag);

      pixiApp = new Application();
      await pixiApp.init({
        resizeTo: pixiHost,
        backgroundAlpha: 0,
        antialias: true,
      });

      if (destroyed) {
        pixiApp.destroy();
        return;
      }

      pixiHost.appendChild(pixiApp.canvas);

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
        spells: [],
        characterSpells: {},
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

      const studioMapBounds = {
        tileWidth: { min: 16, max: 400 },
        tileHeightRatio: { min: 0.1, max: 1 },
        scale: { min: 0.25, max: 4 },
        rotation: { min: -180, max: 180 },
        rotationX: { min: -80, max: 80 },
        rotationY: { min: -80, max: 80 },
      } as const;

      const catalog: CatalogEntry[] = bootstrap.animations ?? [];

      // Build frame textures from each sheet's PNG (on disk) + frame data (from
      // SQLite) via Pixi's Spritesheet. A single bad/missing/oversized sheet
      // must not abort the whole studio, so failures are isolated per row.
      const framesByKey: Record<string, PixiTexture[]> = {};
      // Load every sheet's PNG + parse CONCURRENTLY — Pixi's Assets queue
      // de-dupes/parallelizes the network + decode, so first paint no longer
      // scales with catalog size (was a strictly serial await-per-row, the slow
      // part of studio startup). Failures stay isolated per row so one
      // bad/missing/oversized sheet can't abort the whole studio.
      await Promise.all(
        catalog.map(async (c) => {
          if (!c.image || !c.frameData) return;
          try {
            const texture = (await Assets.load(
              `/assets/${c.image}`,
            )) as PixiTexture;
            if (destroyed) return;
            const sheet = new Spritesheet(texture, c.frameData);
            await sheet.parse();
            framesByKey[c.key] = Object.keys(sheet.data.frames).map(
              (n: string) => sheet.textures[n],
            );
          } catch (err) {
            console.error(`Failed to load spritesheet "${c.key}":`, err);
          }
        }),
      );
      if (destroyed) {
        pixiApp.destroy();
        return;
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

      // ---- Reuse createBattleBoard from mock-battle for the tilted iso board ----
      // Build the board from the shared persisted MapConfig (read from bootstrap,
      // driven by the mock-battle's DisplayConfigPanel; the studio only READS it).
      const mapCfg: MapConfig = { ...DEFAULT_MAP_CONFIG, ...(bootstrap.mapConfig ?? {}) };
      const mapCfgRef = { current: mapCfg };
      const hexes: HexPosition[] = getHexRowsFromCounts([...BOARD.rowCounts])
        .flatMap((cols, ri) => {
          const r = ri - (BOARD.rowCounts.length - 1) / 2;
          return cols.map((q) => ({ q, r }));
        });

      // Container hierarchy: stage → viewport → board → grid + unitsLayer
      const viewport = new Container();
      pixiApp.stage.addChild(viewport);
      const board = new Container();
      viewport.addChild(board);
      const grid = new Graphics();
      board.addChild(grid);
      const unitsLayer = new Container();
      board.addChild(unitsLayer);

      const TW0 = DEFAULT_MAP_CONFIG.tileWidth; // sprite-build reference
      const BODY_H = TW0 * 1.3; // target body height in tile units (matches mock-battle)
      let bodyBaseScale = 1; // normalization factor: BODY_H / native frame height
      const boardLayout = {
        tileW: mapCfg.tileWidth,
        ratio: mapCfg.tileHeightRatio,
        boardScale: mapCfg.scale,
        rotRad: (mapCfg.rotation * Math.PI) / 180,
        rotXRad: (mapCfg.rotationX * Math.PI) / 180,
        rotYRad: (mapCfg.rotationY * Math.PI) / 180,
      };

      const sprites: Record<string, { q: number; r: number; node: any }> = {};
      const { pixelOf, centerBoard, relayout } = createBattleBoard({
        pixiApp,
        board,
        viewport,
        grid,
        sprites,
        hexes,
        TW0,
        boardLayout,
        mapCfgRef,
        MAP_BOUNDS: studioMapBounds,
      });

      // The preview sprite: a BattleBoardSprite consisting of a node (Container at a
      // hex, billboard-corrected) with `anim` as its body child. Per-character
      // transforms stay on the body; the node handles board positioning/counter-foreshorten.
      let previewQ: number = 0;
      let previewR: number = BOARD.playerRow;
      const previewNode = new Container();
      unitsLayer.addChild(previewNode);

      const anim = new AnimatedSprite(
        animations[currentIndex]?.frames ?? [Texture.EMPTY],
      );
      anim.anchor.set(0.5);
      previewNode.addChild(anim);
      sprites["preview"] = { q: previewQ, r: previewR, node: previewNode };

      // Tile position dropdown — overlaid at top-center of canvas. Uses the hex
      // array loaded from BOARD.rowCounts (same 5-6-7-6-5 set the board renders).
      const tileSelect = document.createElement("select");
      tileSelect.className = "tile-select";
      hexes.forEach((h, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `Tile ${i + 1} (q=${h.q} r=${h.r})`;
        tileSelect.appendChild(opt);
      });
      tileSelect.addEventListener("change", () => {
        const h = hexes[parseInt(tileSelect.value)];
        if (h) {
          previewQ = h.q;
          previewR = h.r;
          sprites["preview"].q = h.q;
          sprites["preview"].r = h.r;
          relayout();
        }
      });
      const mapOverlay = document.createElement("div");
      mapOverlay.className = "map-overlay";
      mapOverlay.appendChild(tileSelect);
      // Overlay the center field (above the scrim via z-index).
      gssField.appendChild(mapOverlay);

      // Paint the first sprite and apply board layout
      applyAnimation(currentIndex);
      relayout();

      // Empty-state hint shown on the canvas when there is no active character.
      const emptyHint = document.createElement("div");
      emptyHint.style.cssText =
        "position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; text-align:center; padding:0 24px; color:rgba(255,255,255,0.38); font-family:system-ui,sans-serif; font-size:14px; pointer-events:none;";
      emptyHint.textContent =
        "No character yet — add one in the left panel to begin.";
      gssField.appendChild(emptyHint);
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
      // =============================================================================
      // SECTION > SHELL: Pixi preview + character list + applyAnimation (STAYS - do not extract)
      // Seam (shell - keep): applyAnimation
      // Owner: studio-cms (E) - see app/studio/AGENTS.md
      // =============================================================================
      function applyAnimation(idx: number) {
        const def = animations[idx];
        if (!def) return;
        const cfg = def.config;
        anim.stop();
        anim.textures = def.frames;
        anim.animationSpeed = anim.totalFrames / (cfg.duration * TICKER_FPS);
        anim.loop = cfg.loop;
        // Normalize the body to the battle's tile height (BODY_H), like the
        // mock-battle's s = BODY_H / body.height; the per-character Scale X/Y
        // is a multiplier on top. frameH is the native (scale-independent)
        // frame height — prefer anim.texture.height (Pixi v8 current frame),
        // fall back to the native height recovered from the current scale.
        const frameH =
          anim.texture?.height || anim.height / (anim.scale.y || 1) || BODY_H;
        bodyBaseScale = BODY_H / frameH;
        anim.scale.set(
          bodyBaseScale * charConfig.scaleX,
          bodyBaseScale * charConfig.scaleY,
        );
        anim.anchor.set(charConfig.anchorX, charConfig.anchorY);
        anim.alpha = cfg.alpha;
        anim.rotation = (cfg.rotation * Math.PI) / 180;
        anim.tint = charConfig.tint;
        centerBoard();
        anim.play();
      }

      function switchTo(index: number) {
        currentIndex = index;
        applyAnimation(index);
        renderPlaybackPanel(currentIndex);
        renderAnimList();
      }

      resizeHandler = () => {
        centerBoard();
      };
      window.addEventListener("resize", resizeHandler);

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
          if (!destroyed) centerBoard();
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

      // =============================================================================
      // SECTION > studioActionEditor: action authoring + preview + playback panel
      // Seam (Phase 2 -> studioActionEditor.ts): renderActionEditor, previewAction, renderPlaybackPanel
      // Owner: studio-cms (E) - see app/studio/AGENTS.md
      // =============================================================================
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
          anim.scale.x = bodyBaseScale * v;
          persistCharConfig();
        });
        makeCharCfgRow("Scale Y", charConfig.scaleY, 0.01, 10, 0.01, (v) => {
          charConfig.scaleY = v;
          anim.scale.y = bodyBaseScale * v;
          persistCharConfig();
        });
        makeCharCfgRow("Anchor X", charConfig.anchorX, 0, 1, 0.01, (v) => {
          charConfig.anchorX = v;
          anim.anchor.x = v;
          persistCharConfig();
        });
        makeCharCfgRow("Anchor Y", charConfig.anchorY, 0, 1, 0.01, (v) => {
          charConfig.anchorY = v;
          anim.anchor.y = v;
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
      const spellsTabBtn = document.createElement("button");
      spellsTabBtn.className = "sub-tab";
      spellsTabBtn.textContent = "Spells";
      subTabBar.appendChild(animTabBtn);
      subTabBar.appendChild(actionsTabBtn);
      subTabBar.appendChild(spellsTabBtn);
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
      // =============================================================================
      // SECTION > studioAnimationAdd: live animation load + submit + Spells tab
      // Seam (Phase 2 -> studioAnimationAdd.ts): loadAnimationLive, submitAnimation, renderSpellsTab
      // Owner: studio-cms (E) - see app/studio/AGENTS.md
      // =============================================================================
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

      // --- Spells sub-tab: attach GLOBAL spells (the /studio/spells library) to
      // the active character. Shares characterSpellsState + the /api/config/battle
      // save path with the Battle Data panel — single source of truth, so toggles
      // here and there stay consistent in-session. Spells themselves are authored
      // on /studio/spells; this tab only owns the per-character attachment.
      const spellsListContainer = document.createElement("div");
      spellsListContainer.className = "action-list-container";
      spellsListContainer.style.display = "none";
      const spellsAttachList = document.createElement("div");
      spellsAttachList.className = "actions-list";
      spellsListContainer.appendChild(spellsAttachList);
      const spellsTabHint = document.createElement("div");
      spellsTabHint.className = "spell-tab-hint";
      spellsTabHint.append("Create and edit spells on the ");
      const spellsTabLink = document.createElement("a");
      spellsTabLink.className = "spell-tab-link";
      spellsTabLink.href = "/studio/spells";
      spellsTabLink.textContent = "Spells page";
      spellsTabHint.appendChild(spellsTabLink);
      spellsTabHint.append(".");
      spellsListContainer.appendChild(spellsTabHint);
      animPanel.appendChild(spellsListContainer);
      container.appendChild(animPanel);

      // Paints the per-character spell-attachment list. Re-run on tab open and on
      // character switch. Reads/writes the shared characterSpellsState; each toggle
      // persists immediately via saveBattle (same payload as the Battle panel's
      // "Save Spells" button), so the two stay in lockstep within the session.
      function renderSpellsTab() {
        spellsAttachList.innerHTML = "";
        if (!CHARACTER) {
          spellsTabHint.style.display = "none";
          return;
        }
        spellsTabHint.style.display = "";
        if (!characterSpellsState[CHARACTER])
          characterSpellsState[CHARACTER] = [];
        if (spellsState.length === 0) {
          const empty = document.createElement("div");
          empty.className = "ae-empty";
          empty.textContent =
            "No spells yet — create them in the Spells page.";
          spellsAttachList.appendChild(empty);
          return;
        }
        spellsState.forEach((spell) => {
          const owned = (characterSpellsState[CHARACTER] ?? []).includes(
            spell.id,
          );
          const row = document.createElement("div");
          row.className = "action-row" + (owned ? " active" : "");
          const nameSpan = document.createElement("span");
          nameSpan.className = "action-row-name";
          nameSpan.textContent = spell.name;
          const meta = document.createElement("span");
          meta.className = "action-row-count";
          meta.textContent = `pow ${spell.power} · ${spell.cooldown}s cd`;
          // Visual-only toggle; the row owns the click (pointer-events off on the
          // switch avoids a double-fire) so the whole row is the hit target.
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "toggle-switch";
          toggleLabel.style.pointerEvents = "none";
          const inp = document.createElement("input");
          inp.type = "checkbox";
          inp.checked = owned;
          const track = document.createElement("span");
          track.className = "toggle-track";
          toggleLabel.appendChild(inp);
          toggleLabel.appendChild(track);
          row.appendChild(nameSpan);
          row.appendChild(meta);
          row.appendChild(toggleLabel);
          row.addEventListener("click", () => {
            const cur = characterSpellsState[CHARACTER] ?? [];
            const has = cur.includes(spell.id);
            characterSpellsState[CHARACTER] = has
              ? cur.filter((s) => s !== spell.id)
              : [...cur, spell.id];
            inp.checked = !has;
            row.classList.toggle("active", !has);
            saveBattle({
              characterId: CHARACTER,
              spells: characterSpellsState[CHARACTER] ?? [],
            });
          });
          spellsAttachList.appendChild(row);
        });
      }

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
          if (!destroyed) centerBoard();
        }, 300);
      }

      charBtn.addEventListener("click", doToggleCharPanel);
      toggleCharPanelRef.current = doToggleCharPanel;

      animTabBtn.addEventListener("click", () => {
        animTabBtn.classList.add("active");
        actionsTabBtn.classList.remove("active");
        spellsTabBtn.classList.remove("active");
        animList.style.display = "";
        actionListContainer.style.display = "none";
        spellsListContainer.style.display = "none";
        animTabActive = true;
        updateAnimAddVisibility();
        previewCancelled = true;
        selectedActionId = null;
        showPlaybackPanel();
      });

      actionsTabBtn.addEventListener("click", () => {
        actionsTabBtn.classList.add("active");
        animTabBtn.classList.remove("active");
        spellsTabBtn.classList.remove("active");
        animList.style.display = "none";
        actionListContainer.style.display = "";
        spellsListContainer.style.display = "none";
        animTabActive = false;
        updateAnimAddVisibility();
        renderActionList();
      });

      spellsTabBtn.addEventListener("click", () => {
        spellsTabBtn.classList.add("active");
        animTabBtn.classList.remove("active");
        actionsTabBtn.classList.remove("active");
        animList.style.display = "none";
        actionListContainer.style.display = "none";
        spellsListContainer.style.display = "";
        animTabActive = false;
        updateAnimAddVisibility();
        previewCancelled = true;
        selectedActionId = null;
        showPlaybackPanel();
        renderSpellsTab();
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
        renderSpellsTab();
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
        renderSpellsTab();
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
      // Mutable working copies seeded from the bootstrap payload. Row handlers
      // mutate these in place; Save sends the live object back.
      const battleStatsState: Record<string, UnitStats> = {
        ...(bootstrap.battleStats ?? {}),
      };
      const roleMapsState: Record<string, CharacterRoleMap> = {
        ...(bootstrap.roleMaps ?? {}),
      };
      // Global spell catalog + per-character ownership, seeded from the bootstrap.
      // Spell DEFINITIONS are managed on the dedicated /studio/spells pages, so
      // spellsState here is read-only — it backs the Battle panel's per-character
      // Spells assignment toggles. characterSpellsState is the editable ownership
      // (mutated there, saved via POST /api/config/battle). Cloned to avoid
      // touching the bootstrap payload.
      const spellsState: SpellDef[] = Array.isArray(bootstrap.spells)
        ? bootstrap.spells.map((s) => ({ ...s }))
        : [];
      const characterSpellsState: Record<string, string[]> = {};
      Object.entries(bootstrap.characterSpells ?? {}).forEach(([cid, ids]) => {
        characterSpellsState[cid] = Array.isArray(ids) ? [...ids] : [];
      });

      function saveBattle(body: {
        characterId: string;
        stats?: UnitStats;
        roles?: CharacterRoleMap;
        spells?: string[];
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

      const { renderBattlePanel } = createStudioBattlePanel({
        battleContent,
        serverConfig,
        animations,
        resolveCharAnimKeys,
        battleStatsState,
        roleMapsState,
        spellsState,
        characterSpellsState,
        flashSaved,
        saveBattle,
      });
      // studioBattlePanel extracted -> ./studioBattlePanel (Phase 2c)

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
        <a className="menu-bar-item" href="/studio/spells">
          Spells
        </a>
        <a className="menu-bar-item" href="/studio/campaigns">
          Campaigns
        </a>
        <a className="menu-bar-item" href="/studio/mock-battle">
          Mock Battle
        </a>
        <a className="menu-bar-item" href="/g/camp">
          Play
        </a>
      </nav>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative" }}
      />
    </div>
  );
}
