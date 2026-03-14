/**
 * src/api/task_service.ts — Fase 8
 *
 * InMemoryTaskService: creates and retrieves tasks without persistence.
 *
 * Design:
 *  - Injectable via createApp(service?) for full testability.
 *  - Task IDs use crypto.randomUUID() — no sequential ints, no UUIDs via deps.
 *  - Status transitions are intentionally simple for the PoC: tasks sit at
 *    "queued". When a GraphRunner is provided to createApp, the status moves
 *    to "processing" immediately and then to "completed" / "failed" after the
 *    runner settles.
 *
 * Security:
 *  - No secrets, no filesystem access here.
 *  - prompt is validated at the HTTP layer (server.ts) before reaching here.
 */

import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export interface TaskDetail {
  /** Unique task identifier. */
  taskId: string;
  /** Lifecycle status of the task. */
  status: TaskStatus;
  /** Steps completed out of total (0 = not started). */
  progress: number;
  /** File paths produced by the agent for this task. */
  artifacts: string[];
  /** User-supplied task description. */
  prompt: string;
  /** Result text or error message (set on completion or failure). */
  result?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * InMemoryTaskService
 *
 * Stores tasks in a plain Map<string, TaskDetail>. Suitable for testing and
 * single-process demos; not persistent across restarts.
 */
export class InMemoryTaskService {
  private readonly tasks = new Map<string, TaskDetail>();

  /**
   * createTask
   *
   * Creates a new task in "queued" state with a unique ID.
   * The prompt is stored on the task for later use by the graph runner.
   *
   * @param opts.prompt  User-supplied task description (already validated).
   */
  createTask({ prompt }: { prompt: string }): TaskDetail {
    const taskId = `task_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const task: TaskDetail = {
      taskId,
      status: "queued",
      progress: 0,
      artifacts: [],
      prompt,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * updateTask
   *
   * Applies a partial patch to the task identified by taskId.
   * No-op when the taskId is not found (never throws).
   *
   * @param taskId  Task to update.
   * @param patch   Partial fields to merge into the task.
   */
  updateTask(
    taskId: string,
    patch: Partial<Omit<TaskDetail, "taskId">>
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, patch);
  }

  /**
   * getTask
   *
   * Returns the TaskDetail for the given ID, or null if not found.
   */
  getTask(taskId: string): TaskDetail | null {
    return this.tasks.get(taskId) ?? null;
  }
}
