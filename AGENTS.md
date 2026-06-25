# AGENTS.md

`vid-to-sprite` — a Next.js 15 (App Router) + React 19 + PixiJS 8 "Animation Studio" for
previewing and configuring spritesheet animations, plus a Python/ffmpeg pipeline that turns
green-screen MP4s into those spritesheets. A party-vs-party hex auto-battle sandbox
(`/studio/mock-battle`) is **built** on top — see *Mock-Battle feature* below and the full doc `MOCK_BATTLE.md`.

## Module map

The codebase is organized into 7 modules; each has its own `AGENTS.md` auto-surfaced when you work in its directory. Inter-module communication is via contracts only — never reach into another module's internals.

| Module | Responsibility | Doc | Owner archetype |
|---|---|---|---|
| A contract | frozen sim/CMS types, board shape, bounds, `/api/config` payload shape | `lib/battle/AGENTS.md` | oracle (gatekeeper) |
| B battle-engine | pure deterministic sim + resolve HTTP adapter | `lib/battle/AGENTS.md`, `app/api/battle/AGENTS.md` | fixer (oracle-reviewed) |
| C persistence | Postgres schema (Drizzle ORM) + config API aggregator & writers | `app/api/config/AGENTS.md` | fixer |
| D asset-pipeline | MP4→spritesheet (Python CLI + server routes) | `app/api/animation/AGENTS.md` | fixer |
| E studio-cms | imperative-DOM character/anim/action/battle-data CMS + preview | `app/studio/AGENTS.md` | fixer (senior FE) |
| F spell-cms | global spell library (React pages) | `app/studio/spells/AGENTS.md` | fixer |
| G mock-battle | Pixi replayer + party builder + game-screen shell | `app/studio/mock-battle/AGENTS.md` | fixer (Pixi) |

Cross-cutting invariants: the determinism firewall stays in `lib/battle`; the shared `[5,6,7,6,5]` board lives in `studioHelpers` + `BOARD`; Fully async Postgres via Drizzle ORM; runs with one `next dev`; `/api/config` POST strip-list must track GET; the studio stays imperative DOM with injected `<style>`; `BootstrapPayload` is a client mirror and can drift.
Deep-dive battle docs live with module G (`MOCK_BATTLE.md`, `MOCK_BATTLE_PLAN.md`, `MOCK_BATTLE_TASKS.md`); the root stays the single index.

## Commands

- `npm run dev` / `npm run build` / `npm start` — Next dev server / production build / serve.
- Type-check: `npx tsc --noEmit` (strict; tsconfig is `noEmit`). `next build` also type-checks.
- There are **no** lint/test scripts and no test runner — don't look for them.
- Type-check is currently **clean**. (`StudioClient.tsx` was refactored — its `AnimConfig` now
  declares `{duration, loop, alpha, rotation}` in `studioTypes.ts`, resolving the old
  `animations[].config` errors.) Keep it clean and don't regress.
- Python pipeline needs **`ffmpeg` + `ffprobe` on PATH**. Next 15 needs Node 18.18+.

## Persistence — Postgres via Drizzle ORM

The live studio persists state through `GET/POST /api/config`, which
delegates to **`lib/db/adapter.ts`** — a Drizzle ORM adapter querying a Postgres
database (`DATABASE_URL` env var). Fourteen tables are defined in `lib/db/schema.ts`:
app_config, animations, character_animations, character_battle_stats,
character_event_roles, battle_map_config, damage_config, spell_text_config,
spells, campaigns, character_spells, mock_battle_roster, battle_rewards.

Caution: any studio interaction POSTs the whole in-memory state back, overwriting manual edits to
`app_config`.

## Animation vs Action (core domain model)

- **Animation** = raw image frames (a spritesheet sequence; the `animations` catalog rows). Frames
  load via `Assets.load('/assets/'+image)` → `new Spritesheet(texture, frameData)` → `parse()`,
  ordered by `Object.keys(frames)` insertion order (zero-padded names matter). A row with
  `deriveFrom` borrows another animation's frames (optionally `reverse`d) — this **replaces** the
  old `3d-knight`/`sliceSheetFrames` special case.
- **Action** = a *manipulated* animation built on top: bind/sequence steps, ignore frames
  (start/end trim), set per-step duration, freeze steps, plus transforms (alpha/rotation/tint/scale).
  Actions are per-character, authored in the studio UI, and are the polished playable motions.

