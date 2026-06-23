# Mock-Battle MVP — Build Tasks & Parallel-Dev Plan

Party-vs-party hex auto-battle sandbox at **`/studio/mock-battle`**, built inside the existing
Next 15 + React 19 + PixiJS 8 studio. Engine spec is `README_AFK_Hex_Battle_Knight_MVP_v3.md`
(in `~/Downloads`). This doc is the **build plan** — tasks, ownership, dependencies, and the
parallel-development waves. No implementation here.

> Status: planning complete (3 spec reviews + 3 recon passes + 1 pre-build architecture review +
> a final live-DB seed check), all reconciled. Ready to build once Wave 0 lands.

---

## Locked decisions

- **Architecture:** resolve-then-replay. Backend computes the whole battle deterministically and
  returns an event log; frontend replays it. Calc in backend, render in frontend.
- **Backend:** a **pure** sim module (`lib/battle/`, no React/Pixi/DB/`next` imports) invoked by a
  **DB-free** resolve route. Stats arrive in the request payload (sandbox-acceptable; **clamped** —
  see C2). For a future ladder/economy, switch to client-sends-`characterId`+`hex`, server looks up.
- **Stats:** per-character, in a new SQLite `character_battle_stats` table.
- **Roster / first matchup:** **John vs John** (the only registered, fully-animated character — see
  Reality). Both parties instantiate `john`; the **enemy party is tinted + flipped** to read as the
  opponent. Other characters (e.g. re-registering `knight`) are a follow-up.
- **Facing:** sprites are authored **facing right** (default). Facing is a **render-only** concern —
  the replayer mirrors a unit via **negative `scaleX` + centered anchor**, composing with the
  character's base `scaleX` (never overwriting it). Player party faces right (no flip); enemy party
  is flipped to face left. **Facing must NOT enter the engine or event log** (keeps the sim pure).
- **Replayer plays authored Actions OR raw animations** per event role (only one Action exists today;
  see B3/E5); CMS adds stats + event-role mapping + skill assignment on top of the **existing**
  animation/action editor.

## Reality notes (verified against live `data/app.db`; AGENTS.md is stale)

- Live data is **SQLite** (`data/app.db`) via `app/api/config/db.ts`; tables `app_config` (JSON blob),
  `animations`, `character_animations`. No `actions` table — Actions live in the `app_config` blob,
  per-character. Root `character-configs.json` is **dead**.
- **Roster (re-checked — it changed):** **`john` is the only registered character**
  (`characters: [{john}]`, `activeCharacter: john`) and has a **full battle-ready kit** (10 anims):
  `john-idle` (idle), `john-jump-forward` (move), `john-sword-swing/-chop/-thrust` + `john-spell`
  (attacks), **`john-hit` (hit)**, **`john-defeated` (death)**, **`john-shield-bash`** (skill art) and
  `john-shield-block`.
- **`knight` is catalog-only / deregistered:** its 10 animations (`ready/attack/run/heavy-attack/stab/…`)
  still exist in the `animations` table but it has **zero `character_animations` rows** and is **not in
  `characters`**. It also has **no hit/death art** — so re-registering it reintroduces that gap.
- **Actions seed = exactly one:** `john / "Hit"` → 1 step (`john-hit`, 0.3s, frames 0–50). All other
  roles currently resolve to **raw animations**, not authored Actions.
- **Seed source** `data/seed/characters/John/*.mp4` uses a semantic convention —
  `status-idle/-hit/-defeated`, `move-jump_forward`, `attack-*`, `defend-shield_block`, `spell-general`
  — i.e. a ready-made event-role taxonomy we seed the default mapping from.
- **No combat stats anywhere. No seeder exists** (DB populated out-of-band).
- Pixi reuse patterns (copy, do **not** edit the monolith): `await import("pixi.js")` + `Application`
  init + `destroyed`-guard-after-every-await (`StudioClient.tsx:46-67`), frames loader
  (`122-159`, drops empty-frame rows), `previewAction` slice/sequence/freeze + `previewGenId` cancel
  (`1107-1193`). The iso `hexGrid` (426-536) does **not** map to a 5×4 axial board — hex→pixel is new.
  There is **no tweening** anywhere.

## Domain model (corrected)

- **Animation** = raw frames + `AnimConfig{duration,loop,alpha,rotation}` (per char+anim); transforms
  `{scaleX,scaleY,anchorX,anchorY,tint}` per character.
