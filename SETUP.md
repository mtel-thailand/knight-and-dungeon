# Setup Guide

## Prerequisites

- **Node.js** 18.18+ (tested with 22.x)
- **npm** (bundled with Node)
- **ffmpeg + ffprobe** on PATH (required for the MP4 → spritesheet Python pipeline)
- **Python 3** (for `make_spritesheet.py` / `add_animation.py`)
- **PostgreSQL** (local dev via docker-compose or hosted Neon)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres
docker compose up -d

# 3. Apply schema + seed
psql -h localhost -p 5433 -U postgres -d vid-to-sprite -f data/schema.postgres.sql
npx tsx data/seed-battle.ts

# 4. Run migrations
npx drizzle-kit migrate

# 5. Set environment
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/vid-to-sprite

# 6. Start dev server
npm run dev
```

## Environment Variables

Create `.env.local` (gitignored):

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vid-to-sprite

# Firebase (optional — for asset uploads in the studio)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=knight-and-dungeon
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## Database

### Local (docker-compose)

```bash
docker compose up -d           # port 5433
psql -h localhost -p 5433 -U postgres -d vid-to-sprite -f data/schema.postgres.sql
npx drizzle-kit migrate        # apply pending migrations
```

### Hosted (Neon — Vercel-native)

1. Create a Neon project, copy the pooler connection string
2. Run `psql` against the Neon host with `data/schema.postgres.sql`
3. Run `npx drizzle-kit migrate` against Neon
4. Set `DATABASE_URL` to the pooler string in Vercel env vars

## Migrations

Migrations are managed with [Drizzle Kit](https://orm.drizzle.team/docs/kit-overview).

```bash
# Generate a new migration after schema changes
npx drizzle-kit generate

# Apply pending migrations
npx drizzle-kit migrate
```

Migration files live in `drizzle/` and are tracked in `drizzle/meta/_journal.json`.

## Seed Data

```bash
# Seed battle stats + role maps + rewards
npx tsx data/seed-battle.ts
```

Idempotent — safe to re-run.

## Running

```bash
npm run dev

# Type-check
npx tsc --noEmit

# Determinism test
npx tsx lib/battle/sanity.ts
```

## Building

```bash
npm run build
npm start
```

**Caution:** Don't `npm run build` while a `next dev` is running — shared `.next/` can corrupt.

## Deploy to Vercel

```bash
npx vercel --prod
```

The project is pre-linked (`.vercel/project.json`). Set `DATABASE_URL` to your Neon pooler string in Vercel project env vars.

## Adding an Animation (MP4 → Spritesheet)

```bash
python3 add_animation.py source/<clip>.mp4 <kebab-name> \
  --assets-dir ./public/assets \
  --no-inject

# Register the animation in the catalog via the studio UI
```

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
| `drizzle/` | Generated migration files |
| `drizzle.config.ts` | Drizzle Kit config |

## Gotchas

- **One `next dev` at a time** — two instances share the same Postgres pool → inconsistent reads.
- **Studio POSTs the whole state** — `POST /api/config` overwrites `app_config`.
- **Spell tables are empty** by default — combat is melee-only until spells are seeded.
- **Firebase Storage bucket not provisioned** — asset upload code exists but won't work until the bucket is set up (Blaze plan required).
- **Battle logs** are saved to `battle_logs` table. Only the last 10 per user are retained.
- **Migrations**: always generate a Drizzle migration after schema changes, and apply it before deploying.
