# Setup Guide

## Prerequisites

- **Node.js** 18.18+ (tested with 22.x)
- **npm** (bundled with Node)
- **ffmpeg + ffprobe** on PATH (required for the MP4 → spritesheet Python pipeline)
- **Python 3** (for `make_spritesheet.py` / `add_animation.py`)
- **PostgreSQL** (optional — Vercel deploy uses bundled SQLite via `data/seed/app.db`)

## Quick Start (Vercel-ready — no Postgres needed)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env.local

# 3. Run the dev server (uses bundled SQLite seed)
npm run dev
```

The app starts at `http://localhost:3000`. The bundled `data/seed/app.db` contains 53 animations, 11 battle stat configs, the "cave" campaign, and the "blue"/"blue-copy" characters. No Postgres required.

## Environment Variables

Create `.env.local` (gitignored):

```env
# ----- Database -----
# Postgres (optional — omit to use the bundled SQLite seed instead)
DATABASE_URL=postgres://user:pass@localhost:5433/vid-to-sprite
DB_BACKEND=postgres

# ----- Firebase (optional — for asset uploads in the studio) -----
# Bucket must be provisioned (Blaze plan required)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=knight-and-dungeon
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## Database

### Option A: SQLite (default, no setup)

The app ships with a pre-seeded SQLite database at `data/seed/app.db`. On cold start (Vercel), `db.ts` copies it to `/tmp`. This is the deploy source of truth.

**Refresh the seed after CMS changes:**
```bash
sqlite3 data/app.db "VACUUM INTO 'data/seed/app.db'"
```

### Option B: PostgreSQL (local dev with Neon/self-hosted)

```bash
# Start Postgres (docker-compose.yml uses port 5433)
docker compose up -d

# Apply schema
psql -h localhost -p 5433 -U postgres -d vid-to-sprite -f data/schema.postgres.sql

# Set environment
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/vid-to-sprite
export DB_BACKEND=postgres
```

## Seed Data

```bash
# Seed battle stats + role maps + rewards (run against Postgres)
npx tsx data/seed-battle.ts
```

The seed script is idempotent — safe to re-run.

## Running

```bash
# Dev server
npm run dev

# Type-check
npx tsc --noEmit

# Determinism test (engine must produce byte-identical results)
npx tsx lib/battle/sanity.ts
# Expected output:
#   1v1: result=win events=11 units=2 hexes=29 deterministic=true
#   3v3: result=win events=34 units=6 hexes=29 deterministic=true
#   same-row: result=win events=9 units=2 hexes=29 deterministic=true
#   spell: result=win events=7 units=2 hexes=29 deterministic=true
```

## Building

```bash
npm run build
npm start
```

**Caution:** Don't `npm run build` while a `next dev` is running — shared `.next/` can corrupt and return 500s.

## Deploy to Vercel

```bash
npx vercel --prod
```

The project is pre-linked (`vercel.json` + `.vercel/project.json`). No Postgres needed — the SQLite seed handles reads. Key `next.config.ts` ensures:
- `better-sqlite3` is bundled via `serverExternalPackages`
- The seed DB is copied to `/tmp` on cold start (`ON_VERCEL` branch)

### Before deploying

If you made CMS changes in the studio, refresh the seed:
```bash
sqlite3 data/app.db "VACUUM INTO 'data/seed/app.db'"
git add data/seed/app.db
git commit -m "refresh app.db seed"
```

## Adding an Animation (MP4 → Spritesheet)

```bash
# 1. Convert MP4 to spritesheet PNG + JSON frame data
python3 add_animation.py source/<clip>.mp4 <kebab-name> \
  --assets-dir ./public/assets \
  --no-inject

# 2. Register the animation in the Postgres catalog
#    (insert into `animations` + `character_animations` via the studio UI
#     or write a seeder script)
```

The Python pipeline chromakeys green screen (default `0x04F108`), tiles frames at 160px per cell, 4 columns per row.

## Project Map

| Path | What |
|---|---|
| `lib/battle/` | Pure deterministic engine + frozen types |
| `app/api/battle/resolve/` | HTTP face of the engine |
| `app/studio/` | Animation studio CMS (imperative DOM + PixiJS) |
| `app/studio/mock-battle/` | Party builder + battle replayer |
| `app/g/camp/` | Campaign wave-runner (auto-battle dungeon) |
| `app/auth/campaigns/` | User-facing campaign selection ("Quest Log") |
| `lib/db/` | Drizzle ORM adapter (Postgres) |
| `data/schema.postgres.sql` | Raw DDL for Postgres deployment |
| `data/seed/app.db` | Bundled SQLite seed (deploy source of truth) |

## Gotchas

- **One `next dev` at a time** — two instances share `data/app.db` via separate Drizzle pool connections → inconsistent reads.
- **Studio POSTs the whole state** — `POST /api/config` overwrites `app_config`. Re-run the VACUUM before deploy if you edited studio data.
- **Spell tables are empty** by default — combat is melee-only until spells are seeded.
- **Firebase Storage bucket not provisioned** — asset upload code exists but won't work until the bucket is set up (Blaze plan required).
- **Battle logs** are saved to `battle_logs` table (Postgres) or discarded (SQLite seed mode). Only the last 10 per user are retained.
