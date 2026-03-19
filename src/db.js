const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'blog.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT,
        published_at TEXT NOT NULL,
        updated_at TEXT,
        file_path TEXT NOT NULL,
        file_mtime INTEGER NOT NULL,
        tags TEXT -- JSON array of tags
    );

    CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        actor_url TEXT,
        created_at TEXT NOT NULL,
        activity_id TEXT UNIQUE,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        UNIQUE(post_id, actor_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        parent_id INTEGER,
        actor_id TEXT NOT NULL,
        actor_url TEXT,
        actor_name TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        activity_id TEXT UNIQUE,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (parent_id) REFERENCES comments(id)
    );

    CREATE TABLE IF NOT EXISTS shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        actor_url TEXT,
        created_at TEXT NOT NULL,
        activity_id TEXT UNIQUE,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        UNIQUE(post_id, actor_id)
    );

    CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        object TEXT NOT NULL,
        target TEXT,
        received_at TEXT NOT NULL,
        processed BOOLEAN DEFAULT 0
    );
`);

// Migration: Add parent_id column to existing comments table
try {
    db.exec(`ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id)`);
    console.log('[DB] Migration: Added parent_id column to comments table');
} catch (err) {
    // Column already exists, ignore error
    if (!err.message.includes('duplicate column')) {
        console.error('[DB] Migration error:', err.message);
    }
}

module.exports = db;
