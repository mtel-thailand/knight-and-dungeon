# Mock-Battle MVP — Build Tasks & Parallel-Dev Plan

Target: **`/studio/mock-battle`** — a party-vs-party hex auto-battle sandbox inside the
existing Next 15 + PixiJS 8 studio. **Resolve-then-replay**: the backend computes the entire
battle deterministically and returns an event log; the frontend replays it as PixiJS
animation. Plus **CMS** management for per-character battle stats, event-role→Action mapping,
and skill ownership.

## Sources of truth
- **Engine spec:** `~/Downloads/README_AFK_Hex_Battle_Knight_MVP_v3.md` (build-ready; the engine
  is generalized from it to party-vs-party).
- **Frozen contract:** `lib/battle/types.ts` — import from here; do **not** redefine these shapes.
- **Recon facts (verified):** persistence is **SQLite** `data/app.db` via `app/api/config/db.ts`
  (NOT json/fs); live roster = `knight` (idle=`ready`, move=`run`, attack kit) + `john`
  (attack-only, `john-sword-swing`); `skeleton-soldier` PNGs on disk, not in DB; **no hit/death
  art** for anyone; **no combat stats** exist; `db.ts` has unused
  `upsertAnimation`/`upsertCharacterAnimation` (mirror these). **Animation** = raw frames;
  **Action** = manipulated animation (bind / ignore-frame / duration / freeze + alpha/rotation/
  tint/scale), authored in the studio, persisted in config.

## Must-fixes (pre-build review — apply across lanes)
1. `Unit`/`UnitSnapshot` carry `characterId` + `skills[]`. *(in contract)*
2. Per-battle unit-id allocation inside `createBattle` — **no module global**.
3. Resolve route **clamps/validates** payload stats (`STAT_BOUNDS`) — `actionSpeed` is a hang vector.
4. Resolve route **canonicalizes unit order** (player-first, then r, q) before sim.
5. One `decideUnitAction(unit)` for both teams; Shield Bash fires via `unit.skills.includes("shield_bash")`.
6. Replayer preserves **emitted order within equal `t`** (no sort-by-`t`).
7. Phase-0 shared contract = `lib/battle/types.ts`. *(done)*
- **Should:** timeout → higher remaining HP, else **draw** (not auto-lose); seeder authors **real
  stats for every live character** (knight, john[, skeleton]); fallback **base-pose** for idle-less
  chars; bound tween/anim durations under the action cadence (≤ ~0.25s).

## Lanes — ownership · deps · acceptance

