/**
 * src/snapshots/engine.ts
 *
 * SnapshotEngine — Fase 6
 *
 * Responsibilities:
 *  - takeSnapshot:    git add -A + commit in sandboxDir, persist metadata to SQLite.
 *  - restoreSnapshot: checkout files from the saved git commit, return AgentState.
 *  - listSnapshots:   query SQLite for all snapshots belonging to a task_id.
 *
 * Security notes:
 *  - No user-supplied strings are interpolated into shell commands; all args are
 *    passed as discrete array elements to execFileSync (no shell injection vector).
 *  - sandboxDir isolation: git operations are scoped to the provided directory.
 *  - UUIDs come from crypto.randomUUID() — cryptographically random, no collisions.
 */

import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import type { DbInstance } from "../core/db";
import type { AgentState } from "../core/state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  snapshot_id: string;
  task_id: string;
  timestamp: string;
  git_commit: string;
  state_json: string;
  trigger: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the current HEAD commit hash in the given directory. */
function headCommit(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf-8",
  }).trim();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * makeSnapshotEngine
 *
 * @param sandboxDir - Absolute path to the agent sandbox directory.
 *                     Must already be a git repository (git init called externally).
 * @param db         - An open better-sqlite3 database with the snapshots table.
 */
export function makeSnapshotEngine(sandboxDir: string, db: DbInstance) {
  // -------------------------------------------------------------------
  // takeSnapshot
  // -------------------------------------------------------------------

  /**
   * Stage all files in sandboxDir, create a git commit, and persist snapshot
   * metadata (including the full AgentState serialised as JSON) to SQLite.
   *
   * Returns the UUID snapshot_id for later retrieval.
   */
  async function takeSnapshot(
    state: AgentState,
    trigger: string
  ): Promise<string> {
    const snapshotId = randomUUID();
    const taskId = state.task_id || "default";

    // Stage everything in the sandbox
    execFileSync("git", ["add", "-A"], { cwd: sandboxDir });

    // Create commit (--allow-empty covers the case with no file changes)
    execFileSync(
      "git",
      ["commit", "--allow-empty", "-m", `snapshot:${snapshotId}`],
      { cwd: sandboxDir }
    );

    const gitCommit = headCommit(sandboxDir);
    const stateJson = JSON.stringify(state);

    db.prepare(
      `INSERT INTO snapshots (snapshot_id, task_id, git_commit, state_json, trigger)
       VALUES (?, ?, ?, ?, ?)`
    ).run(snapshotId, taskId, gitCommit, stateJson, trigger);

    return snapshotId;
  }

  // -------------------------------------------------------------------
  // restoreSnapshot
  // -------------------------------------------------------------------

  /**
   * Restore sandboxDir file tree to the state captured in the snapshot and
   * return the persisted AgentState.  Returns null if snapshotId is unknown.
   */
  async function restoreSnapshot(
    snapshotId: string
  ): Promise<AgentState | null> {
    const row = db
      .prepare("SELECT * FROM snapshots WHERE snapshot_id = ?")
      .get(snapshotId) as SnapshotRow | undefined;

    if (!row) return null;

    // Restore tracked files to the exact commit — does not move HEAD.
    // If the commit has an empty tree (no tracked files), git errors; that is
    // safe to ignore — there are simply no files to restore.
    try {
      execFileSync("git", ["checkout", row.git_commit, "--", "."], {
        cwd: sandboxDir,
      });
    } catch {
      // empty-tree commit: nothing to restore to the working directory
    }

    return JSON.parse(row.state_json) as AgentState;
  }

  // -------------------------------------------------------------------
  // listSnapshots
  // -------------------------------------------------------------------

  /**
   * Returns all snapshot rows for the given task_id, ordered chronologically.
   */
  function listSnapshots(taskId: string): SnapshotRow[] {
    return db
      .prepare(
        "SELECT * FROM snapshots WHERE task_id = ? ORDER BY timestamp"
      )
      .all(taskId) as SnapshotRow[];
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  return { takeSnapshot, restoreSnapshot, listSnapshots };
}
