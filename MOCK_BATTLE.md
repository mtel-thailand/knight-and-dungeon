# Mock-Battle — Feature & Architecture

`/studio/mock-battle` is a **party-vs-party hex auto-battle sandbox** built on top of the
vid-to-sprite studio. It uses a **resolve-then-replay** model: a pure, deterministic backend
simulator computes the *entire* battle up front and returns an event log; the client replays
that log as PixiJS animation on an isometric hexagon board whose view (tile size, scale, and
3-axis rotation) is configurable and persisted.

> Build history / original plan: `MOCK_BATTLE_TASKS.md`. Engine spec the sim was ported from:
> `~/Downloads/README_AFK_Hex_Battle_Knight_MVP_v3.md`. Frozen contract: `lib/battle/types.ts`.

---

## Architecture at a glance

```
Builder (client)                 Backend (pure)                 Replayer (client, PixiJS)
─────────────────                ──────────────                 ─────────────────────────
GET /api/config  ──bootstrap──▶  app/api/config/* + db.ts
  (roster, battleStats,
   roleMaps, mapConfig)
        │
   pick parties, edit stats
        │  POST /api/battle/resolve (ResolveRequest)
        └───────────────────────▶ validate/clamp/canonicalize
                                   → lib/battle/engine.resolveBattle()  ──ResolveResult──▶  replay event log
                                     (deterministic tick sim)                                on iso hex board

CMS "Battle Data" panel  ──POST /api/config/battle──▶  character_battle_stats / character_event_roles
Map overlay controls     ──POST /api/config/map───────▶  battle_map_config (id=1)
```

- **Backend is the source of truth.** The engine is pure (no React/Pixi/DB/`next`, no
  `Date`/`Math.random`) and deterministic; the client only renders.
- **Persistence** is SQLite (`data/app.db`) via `app/api/config/db.ts`.
- **The client never computes outcomes** — it sends intent (parties + stats + deploy hexes) and
  replays the returned events.

---

## Frozen contract — `lib/battle/types.ts`

Import these shapes; never redefine them.

- `HexPosition{q,r}`, `Team="player"|"enemy"`.
- `UnitStats{hp, attack, defense, actionSpeed, range, skills[]}`; `Unit` adds
  `id, characterId, maxHp, actionGauge, position, cooldowns, isDead`.
- `Skill{id,name,cooldown,range,damageMultiplier,pushDistance?}`.
- `Action` = engine-internal `wait|move|attack|skill` union — **distinct** from the studio's
  authored *Action* (a per-character animation sequence).
- `BattleStatus = setup|running|win|lose|draw` (`draw` = symmetric-timeout, not auto-lose).
- `BattleEvent` = `move|attack|skill|death|end`, each carrying `t`. **`t` advances per tick, so
  several events can share one `t`; the replayer must preserve emitted order within equal `t`
  (never sort by `t` alone).**
- Resolve API: `PartyMemberInput{characterId,stats,position}`, `ResolveRequest{players[],enemies[]}`,
  `ResolveResult{result,initialState,events}`; `BattleSnapshot{hexes,units}`.
- CMS: `BattleEventRole = idle|move|attack|hit|death`, `CharacterRoleMap = Partial<Record<role,string>>`.
- Constants: `STAT_BOUNDS` (hp 1–100000, attack/defense 0–100000, **actionSpeed 1–1000** anti-hang
  cap, range 1–20); `BOARD` (cols 5, rows 4, playerRow 3, enemyRow 0, maxPerSide 5);
  `BATTLE_TICK=0.25`, `MAX_BATTLE_TIME=60`.
- **`MapConfig` (6 fields)** `{tileWidth, tileHeightRatio, scale, rotation, rotationX, rotationY}`;
  `DEFAULT_MAP_CONFIG = {72, 0.5, 1, 0, 0, 0}`.

---

## Engine — `lib/battle/{engine,hex}.ts` (pure)

