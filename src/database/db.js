const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'elo.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────
// Schema (OpenSkill / TrueSkill & Champion Tracking)
// ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    discord_id    TEXT PRIMARY KEY,
    riot_puuid    TEXT UNIQUE,
    riot_name     TEXT NOT NULL,
    mu            REAL NOT NULL DEFAULT 25.0,
    sigma         REAL NOT NULL DEFAULT 8.333333,
    ordinal       REAL NOT NULL DEFAULT 0.0,
    rating        REAL NOT NULL DEFAULT 1000.0,
    peak_rating   REAL NOT NULL DEFAULT 1000.0,
    elo           REAL NOT NULL DEFAULT 1000.0,
    peak_elo      REAL NOT NULL DEFAULT 1000.0,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    match_id        TEXT PRIMARY KEY,
    recorded_at     TEXT NOT NULL DEFAULT (datetime('now')),
    recorded_by     TEXT NOT NULL,
    game_duration   INTEGER,
    avg_rating      REAL,
    avg_elo         REAL
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id        TEXT NOT NULL REFERENCES matches(match_id),
    discord_id      TEXT NOT NULL REFERENCES players(discord_id),
    team            INTEGER NOT NULL,  -- 100 = blue, 200 = red
    role            TEXT,
    champion        TEXT,
    kills           INTEGER DEFAULT 0,
    deaths          INTEGER DEFAULT 0,
    assists         INTEGER DEFAULT 0,
    cs              INTEGER DEFAULT 0,
    vision_score    INTEGER DEFAULT 0,
    damage_dealt    INTEGER DEFAULT 0,
    damage_taken    INTEGER DEFAULT 0,
    gold_earned     INTEGER DEFAULT 0,
    won             INTEGER NOT NULL,
    mu_before       REAL NOT NULL DEFAULT 25.0,
    mu_after        REAL NOT NULL DEFAULT 25.0,
    sigma_before    REAL NOT NULL DEFAULT 8.333333,
    sigma_after     REAL NOT NULL DEFAULT 8.333333,
    rating_before   REAL NOT NULL DEFAULT 1000.0,
    rating_after    REAL NOT NULL DEFAULT 1000.0,
    rating_delta    REAL NOT NULL DEFAULT 0.0,
    elo_before      REAL NOT NULL DEFAULT 1000.0,
    elo_after       REAL NOT NULL DEFAULT 1000.0,
    elo_delta       REAL NOT NULL DEFAULT 0.0,
    performance_mod REAL DEFAULT 0.0,
    PRIMARY KEY (match_id, discord_id)
  );

  CREATE TABLE IF NOT EXISTS champion_stats (
    discord_id      TEXT NOT NULL REFERENCES players(discord_id),
    champion        TEXT NOT NULL,
    games           INTEGER NOT NULL DEFAULT 0,
    wins            INTEGER NOT NULL DEFAULT 0,
    total_kills     INTEGER NOT NULL DEFAULT 0,
    total_deaths    INTEGER NOT NULL DEFAULT 0,
    total_assists   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (discord_id, champion)
  );

  CREATE TABLE IF NOT EXISTS leaderboard_widgets (
    channel_id    TEXT PRIMARY KEY,
    guild_id      TEXT,
    message_id    TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lobby_widgets (
    channel_id    TEXT PRIMARY KEY,
    guild_id      TEXT,
    message_id    TEXT NOT NULL,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lobbies (
    lobby_id                  TEXT PRIMARY KEY,
    guild_id                  TEXT NOT NULL,
    channel_id                TEXT NOT NULL,
    message_id                TEXT NOT NULL UNIQUE,
    announcement_message_id   TEXT,
    owner_id                  TEXT NOT NULL,
    scheduled_time            TEXT NOT NULL,
    title                     TEXT NOT NULL DEFAULT 'Inhouse 5v5',
    status                    TEXT NOT NULL DEFAULT 'open',
    teams_json                TEXT,
    created_at                TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lobby_players (
    lobby_id      TEXT NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
    slot_number   INTEGER NOT NULL,
    discord_id    TEXT NOT NULL REFERENCES players(discord_id),
    joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lobby_id, discord_id),
    UNIQUE (lobby_id, slot_number)
  );

  CREATE TABLE IF NOT EXISTS lobby_waitlist (
    lobby_id      TEXT NOT NULL REFERENCES lobbies(lobby_id) ON DELETE CASCADE,
    discord_id    TEXT NOT NULL REFERENCES players(discord_id),
    joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lobby_id, discord_id)
  );

  CREATE INDEX IF NOT EXISTS idx_mp_discord ON match_players(discord_id);
  CREATE INDEX IF NOT EXISTS idx_mp_match   ON match_players(match_id);
  CREATE INDEX IF NOT EXISTS idx_cs_discord ON champion_stats(discord_id);
  CREATE INDEX IF NOT EXISTS idx_lp_lobby   ON lobby_players(lobby_id);
  CREATE INDEX IF NOT EXISTS idx_lw_lobby   ON lobby_waitlist(lobby_id);
  CREATE INDEX IF NOT EXISTS idx_lobbies_msg ON lobbies(message_id);
  CREATE INDEX IF NOT EXISTS idx_lobby_widgets_msg ON lobby_widgets(message_id);
`);

// Non-destructive migrations for existing databases
try {
  db.exec('ALTER TABLE lobbies ADD COLUMN announcement_message_id TEXT;');
} catch (_) {}

module.exports = db;
