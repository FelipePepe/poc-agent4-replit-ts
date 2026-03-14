/**
 * tests/test_snapshot_engine.test.ts
 *
 * RED tests for snapshots/engine.ts — Fase 6
 * TDD: these tests must fail before src/snapshots/engine.ts exists.
 *
 * Uses a real temp git repository and in-memory SQLite.
 * Integration tests — exercises actual git and fs operations.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

import { buildDb } from "../src/core/db";
import { makeSnapshotEngine, type SnapshotRow } from "../src/snapshots/engine";
import type { AgentState } from "../src/core/state";
import { HumanMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBaseState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    messages: [new HumanMessage("create hello.py")],
    tool_calls: [],
    error_count: 0,
    current_model: "claude-sonnet",
    task_id: "task-snap-001",
    subtasks: [],
    active_agent: "supervisor",
    parallel_results: {},
    active_instructions: [],
    consecutive_errors: 0,
    model_switches: 0,
    snapshot_id: null,
    ...overrides,
  };
}

/** Initialise a bare git repo in tmpDir — needed before any git operations. */
function initGitRepo(tmpDir: string): void {
  execFileSync("git", ["init"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.email", "test@agent.local"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.name", "AgentTest"], { cwd: tmpDir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tmpDir });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("makeSnapshotEngine", () => {
  let sandboxDir: string;
  let db: ReturnType<typeof buildDb>;
  let engine: ReturnType<typeof makeSnapshotEngine>;
  const TASK_ID = "task-snap-001";

  beforeEach(() => {
    sandboxDir = mkdtempSync(path.join(os.tmpdir(), "agent-snap-"));
    initGitRepo(sandboxDir);
    db = buildDb(":memory:");
    // Ensure task row exists (FK requirement)
    db.prepare("INSERT INTO tasks (id, payload) VALUES (?, ?)").run(TASK_ID, "{}");
    engine = makeSnapshotEngine(sandboxDir, db);
  });

  afterEach(() => {
    db.close();
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  // --- Factory ---

  it("makeSnapshotEngine returns object with takeSnapshot, restoreSnapshot, listSnapshots", () => {
    expect(typeof engine.takeSnapshot).toBe("function");
    expect(typeof engine.restoreSnapshot).toBe("function");
    expect(typeof engine.listSnapshots).toBe("function");
  });

  // --- takeSnapshot ---

  it("takeSnapshot returns a non-empty snapshot_id string", async () => {
    const state = makeBaseState();
    const id = await engine.takeSnapshot(state, "pre-write_file");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("takeSnapshot records a git commit in the sandbox", async () => {
    const state = makeBaseState();
    await engine.takeSnapshot(state, "pre-write_file");
    const log = execFileSync("git", ["log", "--oneline"], {
      cwd: sandboxDir,
      encoding: "utf-8",
    });
    expect(log.trim().length).toBeGreaterThan(0);
    expect(log.split("\n").length).toBeGreaterThanOrEqual(2); // init + snapshot commit
  });

  it("takeSnapshot stores metadata in SQLite snapshots table", async () => {
    const state = makeBaseState();
    const id = await engine.takeSnapshot(state, "pre-execute_shell");
    const row = db
      .prepare("SELECT * FROM snapshots WHERE snapshot_id = ?")
      .get(id) as SnapshotRow | undefined;
    expect(row).toBeDefined();
    expect(row?.task_id).toBe(TASK_ID);
    expect(row?.trigger).toBe("pre-execute_shell");
    expect(row?.git_commit).toBeDefined();
    expect(row?.git_commit.length).toBeGreaterThan(0);
  });

  it("takeSnapshot serialises AgentState into state_json column", async () => {
    const state = makeBaseState({ error_count: 3 });
    const id = await engine.takeSnapshot(state, "manual");
    const row = db
      .prepare("SELECT state_json FROM snapshots WHERE snapshot_id = ?")
      .get(id) as { state_json: string } | undefined;
    const restored = JSON.parse(row!.state_json) as AgentState;
    expect(restored.error_count).toBe(3);
  });

  it("takeSnapshot includes modified files in the git commit", async () => {
    writeFileSync(path.join(sandboxDir, "hello.py"), "print('hello')");
    const state = makeBaseState();
    const id = await engine.takeSnapshot(state, "pre-write_file");
    const show = execFileSync("git", ["show", "--name-only", "--format="], {
      cwd: sandboxDir,
      encoding: "utf-8",
    });
    expect(show).toContain("hello.py");
    expect(id.length).toBeGreaterThan(0);
  });

  // --- listSnapshots ---

  it("listSnapshots returns all snapshots for a task_id in chronological order", async () => {
    const state = makeBaseState();
    await engine.takeSnapshot(state, "first");
    await engine.takeSnapshot(state, "second");
    const list = engine.listSnapshots(TASK_ID);
    expect(list.length).toBe(2);
    expect(list[0].trigger).toBe("first");
    expect(list[1].trigger).toBe("second");
  });

  it("listSnapshots returns empty array for unknown task_id", () => {
    const list = engine.listSnapshots("non-existent-task");
    expect(list).toEqual([]);
  });

  // --- restoreSnapshot ---

  it("restoreSnapshot returns null for unknown snapshot_id", async () => {
    const result = await engine.restoreSnapshot("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("restoreSnapshot returns the original AgentState", async () => {
    const state = makeBaseState({ consecutive_errors: 5 });
    const id = await engine.takeSnapshot(state, "before-damage");
    const restored = await engine.restoreSnapshot(id);
    expect(restored?.consecutive_errors).toBe(5);
  });

  it("takeSnapshot uses 'default' task_id when state.task_id is empty", async () => {
    db.prepare("INSERT OR IGNORE INTO tasks (id, payload) VALUES (?, ?)").run(
      "default",
      "{}"
    );
    const state = makeBaseState({ task_id: "" });
    const id = await engine.takeSnapshot(state, "edge-case");
    const row = db
      .prepare("SELECT task_id FROM snapshots WHERE snapshot_id = ?")
      .get(id) as { task_id: string } | undefined;
    expect(row?.task_id).toBe("default");
  });

  it("restoreSnapshot reverts file contents to the snapshot state", async () => {
    // Write initial content and take snapshot
    const filePath = path.join(sandboxDir, "app.py");
    writeFileSync(filePath, "# version 1");
    const state = makeBaseState();
    const id = await engine.takeSnapshot(state, "before-change");

    // Modify the file (simulating agent damage)
    writeFileSync(filePath, "# version 2 — damaged");
    expect(readFileSync(filePath, "utf-8")).toBe("# version 2 — damaged");

    // Restore the snapshot
    await engine.restoreSnapshot(id);

    // File should be back to version 1
    expect(readFileSync(filePath, "utf-8")).toBe("# version 1");
  });
});