**`hex.ts`** — axial-hex helpers. `VALID_HEXES` is the full 5×4 rectangular grid (row-major,
stable order). `hexDistance` (cube form), `getNeighbors`, `isValidHex`, `isOccupied` (living units
only — dead free their hex), `getNextHexToward` (neighbors → in-bounds + unoccupied → min-distance,
tie-break `r` then `q`, else stay), `getPushTarget` / `tryPushUnit` (Shield Bash knockback).

**`engine.ts`** — the deterministic tick simulator.

- `SKILLS` registry: only `shield_bash` (cooldown 5s, range 1, ×1.5 damage, push 1).
- `createBattle(players, enemies)` — assigns unit ids **per battle** (`${team}-${characterId}-${i}`,
  player-first) so there is no module-global counter → reproducible.
- `decideUnitAction` (both teams) — Shield Bash (if owned + ready + in range) → basic attack
  (in range) → move toward `selectTarget` (nearest → lowest HP → lower r → lower q).
- `executeAction` — re-validates stale targets; damage `max(1, floor(atk − def))` and
  `max(1, floor(atk×1.5 − def))`; applies push; **sets the cooldown on skill use**; emits one
  `BattleEvent` per visible change at `t = currentTime`.
- `checkDeaths` (mark hp≤0, emit `death`); `checkBattleEnd` — **lose-first on mutual death**,
  win = all enemies dead, timeout → higher total team HP (equal ⇒ `draw`), emitted once.
- `updateBattle(dt)` — `currentTime += dt`; per unit: decay cooldowns, `gauge += actionSpeed*dt`,
  `while gauge >= 100` decide+execute with **`gauge -= 100` carryover** (not reset).
- `resolveBattle(req): ResolveResult` — build units → snapshot `initialState` *before* running →
  loop `updateBattle(BATTLE_TICK)` until terminal → return `{result, initialState, events}`.

**Determinism** rests on: fixed timestep, array-order resolution, `-= 100` carryover, per-battle
ids, total tie-breaks, integer floored damage, and no `Date`/`Math.random`. `lib/battle/sanity.ts`
(`npx tsx lib/battle/sanity.ts`) asserts byte-identical events on a double resolve.

---

## API

- **`POST /api/battle/resolve`** (`app/api/battle/resolve/route.ts`, nodejs / force-dynamic) —
  validates + clamps every stat to `STAT_BOUNDS` (the `actionSpeed` cap closes a `while`-loop hang
  vector), validates deploy hexes (integer, in `VALID_HEXES`, **player row 3 / enemy row 0**, no
  duplicate hex), rejects empty/over-cap parties (400 with a message), canonicalizes unit order
  (sort r→q) → `resolveBattle`. *Stats-in-payload is a sandbox convenience; switch to id-lookup for
  a real ladder/economy.*
- **`GET /api/config`** — bootstrap; merges user state + `animations` + `characterSeed` +
  **`battleStats`** + **`roleMaps`** + **`mapConfig`**. **`POST /api/config` strips**
  `animations, characterSeed, battleStats, roleMaps, mapConfig` so a studio save can never clobber
  battle data.
