# Balance Design — Work in Progress

## Goal

3 campaigns with calibrated difficulty using ONLY existing characters
(`blue`, `big-green`, `little-green`):

| Campaign | Player Party | Target Win Rate |
|---|---|---|
| Easy — "Rat Infestation" | 1 hero (blue) | ~75% |
| Normal — "Goblin Raid" | 2 heroes (blue ×2) | ~50% |
| Hard — "Dark Legion" | 3 heroes (blue ×3) | ~5% |

## Combat Math

- **Damage** = `max(1, floor(attack - defense))`
- **actionSpeed 100** ≈ 1 action/sec (gauge += speed × 0.25, action at 100)
- **Board**: 5×5 hex (rows r=-2 to r=2). Deploy at opposite ends → ~2-3s approach time
- **Shield Bash**: 1.5× ATK damage, 5s cooldown, 1-hex push

## Key Findings (from sweeps)

### 1. One-shot threshold dominates
Hero ATK must ≥ swarm HP to one-shot them. Missing by even 2 ATK doubles damage taken.

### 2. DEF is a damage gate
Low DEF (2-6) on enemies dramatically reduces hero DPS. Multiple heroes don't compensate linearly because each hit is individually reduced.

### 3. Death spiral
If a hero dies mid-campaign, remaining heroes can't recover. Waves must wear HP down gradually, not kill outright before the final wave.

### 4. Spawn mechanics
Max 5 on board. Spawns only trigger when board space opens (enemies die). High spawnCount with 5 initial enemies = ~0-2 actual spawns.

## Current Best Stat Set

| Character | HP | ATK | DEF | SPD | Notes |
|---|---|---|---|---|---|
| blue (hero) | 250 | 30 | 2 | 100 | shield_bash |
| big-green | 80 | 32 | 0 | 85 | Bruiser — glass cannon |
| little-green | 25 | 8 | 0 | 120 | Swarm — one-shottable |

## Next Steps

Redesign campaign wave curves so each wave is only moderately harder than the
previous, avoiding hero death before the final wave. The "hard" campaign needs
accumulated attrition over 3 waves, not a wall in wave 2.

## Tools

- `data/sweep.ts` — batch simulate multiple stat+wave combos
- `data/debug.ts` — trace a single battle event-by-event
- `data/balance-design.ts` — seed DB + full simulation