- **Action** = `{id,name,steps:ActionStep[]}`; `ActionStep` = `AnimStep{type:"animation",animationKey,
  duration,startFrame?,endFrame?}` | `FreezeStep{type:"freeze",duration}`. **Actions carry no
  transforms and playback does no tweening.**
- **Event-role binding** maps each role (idle/move/attack/hit/death) to **either an Action id or a raw
  animation key** — because only one Action (`john/hit`) is authored today; the rest play raw clips.
- **Facing is render-only** — derived from `team` (+ optional target-x); applied as the sign of
  `scaleX` with a centered anchor. Not part of the engine, `Unit`, snapshot, or events.
- **Naming collision:** the studio's `Action` (animation sequence) ≠ the engine's action
  (move/attack/skill/wait). **Rename the engine type to `UnitAction`** in the shared contract.

---

## Phase 0 — Shared contract (BLOCKER — do first, solo)

**`lib/battle/types.ts`**, imported by engine, resolve route, and client. Freezing this unblocks
every other lane (especially the replayer scaffolding on mocks). The engine/event types stay
**orientation-free** (facing is computed client-side from `team`).

- [ ] `HexPosition`, `Team`, `UnitStats{hp,attack,defense,actionSpeed,range}`
- [ ] `Unit` — v3 `Unit` **+ `characterId: string` + `skills: string[]`** (drop/repurpose `type`)
- [ ] `UnitSnapshot` — **+ `characterId` + `team`** (renderer picks sprites/tint/facing); **no facing field**
- [ ] `UnitAction` (renamed engine action union: wait/move/attack/skill)
- [ ] `BattleEvent` (move/attack/skill/death/end; carries `t`, ids, `damage`, `targetHp`, push)
- [ ] `BattleSnapshot`, `BattleResult`, `ResolveRequest` (parties: `{characterId,stats,skills,hex}[]`)
- [ ] `EventRole = "idle"|"move"|"attack"|"hit"|"death"`;
      `EventBinding = {kind:"action"|"animation", ref:string}`;
      `EventActionMap = Record<characterId, Partial<Record<EventRole, EventBinding>>>`
- [ ] Decisions frozen here: `characterId`; skill ownership (`skills[]`); `john` stats; timeout→HP/draw;
      facing is render-only.

---

## Workstreams (the 7 must-fixes are baked into A/C/E)

### A. Battle engine — `lib/battle/engine.ts` (pure, server-safe) · owner: fixer
- [ ] **A1** Generalize v3 single-Knight → party-vs-party: one `decideUnitAction(unit, battle)` for
      both teams (uses `selectTarget`, which already filters `team !== unit.team`); replace
      `findPlayerKnight`. Win = all enemies dead; **lose = all player units dead**.
- [ ] **A2** `characterId` + `skills[]` on units; Shield Bash fires via
      `unit.skills.includes("shield_bash") && isSkillReady(...)` (no hardwired Knight).