- **`POST /api/config/battle`** — CMS writes: `{characterId, stats?, roles?}` →
  `upsertBattleStats` / `upsertRoleMap`. Stats stored **unclamped** (clamping is resolve's job).
- **`POST /api/config/map`** — `MapConfig` (all 6 fields), each finite-checked (else 400) then
  clamped (`MAP_BOUNDS`: tileWidth 16–400, ratio 0.1–1, scale 0.25–4, rotation ±180, rotationX/Y ±80)
  → `saveMapConfig`.

---

## Database — `app/api/config/db.ts` (better-sqlite3, `data/app.db`)

`createDb()` ensures **six tables** (`CREATE TABLE IF NOT EXISTS`):
`app_config` (user-state blob), `animations` (catalog), `character_animations` (per-char keys),
**`character_battle_stats`** (`character_id` PK; `action_speed` REAL; `"range"` INTEGER; `skills`
TEXT JSON), **`character_event_roles`** (PK `(character_id, role)`; `action_id`), and
**`battle_map_config`** (`id=1` PK; `tile_width, tile_height_ratio, scale, rotation`).

**Migration:** `battle_map_config` predates the tilt feature, so `createDb()` runs a guarded
idempotent `ALTER TABLE … ADD COLUMN rotation_x / rotation_y REAL NOT NULL DEFAULT 0` (checked via
`pragma_table_info`) — back-filling existing DBs. It runs on each fresh connection (so a dev-server
restart applies it).

Helpers: `getBattleStats()`, `getCharacterRoleMaps()`, `getMapConfig()` / `saveMapConfig()`,
idempotent `upsertBattleStats` / `upsertRoleMap` (role upsert never deletes omitted roles), and
`pruneBattleData(keepIds)` (deletes battle-stat/role rows not in `keepIds`). Note: `deleteCharacter`
does **not** prune the battle tables — the seeder's `pruneBattleData` handles that.

---

## Seeding — `data/seed-battle.ts`

`npx tsx data/seed-battle.ts` (idempotent). Seeds the live roster and prunes anything else:

- `john` — `{hp 520, atk 95, def 16, spd 80, rng 1, skills:["shield_bash"]}`
- `john-copy` ("Red John") — `{hp 560, atk 100, def 18, spd 74, rng 1, skills:["shield_bash"]}`
- Both share `JOHN_ROLES`: `idle→john-idle, move→john-jump-forward, attack→john-sword-swing,
  hit→john-hit, death→john-defeated` (raw global animation keys).
- `pruneBattleData(["john","john-copy"])` drops stale rows (e.g. the old `knight`).

---

## Client — `app/studio/mock-battle/`

`page.tsx` (server) → `MockBattleClient.tsx` (`"use client"`, ~2160 lines).

**Builder** — fetches `GET /api/config`; the selectable roster = characters that have `battleStats`
(currently `john` + `john-copy`); seeds a default John-vs-Red-John matchup. You add fighters
(≤5/side), place them on deploy hexes (player row 3 / enemy row 0), edit per-unit stats, toggle
Shield Bash, and hit **Fight** → `requestResolve` POSTs a `ResolveRequest`. (`requestResolve` falls
back to a deterministic local `mockResolve` on network/5xx, and surfaces 4xx validation errors
inline.)

**Replayer** (`BattleStage`, keyed by `battleKey` → full remount on re-fight):
- Loads frames once (`Assets.load` + `Spritesheet.parse`, honoring `deriveFrom`/`reverse`).
- **Iso projection:** `isoPos(q,r) = ((q−r)·tw/2, (q+r)·th/2)`; tiles drawn as 6-corner hexagons
  (`isoHex`) vertically squashed by the H-ratio.
- **Configurable view + 3-axis rotation:** an outer **`viewport`** applies pitch/yaw foreshorten +
  zoom (`scale = boardScale·cos(rotY), boardScale·cos(rotX)`) *outside* the inner `board`'s in-plane
  Z `rotation`. Units **counter-transform** (`rotation = −rotRad`, inverse foreshorten scale) so
  characters, HP bars, and damage numbers stay **upright, shear-free billboards** at any tilt.
- **Depth-sort:** `unitsLayer.sortableChildren`; a ticker sets `zIndex` by rotated screen-y, so
  stacking is correct at any angle.
- **Map overlay** (`.map-overlay`): six live number inputs — **W, H, Scale, Rotation, Rot X, Rot Y**
  (ranges mirror the server `MAP_BOUNDS`) → debounced (350 ms) `POST /api/config/map`; loaded from
  `mapConfig` on mount.
- **Clip resolution (`clipForRole`) fallback ladder:** role-map value as (a) an authored *Action*
  id → flatten its steps; (b) a raw animation key → play it; (c) inferred Action / animation by
  name pattern; (d) base-pose freeze. So a role mapped to a raw animation key (the current seed)
  plays directly.
- **Playback:** events grouped into per-tick "beats" preserving emitted order; same-unit events
  serialized (so a bash-push then that unit's move don't race), distinct units concurrent. `flashHit`
  (no `hit` event — inferred from an attack/skill's target; authored clip else tint/alpha flash),
  `doDeath` (authored death clip + fade, else fade+rotate topple), damage numbers, HP-bar tweens.
- **Result screen:** Victory / Defeat / **Draw**, with Watch-again (`genId`-cancel replay) /
  Edit-parties. Full cleanup on unmount (`destroyed` flag + `genId` + Pixi `destroy`).

---

## CMS — "Battle Data" panel (`app/studio/StudioClient.tsx`)

A right-docked panel (menu-bar **"Battle Data"**), built in the studio's imperative-DOM style:
1. **Battle Stats** — HP / Attack / Defense / Action Speed / Range per character (bounded by
   `STAT_BOUNDS`).
2. **Event Roles → clip** — per role (idle/move/attack/hit/death) a dropdown offering
   `(none → fallback)` + an **Actions** optgroup (the character's authored Actions) + an
   **Animations** optgroup (its raw catalog keys). The stored value is a plain id/key string the
   replayer resolves via the fallback ladder.
3. **Skills** — toggles persisted into `stats.skills`.

All three "Save" buttons `POST /api/config/battle`. (`/studio` also has a **Mock Battle** nav link.)

---

## Live roster & animation reality

- Battle roster = `john` + `john-copy` (the only characters with `battleStats`).
- Both map all five roles to raw own-frame `john-*` animations.
- **`john`** has a full own-frame kit including **real `john-hit` and `john-defeated`**, so hit/death
  play authored clips (no synthesis).
- **`john-copy` ("Red John")** is a tinted variant with no own `character_animations` — it renders
  via the global catalog using the same `john-*` keys, tinted from `characterConfigs`.
- **`knight` is not a live battle character** (no `battleStats`; pruned). If reintroduced without
  hit/death art, the fallback ladder synthesizes hit (tint flash) and death (fade+rotate).

---

## Running & extending

- **Seed:** `npx tsx data/seed-battle.ts` (only needed on a DB without battle stats).
- **Run:** `npm run dev` → `http://localhost:3000/studio/mock-battle`.
- **Add a battle character:** ensure its animations exist in the catalog (`animations` /
  `character_animations`), then add `battleStats` + a role map (via the CMS Battle Data panel or by
  extending `data/seed-battle.ts`). It then appears in the builder roster automatically.
- **Add a skill:** add it to the engine's `SKILLS` registry + the per-unit AI in `decideUnitAction`;
  expose ownership via `stats.skills` (CMS Skills toggle).
- **Map look:** tune W / H / Scale / Rot / Rot X / Rot Y in the arena overlay — it persists.

---

## Determinism & dev-environment gotchas

- The engine is deterministic: same `ResolveRequest` → byte-identical `events`. Keep it pure (no
  `Date`/`Math.random`, no React/Pixi/DB/`next` imports); if randomness is ever added, use a seeded
  RNG stored in `BattleState` and return the seed.
- **Run exactly one dev server.** Two `next dev` instances (e.g. `:3000` + `:3001`) use **separate
  better-sqlite3 connections** → inconsistent reads/writes (this caused phantom "save doesn't work"
  bugs). If a stray one appears: `lsof -ti tcp:3000 | xargs kill -9`, then a single `npm run dev`.
- **Do not run `npm run build` against a running `next dev`** — they share `.next/`, which corrupts
  it (500s / stale bundles). Build only with dev stopped, or use a separate checkout.