## Live roster (in the DB)

The live characters (`app_config.characters`) are **`john`** ("John") and **`john-copy`** ("Red John" —
a tinted variant that reuses john's frames; it has **no** own `character_animations` rows). `john` has a
**full own-frame kit**: `john-idle`, `john-jump-forward`, `john-sword-swing`/`-chop`/`-thrust`,
`john-shield-bash`, `john-shield-block`, `john-hit` (**real hit art**), `john-defeated` (**real death art**),
`john-spell`. **`knight` is NOT a live character** — its `ready`/`run`/`attack`/`heavy-attack`/`stab`/
`spell-cast`/`engage`/`disengage` rows still exist in the global `animations` catalog, but there are no
`knight` `character_animations` rows and it's not in `characters`. `skeleton-soldier-*` PNGs exist in
`public/assets/` but are not in the DB (re-seedable). Combat stats now live in `character_battle_stats`,
seeded for `john` + `john-copy` by `data/seed-battle.ts`.

## `StudioClient.tsx` is imperative, not React

One ~2225-line `'use client'` component whose `useEffect` builds the PixiJS canvas **and** all side
panels via raw `document.createElement` + an injected `<style>` tag. React only provides the outer
shell (`.menu-bar`, styled in `app/globals.css` — global, not injected) + a container `ref`. Edit
the imperative DOM code.

Pure, non-stateful pieces live in sibling modules (import from these; don't re-inline): **`studioConstants.ts`**
(FPS, `PANEL_W`/`DUAL_PANEL_W`, `GRID`, `DEFAULT_CHARACTER`), **`studioStyles.ts`** (the `STUDIO_CSS`
string injected as the `<style>` tag — it interpolates `PANEL_W`/`DUAL_PANEL_W`), **`studioTypes.ts`**
(`AnimConfig`/`AnimationRow`/`CatalogEntry`/`Action`/`ServerConfig`/`CharacterSeed`/`BootstrapPayload`/…),
and **`studioHelpers.ts`** (`slugify`, `getHexRowsFromCounts`, the shared `isoPos`/`isoHex` board
geometry, `defaultCharConfig`). Pixi types come in via
`import type { Application as PixiApplication, Texture as PixiTexture }` (erased at runtime — keeps
Pixi out of module/server scope; the runtime values still come from `await import('pixi.js')`).

- `pixi.js` is loaded with `await import('pixi.js')` inside the effect (client-only; keep Pixi out of
  module-level / server scope).
- The catalog is fetched from `GET /api/config` (Postgres) — there is **no** hardcoded
  `Assets.load([...])` alias list anymore.
- The many `if (destroyed) { ... }` guards exist because `init()` is async and React Strict Mode
  double-invokes effects in dev; cleanup destroys the Pixi app, removes the style tag + resize
  listener, and clears the container. (The resize handler is a closure-scoped `let` in the effect,
  removed directly in cleanup — no more `container.__resizeHandler` expando.)
- **`applyAnimation(idx)` is the single source of truth** for painting the sprite: textures +
  speed/loop **and** the active character's scale/anchor/alpha/rotation/tint. Startup,
  switch-animation, switch-character, and preview-restore all route through it, so first paint and
  post-switch never diverge. The active animation index is resolved from `resolveCharAnimKeys`
  (kit-aware, incl. blob-only kits like `john-copy`).
- The board is a fixed **5-6-7-6-5** pointy-top hex (`getHexRowsFromCounts(GRID.rows)`); tiles render
  through the **shared `isoPos`/`isoHex`** (`studioHelpers.ts`, also imported by
  `mock-battle/MockBattleClient.tsx`) with `GRID.tileFill`/`tileStroke` matching it, so the studio
  preview and the mock-battle board read as the same surface. The old radius-based "Size" overlay
  control was removed (the `W`/`H` tile-size inputs remain).
- Canvas wrapper is positioned `left: 40vw; right: 20vw` to clear the side panels.

## Mock-Battle feature (`/studio/mock-battle`) — built

A party-vs-party hex auto-battle sandbox. **Resolve-then-replay:** a pure, deterministic backend
simulator computes the entire battle and returns an event log; the client replays it via PixiJS on a
configurable isometric hexagon board. **Full architecture doc: `MOCK_BATTLE.md`.** Original plan:
`MOCK_BATTLE_TASKS.md`; engine spec: `~/Downloads/README_AFK_Hex_Battle_Knight_MVP_v3.md`.

- **Frozen contract:** `lib/battle/types.ts` (import from here; don't redefine) — incl. `MapConfig`
  (6 fields: tileWidth, tileHeightRatio, scale, rotation, rotationX, rotationY), `STAT_BOUNDS`, and
  `BOARD` — now a **`[5,6,7,6,5]` centered-axial hexagon arena** (`rowCounts`, `playerRow +2`,
  `enemyRow −2`, `maxPerSide 5`; was a 5×4 rectangle). The board shape lives ONLY in `BOARD.rowCounts`
  + the `VALID_HEXES` generator in `hex.ts` (the hex math is shape-agnostic), mirroring
  `getHexRowsFromCounts` so the battle board and studio preview are the same surface.
- **Pure engine:** `lib/battle/{engine,hex}.ts` (**no** React/Pixi/DB/`next`, no `Date`/`Math.random`;
  deterministic — `lib/battle/sanity.ts` proves byte-identical replays). Party-vs-party; win/lose/**draw**.
- **Endpoints:** `POST /api/battle/resolve` (validate/clamp/canonicalize → `resolveBattle`);
  `GET /api/config` also returns `battleStats`/`roleMaps`/`mapConfig` (POST **strips** them so studio
  saves can't clobber battle data); `POST /api/config/battle` (CMS stat/role writes);
  `POST /api/config/map` (board view config).
- **DB tables:** `character_battle_stats(character_id PK, hp, attack, defense, action_speed, range, skills)`,
  `character_event_roles(character_id, role, action_id)` (role → an authored **Action** id *or* a raw
  animation key), and `battle_map_config(id=1, tile_width, tile_height_ratio, scale, rotation,
  rotation_x, rotation_y)` (the `rotation_x/y` columns added via a guarded `ALTER TABLE` migration in
  `createDb`). Seeded by `data/seed-battle.ts` (`john` + `john-copy`).
- **Client** (`app/studio/mock-battle/MockBattleClient.tsx`): party builder + PixiJS replayer — iso hex
  board with a live overlay for **tile size / scale / 3-axis rotation** (persisted to `/api/config/map`),
  upright-billboard units (counter-transformed so they don't shear when tilted), depth-sort, and a
  `clipForRole` fallback ladder (Action id → animation key → name-inference → base-pose → tint/fade
  synthesis). `john` has real `hit`/`death` art so it needs no synthesis.
- **CMS:** a "Battle Data" panel in `StudioClient.tsx` edits stats, event-role→Action/Animation maps,
  and skills; `/studio` has a **Mock Battle** nav link.
- **Dev gotchas:** run **exactly one** `next dev` (two instances = separate connections =
  inconsistent reads); never `npm run build` against a running dev (shared `.next/` corrupts → 500s).

## Adding an animation (MP4 → studio)

Source MP4s live in `source/`. `python3 make_spritesheet.py` (bare PNG) and
`python3 add_animation.py <in.mp4> <kebab-name>` (PNG+JSON) tile frames with ffmpeg `chromakey`
(default green `0x04F108`, frame size 160, 4 cols).

**Gotcha:** `add_animation.py` defaults to **legacy** targets (`--assets-dir ./assets`,
`--main-js ./main.js`) and its `main.js` injection won't match the live app. To add to the live studio:

1. `python3 add_animation.py source/<clip>.mp4 <name> --assets-dir ./public/assets --no-inject`
2. Register the animation in the **Postgres catalog** (`animations` + `character_animations` via
   `db.ts` — no seeder exists, so insert directly or write one). The old "edit the `Assets.load`
   list / `animations` array in `StudioClient.tsx`" step **no longer applies**.

Generated JSON keys frames as `<name_with_underscores>_<NNN>`; frames load by `Object.keys` order, so
zero-padded ordering matters.

## Legacy (dead) files — don't edit expecting changes

Root `index.html` + `main.js` + root `assets/` + root `character-configs.json` are the pre-Next
prototype `StudioClient.tsx` was ported from. `next.config.ts` is empty (no custom server/rewrites)
and Next serves only what the app imports + `public/`, so these root files are **never served or
built**. `main.js` is stale (no John, no actions/transforms).

## Not under version control
`.next/`, `node_modules/`, `tsconfig.tsbuildinfo`