- [ ] **A3** **Per-battle unit-id allocation** (counter local to `createBattle`) — kill the module
      global; ids must be reproducible for replay. *(oracle MF#2)*
- [ ] **A4** **Timeout → higher remaining total HP, else draw** — not auto-lose (symmetric parties). *(oracle SF)*
- [ ] **A5** Emit the `BattleEvent` log; **same-tick events keep emission order** (don't rely on `t`);
      events carry **no orientation/facing**. *(oracle MF#7)*
- [ ] **A6** Reject/guard empty party (engine assumes ≥1 per side).
- [ ] **A7** Preserve all v3 fixes: B1 cooldown-set, dead-filtering, `-=100` carryover, fixed 0.25s
      tick, no `Date`/`Math.random`.
- [ ] **A8** Headless determinism test: same `ResolveRequest` → byte-identical event log.

### B. Data layer — `db.ts` + `config/route.ts` + seeder · owner: fixer (**sole owner of these files**)
- [ ] **B1** `character_battle_stats(character_id PK, hp, attack, defense, action_speed, range)` +
      `getBattleStats()` / `upsertBattleStats()` (idempotent `ON CONFLICT DO UPDATE`, mirror existing upserts).
- [ ] **B2** Skill ownership storage (`skills TEXT`/JSON column or `character_skills` join).
- [ ] **B3** `eventActions` storage — extend the `app_config` blob with
      `eventActions: Record<char, Partial<Record<EventRole, EventBinding>>>` (binding = Action id **or**
      animation key), consistent with how Actions persist.
- [ ] **B4** **Seeder** (none exists): author **John** battle stats (tune from the v3 Knight baseline,
      e.g. ~1000/120/30/80/1; not 0/0/0) + `john.skills=["shield_bash"]` + **default `eventActions` from
      the seed naming convention**:
      `idle→anim:john-idle`, `move→anim:john-jump-forward`, `attack→anim:john-sword-swing`,
      `hit→action:hit`, `death→anim:john-defeated`, `skill/shield_bash→anim:john-shield-bash`.
      Idempotent. (Knight stats/animations only if/when it's re-registered — follow-up.)
- [ ] **B5** Surface `battleStats` + `eventActions` in `GET /api/config` bootstrap; ensure `POST`
      strips server-managed keys (+ leak guard if the client round-trips the blob).

### C. Resolve API — `app/api/battle/resolve/route.ts` (new) · owner: fixer · dep: A, Phase 0
- [ ] **C1** `POST` handler, `runtime="nodejs"`, `dynamic="force-dynamic"` (mirror config route).
- [ ] **C2** **Validate + clamp** payload stats (hp/attack/defense/actionSpeed/range to sane ranges;
      reject NaN/negatives). Prevents the `while(gauge>=100)` hang from a huge `actionSpeed`. *(oracle MF#3)*
- [ ] **C3** **Canonicalize unit order** server-side (player-first, then `r`,`q`) before `createBattle`
      — array order is the tie-break, so don't let the client decide it. *(oracle MF#4)*
- [ ] **C4** Build parties from payload → run engine to completion → return `{initialState, events, result}`.
- [ ] **C5** Comment: payload-stats is sandbox-only; switch to id-lookup for any ranked/economy mode.

### D. Party builder UI — `app/studio/mock-battle/` (builder files) · owner: designer · dep: Phase 0, B (defaults), C (Fight)
- [ ] **D1** Route: `page.tsx` (server, mirrors `app/studio/page.tsx`) → client; reuse global `.menu-bar`.
- [ ] **D2** Character picker from the **live list** (currently just `john`); **allow the same character
      on both parties and multiple copies** (John-vs-John); ≤5/side. Enemy slots get a tint to distinguish.
- [ ] **D3** Per-slot stat editing (defaults from bootstrap, edited in-memory, sent in payload).
- [ ] **D4** Deployment placement: player row `r=3`, enemy row `r=0`.
- [ ] **D5** Fight → `POST /api/battle/resolve` → hand `{initialState, events}` to the replayer.
- [ ] *(UI can scaffold against Phase-0 types + a mock bootstrap before B/C land; wire at Wave 3.)*

### E. Pixi replayer — `app/studio/mock-battle/` (replay files) · owner: designer · dep: Phase 0; render recon (done); C (events)
- [ ] **E1** Standalone **`playBinding(sprite, framesByKey, binding, {loop, signal})`** adapted from
      `previewAction` — plays an **Action** (multi-step slice+freeze) or a **single animation** (one
      full-range step) depending on `binding.kind`; reuse the generation-id cancel. New file — **do not edit StudioClient**.
- [ ] **E2** 5×4 hex board render + **axial→pixel** placement (new; iso grid not reusable).
- [ ] **E3** One `AnimatedSprite` per unit; `framesByKey` built once per character (shared `Texture[]`);
      on death `stop()`+hide, never destroy shared textures.
- [ ] **E4** Replay clock: advance by event `t` **between** ticks; within a `t` preserve emission order;
      reuse the `previewGenId` cancel so re-resolving a new battle kills the in-flight replay.
- [ ] **E5** Event → binding via `eventActions[characterId][role]`: move = **position tween** (new;
      bounded **≤ ~0.2–0.25s**, under the ~1.25s cadence); attack/skill = play mapped binding;
      **hit = play `hit` (real `john-hit`); death = play `john-defeated` then hide** (real art — no synth needed for John).
- [ ] **E6** **Facing/flip:** default faces right; mirror via `scaleX = -|baseScaleX|` + centered anchor
      for left-facing units; **player party right, enemy party flipped left**; apply consistently to every
      animation/Action of that unit; derive from `team` (optionally re-derive toward target on move).
- [ ] **E7** **Base-pose fallback** only for characters lacking an `idle` binding (John has `john-idle`,
      so it's covered); pose = frame0 of (idle ?? first anim); guarantee every selectable char has ≥1 frame.
- [ ] **E8** Damage numbers + HP bars from `attack`/`skill` `targetId`+`targetHp` (no separate hit event);
      result screen (win/lose/draw).
- [ ] *(Scaffold E2–E8 against mock events + mock `eventActions` from Wave 1; swap to live at Wave 3.)*

### F. CMS / management (studio) · owner: designer/fixer · dep: B · **sole owner of `StudioClient.tsx` edits**
- [ ] **F1** Battle-stats manager panel — CRUD over `character_battle_stats` via `/api/config` POST.
- [ ] **F2** Event-role mapping panel — bind `idle/move/attack/hit/death/skill` to an **Action or raw
      animation** per character; pre-filled from the B4 default (the seed naming convention).
- [ ] **F3** Skill assignment (which chars have `shield_bash` + params) — light.
- [ ] **F4** *(content, zero-code, optional)* Author richer hit/death **Actions** from existing frames
      (trim+freeze+reverse) in the existing editor — John already has real `john-hit`/`john-defeated`,
      so this is polish, not a requirement.
- [ ] **F5** *(fast-follow, new code, no art)* Extend `AnimStep` with optional `alpha/rotation/tint` +
      apply (interpolated) in `playBinding` → flashes/fades/tilts. Mainly for art-less chars (e.g. a
      re-registered `knight`).

---

## Parallel-development waves

| Wave | Lanes (parallel) | Specialist | Depends on |
|------|------------------|------------|------------|
| **0** | Phase 0 — `lib/battle/types.ts` | one fixer / orchestrator | — |
| **1** | **A** engine · **B** data+seeder · **E** replayer scaffold (mocks) · **D** builder scaffold | fixer · fixer · designer · designer | Wave 0 |
| **2** | **C** resolve route · **F** CMS persistence | fixer · designer | A (for C) · B (for F) |
| **3** | Integrate: D↔C Fight, E↔live events+`eventActions`, facing/tint pass · verify | orchestrator + owners | A,B,C,D,E,F |

**Critical path:** `0 → A → C → D → integrate`. B runs parallel to A. **E and F are off the critical
path** (E scaffolds on mocks; F is additive) — this keeps the biggest UI effort from gating the build.

**Write-ownership (no conflicts):**
- `lib/battle/*` → A (types in Wave 0).
- `db.ts`, `app/api/config/route.ts`, seeder → **B only**.
- `app/api/battle/resolve/route.ts` (new) → C only.
- `app/studio/mock-battle/*` → D (builder files) + E (replay files); `page.tsx` owned by D, imports E.
- `StudioClient.tsx` → **F only** (E copies patterns into new files, never edits the monolith).

**Hand-off contracts:**
- D needs only C's **types** (Phase 0) to scaffold; wires the real route at Wave 3.
- E needs only Phase 0 + a mock event log + mock `eventActions`; swaps to live at Wave 3.
- F needs B's bootstrap shape (`battleStats`, `eventActions`) — build panels against the shape, persist once B's endpoints land.

---

## Risks & mitigations

- **Action naming collision** (studio vs engine) → rename engine action to `UnitAction` in Phase 0.
- **Hit/death art** — **resolved for John** (`john-hit`, `john-defeated` are real); the frame-only /
  `playBinding`-alpha extension (F4/F5) is now polish, and only *needed* for an art-less char like a
  re-registered `knight`.
- **Facing** — flip must **compose with** the character's base `scaleX` (use `-|baseScaleX|`) and a
  centered anchor, or sprites scale/offset wrong; apply to every clip of the unit, not just one.
- **Movement tween + durations are renderer-owned** (no tween util exists) — bound under the action cadence (E5).
- **Determinism** depends on A3 (per-battle ids), C2 (clamp), C3 (canonical order), A5 (emit order, no facing) — all baked in.
- **No seeder existed** → B4 is mandatory, else John is a 0/0/0 unit that dies on tick 1.
- **Symmetric-party timeout** → A4 resolves by HP/draw, not auto-lose (very relevant for John-vs-John).

## Verification

- [ ] A8 headless determinism test (same input → identical events).
- [ ] `npx tsc --noEmit` — **note:** the repo has ~30 **pre-existing** errors in `StudioClient.tsx`
      (`animations[].config` typing per AGENTS.md); don't attribute those to this work.
- [ ] Manual: **John vs John (enemy tinted + flipped)** — confirm full kit reads (idle/move/attack/
      **hit**/**death**/shield-bash), **facing** (player faces right, enemy faces left), and a 5v5
      (occupancy/blocked-move + timeout→HP/draw). Confirm win/lose/draw + replay reads cleanly.
- [ ] CMS round-trip: edit John's stats + re-bind a role (Action or animation) → reflected in the next battle.
