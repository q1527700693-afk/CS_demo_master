'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');

/**
 * Schema for the account and the personal card.
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
 */
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
    steam_id       TEXT UNIQUE,
    wanmei_id      TEXT UNIQUE,
    five_e_id      TEXT UNIQUE,
    other_game_ids TEXT,
    skill_level    TEXT,
    looking_for    TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
`;

/**
 * Open (and initialise) a database. `:memory:` gives every test run a clean one.
 */
function createDatabase(file = process.env.DB_PATH || DEFAULT_DB_PATH) {
    if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }

    const database = new DatabaseSync(file);
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(SCHEMA);
    return database;
}

const db = createDatabase();

module.exports = { db, createDatabase, DEFAULT_DB_PATH, SCHEMA };
