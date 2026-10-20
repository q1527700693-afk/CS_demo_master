const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// backend/ 根目录，用于把相对 DB_PATH 解析到稳定位置。
const backendRoot = path.join(__dirname, '..', '..');

function resolveDbPath() {
    const raw = process.env.DB_PATH;

    if (!raw) {
        return path.join(backendRoot, 'data', 'cs-demo-master.db');
    }
    if (raw === ':memory:') {
        return raw;
    }
    return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw);
}

const dbPath = resolveDbPath();

if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new DatabaseSync(dbPath);

// node:sqlite 默认不开启外键约束，需手动开启。
db.exec('PRAGMA foreign_keys = ON;');

if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            nickname      TEXT    NOT NULL,
            avatar_url    TEXT,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

initSchema();

module.exports = {
    db,
    dbPath,
};
