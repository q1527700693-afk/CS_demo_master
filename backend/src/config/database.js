'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');
const DEFAULT_TTL_HOURS = 24;

/**
 * Schema for the account, the personal card and the lobby hall.
 *
 * - `users` keeps the credentials and the avatar URL (see backend/TASKS.md 4.2).
 * - `user_profiles` keeps the card itself, using the column names from
 *   TASKS.md 4.2 (`bio`, `steam_id`, `wanmei_id`, `five_e_id`,
 *   `other_game_ids`) plus `skill_level` / `looking_for` required by 4.4.
 *   `steam_id` / `wanmei_id` / `five_e_id` are NULL when the platform is not
 *   bound, so the UNIQUE indexes still guarantee "one platform account, one
 *   user" while letting any number of users skip a platform.
 * - `other_game_ids` is stored as a JSON array because it is only ever read as
 *   a whole, never filtered on.
 * - `lobbies` is a recruitment post. `current_players` is *declared* by the
 *   owner (for example 4 of a 5 player team), `team_code` is the in-game code
 *   that makes the post useful, and `expires_at` lets stale posts disappear.
 *   `departed_at` is set when the owner "发车": the post is then hidden from
 *   everyone except the owner and stops accepting claims.
 * - `lobby_claims` records only the users who revealed the code. These are the
 *   "virtual" players: getting the code does not mutate the declared roster.
 *   A row starts as `claimed`; the owner can turn it into `kicked`, which hides
 *   it from the claimant list and blocks that user from claiming again.
 * - `friendships` stores both pending requests and accepted friendships in one
 *   canonical pair (`user_low_id < user_high_id`), so A→B and B→A can never
 *   create two rows. Rejected/cancelled requests are deleted; accepted rows are
 *   kept until either user removes the friend.
 */
/**
 * Lightweight schema migration for databases created before a column existed.
 */
function ensureColumns(database) {
    const columns = database
        .prepare('PRAGMA table_info(user_profiles)')
        .all()
        .map((column) => column.name);

    if (!columns.includes('steam_friend_code')) {
        database.exec('ALTER TABLE user_profiles ADD COLUMN steam_friend_code TEXT');
    }
}

/**
 * Migrate the lobby prototype that had `max_members` / `lobby_members`.
 *
 * New columns are nullable when added to an existing table, so rows from the
 * old prototype are expired (they have no `team_code`) and cleaned up lazily.
 * `lobby_members` is intentionally left alone in existing databases; new code
 * uses `lobby_claims`.
 */
function ensureLobbyColumns(database) {
    const columns = new Set(
        database
            .prepare('PRAGMA table_info(lobbies)')
            .all()
            .map((column) => column.name)
    );

    if (!columns.has('team_size')) {
        database.exec('ALTER TABLE lobbies ADD COLUMN team_size INTEGER NOT NULL DEFAULT 5');
    }
    if (!columns.has('current_players')) {
        database.exec('ALTER TABLE lobbies ADD COLUMN current_players INTEGER NOT NULL DEFAULT 1');
    }
    if (!columns.has('team_code')) {
        database.exec('ALTER TABLE lobbies ADD COLUMN team_code TEXT');
    }
    if (!columns.has('expires_at')) {
        database.exec('ALTER TABLE lobbies ADD COLUMN expires_at TEXT');
    }
    if (!columns.has('departed_at')) {
        database.exec('ALTER TABLE lobbies ADD COLUMN departed_at TEXT');
    }

    const now = new Date();
    // A post without a code is from the discarded prototype and cannot be
    // claimed, so let the normal expiry sweep remove it.
    database
        .prepare("UPDATE lobbies SET expires_at = ? WHERE team_code IS NULL OR team_code = ''")
        .run(now.toISOString());
    database
        .prepare('UPDATE lobbies SET expires_at = ? WHERE expires_at IS NULL')
        .run(new Date(now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString());

    database.exec('CREATE INDEX IF NOT EXISTS idx_lobbies_expires ON lobbies (expires_at)');
}

/**
 * Add the claim status used by "kick".
 *
 * Rows created before this column existed were all active claims, so SQLite's
 * DEFAULT 'claimed' backfills them correctly.
 */
function ensureLobbyClaimColumns(database) {
    const columns = new Set(
        database
            .prepare('PRAGMA table_info(lobby_claims)')
            .all()
            .map((column) => column.name)
    );

    if (!columns.has('status')) {
        database.exec(
            "ALTER TABLE lobby_claims ADD COLUMN status TEXT NOT NULL DEFAULT 'claimed'"
        );
    }
    if (!columns.has('kicked_at')) {
        database.exec('ALTER TABLE lobby_claims ADD COLUMN kicked_at TEXT');
    }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname      TEXT,
    avatar_url    TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    bio            TEXT,
    steam_id           TEXT UNIQUE,
    steam_friend_code  TEXT,
    wanmei_id          TEXT UNIQUE,
    five_e_id          TEXT UNIQUE,
    other_game_ids TEXT,
    skill_level    TEXT,
    looking_for    TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lobbies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    mode            TEXT NOT NULL DEFAULT 'competitive',
    map             TEXT,
    region          TEXT,
    skill_level     TEXT,
    team_size       INTEGER NOT NULL,
    current_players INTEGER NOT NULL,
    team_code       TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    departed_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lobby_claims (
    lobby_id   INTEGER NOT NULL REFERENCES lobbies (id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    claimed_at TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'claimed',
    kicked_at  TEXT,
    PRIMARY KEY (lobby_id, user_id)
);

CREATE TABLE IF NOT EXISTS friendships (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_low_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_high_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    requester_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    accepted_at   TEXT,
    UNIQUE (user_low_id, user_high_id),
    CHECK (user_low_id < user_high_id),
    CHECK (requester_id IN (user_low_id, user_high_id)),
    CHECK (status IN ('pending', 'accepted'))
);

CREATE INDEX IF NOT EXISTS idx_lobbies_mode
    ON lobbies (mode);
CREATE INDEX IF NOT EXISTS idx_lobby_claims_lobby
    ON lobby_claims (lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_claims_user
    ON lobby_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_low_status
    ON friendships (user_low_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_high_status
    ON friendships (user_high_id, status);
`;

/**
 * Open (and initialise) a database. `:memory:` gives every test run a clean one.
 */
function createDatabase(file = process.env.DB_PATH || DEFAULT_DB_PATH) {
    if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }

    const database = new DatabaseSync(file);
    database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(SCHEMA);
    ensureColumns(database);
    ensureLobbyColumns(database);
    ensureLobbyClaimColumns(database);
    return database;
}

const db = createDatabase();

module.exports = { db, createDatabase, DEFAULT_DB_PATH, SCHEMA };
