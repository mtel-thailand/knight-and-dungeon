-- PostgreSQL schema for vid-to-sprite.
-- Translated from the SQLite CREATE TABLE statements in app/api/config/db.ts.
-- All migration columns are included directly (no ALTER TABLE needed in Postgres).

CREATE TABLE IF NOT EXISTS app_config (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS animations (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    image       TEXT,
    frame_data  TEXT,
    derive_from TEXT,
    reverse     INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_animations (
    character_id  TEXT NOT NULL,
    animation_key TEXT NOT NULL,
    duration      DOUBLE PRECISION,
    loop          INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, animation_key)
);

CREATE TABLE IF NOT EXISTS character_battle_stats (
    character_id  TEXT PRIMARY KEY,
    hp            INTEGER NOT NULL,
    attack        INTEGER NOT NULL,
    defense       INTEGER NOT NULL,
    action_speed  DOUBLE PRECISION NOT NULL,
    "range"       INTEGER NOT NULL,
    skills        TEXT NOT NULL DEFAULT '[]',
    attack_type   TEXT NOT NULL DEFAULT 'melee'
);

CREATE TABLE IF NOT EXISTS character_event_roles (
    character_id  TEXT NOT NULL,
    role          TEXT NOT NULL,
    action_id     TEXT NOT NULL,
    PRIMARY KEY (character_id, role)
);

CREATE TABLE IF NOT EXISTS battle_map_config (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    tile_width        DOUBLE PRECISION,
    tile_height_ratio DOUBLE PRECISION,
    scale             DOUBLE PRECISION,
    rotation          DOUBLE PRECISION,
    rotation_x        DOUBLE PRECISION NOT NULL DEFAULT 0,
    rotation_y        DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS damage_config (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spells (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    animation_key   TEXT,
    type            TEXT NOT NULL DEFAULT 'attack',
    power           DOUBLE PRECISION NOT NULL DEFAULT 1,
    cooldown        DOUBLE PRECISION NOT NULL DEFAULT 0,
    fps             DOUBLE PRECISION,
    scale           DOUBLE PRECISION,
    scale_x         DOUBLE PRECISION,
    scale_y         DOUBLE PRECISION,
    loop            INTEGER,
    duration        DOUBLE PRECISION,
    offset_x        DOUBLE PRECISION,
    offset_y        DOUBLE PRECISION,
    rotation        DOUBLE PRECISION,
    transition_in   TEXT,
    transition_out  TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS campaigns (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    wave_count   INTEGER NOT NULL DEFAULT 1,
    monster_pool TEXT NOT NULL DEFAULT '[]',
    is_active    INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_one_active
    ON campaigns (is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS character_spells (
    character_id TEXT NOT NULL,
    spell_id     TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (character_id, spell_id)
);

CREATE TABLE IF NOT EXISTS mock_battle_roster (
    id   INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);
