/**
 * core/db.ts
 *
 * SQLite initialisation with WAL mode.
 *
 * WAL is enabled from Phase 0 so that concurrent writes in Phase 3
 * (parallel agent execution) do NOT corrupt the database.
 *
 * Security:
 * - DB path comes from config (never from user input).
 * - PRAGMA foreign_keys = ON enforces referential integrity.
 * - All queries must use parameterised statements; never interpolate
 *   user-controlled values into SQL strings.
 *
 * Design:
 * - buildDb(path) is a pure factory — injectable and testable.
 * - getDb() is the application-level singleton backed by config.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Re-export the Database type for consumers
export type DbInstance = Database.Database;

// ---------------------------------------------------------------------------
// Pure factory — use this in tests (e.g. buildDb(":memory:"))
// ---------------------------------------------------------------------------

export function buildDb(dbPath: string): DbInstance {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // --- Mandatory pragmas (WAL + safety) ---
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  return db;
}

// ---------------------------------------------------------------------------
// Application-level singleton
// ---------------------------------------------------------------------------

let _db: DbInstance | null = null;

export function getDb(): DbInstance {
  if (!_db) {
    // Lazy import to avoid circular deps at module load time
    const { getConfig } = require("./config") as typeof import("./config");
    _db = buildDb(getConfig().dbPath);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ---------------------------------------------------------------------------
// Schema migrations (idempotent — always CREATE TABLE IF NOT EXISTS)
// ---------------------------------------------------------------------------

function runMigrations(db: DbInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'queued',
      payload     TEXT NOT NULL DEFAULT '{}',
      result      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      snapshot_id TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
      git_commit  TEXT NOT NULL,
      state_json  TEXT NOT NULL,
      trigger     TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key         TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS a2a_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      from_agent  TEXT NOT NULL,
      to_agent    TEXT NOT NULL,
      msg_type    TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS task_locks (
      task_id     TEXT PRIMARY KEY,
      locked_by   TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS task_artifacts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS task_metrics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       TEXT NOT NULL,
      metric_name   TEXT NOT NULL,
      metric_value  REAL NOT NULL,
      recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);
}
