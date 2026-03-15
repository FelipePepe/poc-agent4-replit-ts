/**
 * tests/test_db.test.ts
 *
 * RED tests for core/db.ts — Fase 0
 * TDD: these tests must fail before src/core/db.ts exists.
 *
 * Uses :memory: database — never touches the filesystem.
 */

import { buildDb, getDb, closeDb, type DbInstance } from "../src/core/db";
import { resetConfig } from "../src/core/config";
import os from "os";
import path from "path";
import fs from "fs";

describe("buildDb", () => {
  let db: DbInstance;

  beforeEach(() => {
    db = buildDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("WAL and safety pragmas", () => {
    it("enables WAL journal mode (file-based db)", () => {
      // :memory: doesn't support WAL — use a temp file
      const tmpPath = path.join(os.tmpdir(), `test-wal-${Date.now()}.db`);
      const fileDb = buildDb(tmpPath);
      try {
        const row = fileDb.prepare("PRAGMA journal_mode").get() as {
          journal_mode: string;
        };
        expect(row.journal_mode).toBe("wal");
      } finally {
        fileDb.close();
        fs.rmSync(tmpPath, { force: true });
        fs.rmSync(`${tmpPath}-wal`, { force: true });
        fs.rmSync(`${tmpPath}-shm`, { force: true });
      }
    });

    it("enables foreign keys", () => {
      const row = db.prepare("PRAGMA foreign_keys").get() as {
        foreign_keys: number;
      };
      expect(row.foreign_keys).toBe(1);
    });
  });

  describe("schema — all 8 required tables exist", () => {
    const REQUIRED_TABLES = [
      "tasks",
      "task_events",
      "snapshots",
      "idempotency_keys",
      "a2a_messages",
      "task_locks",
      "task_artifacts",
      "task_metrics",
    ];

    for (const table of REQUIRED_TABLES) {
      it(`table '${table}' exists`, () => {
        const row = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
          )
          .get(table) as { name: string } | undefined;
        expect(row?.name).toBe(table);
      });
    }
  });

  describe("tasks table", () => {
    it("can insert and retrieve a task", () => {
      db.prepare(
        "INSERT INTO tasks (id, status, payload) VALUES (?, ?, ?)"
      ).run("task-1", "queued", '{"prompt":"hello"}');
      const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get("task-1") as {
        id: string;
        status: string;
        payload: string;
      };
      expect(row.id).toBe("task-1");
      expect(row.status).toBe("queued");
    });

    it("status defaults to queued", () => {
      db.prepare(
        "INSERT INTO tasks (id, payload) VALUES (?, ?)"
      ).run("task-2", '{"prompt":"test"}');
      const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-2") as {
        status: string;
      };
      expect(row.status).toBe("queued");
    });
  });

  describe("task_events table", () => {
    it("can insert an event linked to a task", () => {
      db.prepare(
        "INSERT INTO tasks (id, payload) VALUES (?, ?)"
      ).run("task-e1", "{}");
      db.prepare(
        "INSERT INTO task_events (task_id, event_type, payload) VALUES (?, ?, ?)"
      ).run("task-e1", "task_started", "{}");
      const row = db
        .prepare("SELECT * FROM task_events WHERE task_id = ?")
        .get("task-e1") as { task_id: string; event_type: string };
      expect(row.event_type).toBe("task_started");
    });

    it("enforces foreign key — rejects event for non-existent task", () => {
      expect(() => {
        db.prepare(
          "INSERT INTO task_events (task_id, event_type, payload) VALUES (?, ?, ?)"
        ).run("non-existent", "task_started", "{}");
      }).toThrow();
    });
  });

  describe("idempotency_keys table", () => {
    it("can store and retrieve an idempotency key", () => {
      db.prepare(
        "INSERT INTO tasks (id, payload) VALUES (?, ?)"
      ).run("task-i1", "{}");
      db.prepare(
        "INSERT INTO idempotency_keys (key, task_id) VALUES (?, ?)"
      ).run("idem-key-123", "task-i1");
      const row = db
        .prepare("SELECT * FROM idempotency_keys WHERE key = ?")
        .get("idem-key-123") as { key: string; task_id: string };
      expect(row.task_id).toBe("task-i1");
    });

    it("rejects duplicate idempotency key", () => {
      db.prepare(
        "INSERT INTO tasks (id, payload) VALUES (?, ?)"
      ).run("task-i2", "{}");
      db.prepare(
        "INSERT INTO idempotency_keys (key, task_id) VALUES (?, ?)"
      ).run("dup-key", "task-i2");
      expect(() => {
        db.prepare(
          "INSERT INTO idempotency_keys (key, task_id) VALUES (?, ?)"
        ).run("dup-key", "task-i2");
      }).toThrow();
    });
  });

  describe("buildDb is idempotent — same instance on same path", () => {
    it("in-memory creates fresh DB each call (independent instances)", () => {
      const db2 = buildDb(":memory:");
      // Both should be independent and functional
      expect(db2.prepare("PRAGMA journal_mode").get()).toBeDefined();
      db2.close();
    });
  });
});

// ---------------------------------------------------------------------------
// getDb / closeDb singleton
// ---------------------------------------------------------------------------

describe("getDb singleton", () => {
  const SAVED: Record<string, string | undefined> = {};

  beforeEach(() => {
    SAVED.GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
    SAVED.LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY;
    SAVED.DB_PATH = process.env.DB_PATH;
    process.env.GITHUB_OAUTH_TOKEN = "ghp_test-oauth";
    process.env.LANGSMITH_API_KEY = "ls-test";
    process.env.DB_PATH = ":memory:";
    resetConfig();
    closeDb();
  });

  afterEach(() => {
    closeDb();
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    resetConfig();
  });

  it("returns a functional database instance", () => {
    const db = getDb();
    expect(db).toBeDefined();
    expect(db.prepare("PRAGMA journal_mode").get()).toBeDefined();
  });

  it("caches the instance — returns same object on second call", () => {
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
  });

  it("closeDb sets singleton to null so next getDb opens fresh", () => {
    const first = getDb();
    closeDb();
    const second = getDb();
    expect(first).not.toBe(second);
  });

  it("closeDb is safe to call when db is already null", () => {
    closeDb();
    expect(() => closeDb()).not.toThrow();
  });
});
