# Mana Tank UI + Pixi Persistence Refactor

**TL;DR** — Added a 97-frame mana tank spritesheet (reversed, chroma-keyed) to the battle screen as a persistent Pixi overlay, then refactored BattleStage into a two-effect architecture so Pixi survives re-fights without flicker.

## What was built

### Mana Tank Spritesheet
- Source: MP4 of a mana tank going from full→empty (192x192, 24fps, 97 frames)
- Processing: ffmpeg `reverse` filter so the spritesheet plays empty→full, `chromakey=0x00FF00` to remove green background
- Output: `public/assets/ui/mana-tank-spritesheet.png` (1920x1920, 10×10 grid, RGBA with transparency) + `public/assets/ui/mana-tank-spritesheet.json` (PixiJS frame data)
- Rendered as `AnimatedSprite` on `pixiApp.stage` at `zIndex: 9998`, `scale(0.5)`, positioned top-left `(60, 60)`, `loop: false`
- Starts at `currentFrame = 0` (empty tank) — static until `runReplay()` fires `play()`

### EXP Gain System
- `death` BattleEvent now carries `killedBy?: string` — the unit that dealt the killing blow
- `ResolveResult` carries `expGains?: Record<string, number>` — unitId → EXP from kills
- EXP = defeated unit's `maxHp` (simple formula, extracted into `computeExpGains()`)
- Determinism preserved (all sanity tests pass)

## The refactoring

### Problem
Every re-fight destroyed the Pixi app and recreated it from scratch:
1. `MockBattleClient` used `key={battleKey}` → React unmounted/remounted `BattleStage`
2. The single `useEffect([result])` destroyed Pixi in its cleanup on every dep change
3. All spritesheets (mana tank included) reloaded on every fight
4. Result: visible flicker, ~1-2s blank screen between fights

### Solution: Two-effect architecture

```
Effect 1 (deps: []) — runs once, owns Pixi lifecycle
  ├── Import pixi.js dynamically
  ├── Create wrapper div + pixi Application
  ├── Load UI spritesheets (mana tank)
  ├── Create mana tank AnimatedSprite on stage
  ├── Load display font
  ├── Store { app, wrapper, manaTank, pixi } in pixiCtx ref
  ├── setPixiReady(true)  ← signals Effect 2
  └── Cleanup: destroys Pixi ONLY on component unmount

Effect 2 (deps: [result, pixiReady]) — runs per battle
  ├── Guards: if (!ctx || !result) return;
  ├── Destructures AnimatedSprite/Graphics/Text/Container from ctx.pixi
  ├── Computes neededKeys, loads catalog spritesheets
  ├── Creates battleClips, builds units
  ├── Sets up controlsRef, runs replay
  └── Cleanup: nulls refs, cancels inflight — does NOT destroy Pixi
```

### Key pieces
- `pixiCtx` useRef — holds Pixi app, wrapper, mana tank, pixi module across re-renders
- `pixiReady` useState — bridges the async gap: Effect 1 finishes → sets true → Effect 2 fires
- Effect 2's cleanup explicitly skips `pixiApp.destroy()`, `container.innerHTML = ""`, and `wrapper.parentNode.removeChild(wrapper)`

### Race condition (fixed in f45f1e8)
- Bug: Effect 2 fires before Effect 1's async `initPixi()` completes → `pixiCtx.current` is null → Effect 2 exits silently → battle never loads
- Fix: `pixiReady` state + `[result, pixiReady]` deps on Effect 2

### Remaining issues
- There is still some flicker when the battle result changes (Effect 2 cleanup → body gap)
- The mana tank animation plays through once per replay (no state-driven speed yet)
- Green screen chroma key applied, but the video may have residual green pixels at edges