### Lane A — Engine (fixer) · `lib/battle/engine.ts`
Generalize v3 to party-vs-party against the contract.
- `createBattle(players, enemies)` (per-battle ids), `updateBattle`, `decideUnitAction`,
  `executeAction` (emits events incl. push + cooldown-set), `selectTarget`, `checkDeaths`,
  `checkBattleEnd` (win/lose/**draw-on-timeout-by-HP**), `resolveBattle(req): ResolveResult`,
  `SKILLS` registry (`shield_bash`), axial hex helpers.
- Preserve all v3 fixes: B1 cooldown-set, dead-filtering, `-= 100` carryover, fixed tick, no
  `Date`/random, stale-target guards.
- **Owns:** `lib/battle/*`. **Pure** — no React/Pixi/DB/`next` imports.
- **Accept:** deterministic (same input → identical events); headless self-check (1v1, 3v3); tsc clean.

### Lane B — Battle DB + seeder + bootstrap (fixer) · `app/api/config/db.ts`, `data/` seeder, `app/api/config/route.ts`
- Tables: `character_battle_stats(character_id PK, hp, attack, defense, action_speed REAL, range, skills TEXT)`
  + `character_event_roles(character_id, role, action_id)`. Add `getBattleStats()`,
  `getCharacterRoleMaps()`, idempotent `upsertBattleStats()` / `upsertRoleMap()`
  (`ON CONFLICT DO UPDATE`, mirroring existing upserts).
- **Seeder:** author real stats + role maps for **knight** and **john** (optional skeleton re-seed). Idempotent.
- Surface `battleStats` + `roleMaps` in `GET /api/config`; add management POST endpoint(s) for CMS saves; strip server-managed keys.
- **Owns:** `app/api/config/db.ts`, `app/api/config/route.ts`, `data/` seeder. **Accept:** GET returns
  stats+roles; seeder populates knight/john; tsc clean.

### Lane C — Resolve route (fixer) · `app/api/battle/resolve/route.ts` *(NEW)*
- `runtime="nodejs"`, `dynamic="force-dynamic"`. `POST(req)`: parse `ResolveRequest` → **reject empty
  parties** → **clamp/validate** stats (`STAT_BOUNDS`) → **canonicalize order** → `resolveBattle()` →
  `NextResponse.json(ResolveResult)`. Comment that stats-in-payload is sandbox-only (switch to
  id-lookup for prod).
- **Owns:** new route file. **Dep:** contract (+ engine `resolveBattle`; integrate when A lands).
  **Accept:** rejects empty/garbage, clamps, deterministic; tsc clean.

### Lane D — mock-battle page: party builder + replayer (designer) · `app/studio/mock-battle/{page.tsx,MockBattleClient.tsx}` *(NEW)*
- `page.tsx` server (mirror `app/studio/page.tsx`) → `MockBattleClient.tsx` `"use client"`.
- **Party builder:** pick from the live roster into player/enemy parties (≤5/side), place on
  row 3 / row 0, edit per-unit stats (defaults from bootstrap), **Fight** → POST resolve.
- **Replayer:** reuse studio Pixi init (46-67), frames loader (122-159), `previewGenId` cancel
  pattern (1094/1098/1157), cleanup/`destroyed` contract (2024-2049). One `AnimatedSprite` per
  unit (share `Texture[]`). Play authored **Actions** per battle event via the role-map;
  **fallback ladder** (idle→base-pose freeze, move→tween holding pose, hit→tint/alpha flash,
  death→fade+rotate). Drive clock by `t`, **preserve emitted order within equal `t`**; bound
  durations ≤ ~0.25s. Damage numbers, HP bars (from `targetHp`), result screen (win/lose/draw).
  New axial hex→pixel (do **not** reuse the iso grid).
- **Owns:** new mock-battle files. **Dep:** contract; scaffold on **mock events** before C lands;
  integrate resolve + bootstrap at wire-up. **Bind the role-map to the real Action representation
  in `StudioClient.tsx`.** **Accept:** plays a mock battle end-to-end, then a real one.

### Lane E — CMS management UI (fixer) · `app/studio/StudioClient.tsx` (+ panels)
- Battle-stats manager (CRUD over `character_battle_stats`), **event-role→Action mapping** UI
  (idle/move/attack/hit/death → pick from the character's authored Actions), skill assignment
  (which characters own `shield_bash`). Calls Lane B endpoints. Follow the existing imperative
  panel + injected-`<style>` pattern.
- **Owns:** CMS additions in `StudioClient.tsx`. **Dep:** B's endpoint contract (build UI against
  it; integrate when B lands). Does **not** touch `db.ts`/`route.ts` (B owns those).
  **Accept:** view/edit/save stats + role maps + skills, reflected in bootstrap.

## Parallel-dev plan

### Dependency graph
```
Phase 0: lib/battle/types.ts   (DONE — gates all)
              |
   ┌──────────┼───────────┬────────────────┬─────────────────┐
   A          B            C (stub → A)      D (mock → C,B)     E (→ B endpoints)
 engine     db+seed      resolve route     builder+replayer    CMS
   └──────────┴───────────┴────────► Phase 6: integrate + wire-up + verify ◄──┘
```

### Runs in parallel now (after Phase 0)
All five lanes start against the frozen contract: **A, B, C, D, E**. C stubs the engine call; D
scaffolds on mock events; E builds against B's endpoint contract.

### Write-ownership (no collisions — verified)
| Lane | Owns (writes) |
|------|----------------|
| A | `lib/battle/*` |
| B | `app/api/config/db.ts`, `app/api/config/route.ts`, `data/` seeder |
| C | `app/api/battle/resolve/route.ts` (new) |
| D | `app/studio/mock-battle/*` (new) |
| E | `app/studio/StudioClient.tsx` |
No two lanes write the same file. B owns all DB + config-route changes; E only consumes B's endpoints.

### Critical path
**A (engine) → C (resolve) → D wire-up → Phase 6.** B and E run off the critical path; D's heavy UI
scaffolds on mocks off the critical path.

### Phase 6 — integration + verification
- Wire D → C (resolve) + bootstrap (B); wire E → B endpoints.
- `npx tsc --noEmit` (repo has pre-existing `StudioClient` errors — keep new code clean, don't regress).
- `npm run build` / `npm run dev` smoke.
- **Validation routing:** @oracle reviews the engine (determinism + generalization correctness);
  @designer reviews the replayer feel + party-builder UX; orchestrator reconciles + fixes copy.
