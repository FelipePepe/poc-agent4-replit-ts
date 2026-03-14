/**
 * src/agents/parallel_executor.ts
 *
 * ParallelExecutorNode — Fase 3
 *
 * Executes all independent (pending) subtasks concurrently using Promise.all.
 * This achieves the Fase 3 exit criterion: total execution time < sum of
 * individual sequential times.
 *
 * Architecture:
 *  - makeParallelExecutorNode(workers) — factory that injects worker functions
 *  - Workers are keyed by subtask.type ("code", "search", "verify", "default")
 *  - Results are merged into state.parallel_results keyed by subtask.id
 *  - Timing metadata is stored under parallel_results._last_run
 *
 * Security notes:
 *  - Workers receive only the Subtask object, never raw shell commands or paths
 *  - No external I/O here; the parallelism is entirely in application memory
 */

import type { AgentState, Subtask } from "../core/state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A worker handles one subtask and returns a string result. */
export type WorkerFn = (subtask: Subtask) => Promise<string>;

/** Map of subtask type → worker function. "default" is the fallback. */
export type WorkerMap = Record<string, WorkerFn>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * makeParallelExecutorNode
 *
 * Returns a LangGraph node function that concurrently executes all pending
 * subtasks using the injected worker map.
 *
 * @param workers  Map from subtask.type to async handler.
 *                 Falls back to workers["default"] for unknown types.
 */
export function makeParallelExecutorNode(workers: WorkerMap) {
  return async function parallelExecutorNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const pending = state.subtasks.filter((s) => s.status === "pending");

    if (pending.length === 0) {
      return { active_agent: "parallel_executor" };
    }

    const startMs = Date.now();

    // -----------------------------------------------------------------
    // Fan-out: execute all pending subtasks concurrently
    // -----------------------------------------------------------------
    const execResults = await Promise.all(
      pending.map(async (subtask) => {
        const workerKey = subtask.type ?? "default";
        const worker = workers[workerKey] ?? workers["default"];
        const workerStart = Date.now();
        const result = await worker(subtask);
        const durationMs = Date.now() - workerStart;
        return { subtask, result, durationMs };
      })
    );

    const totalMs = Date.now() - startMs;

    // -----------------------------------------------------------------
    // Merge: update subtask statuses and build parallel_results
    // -----------------------------------------------------------------
    const resultMap = new Map(execResults.map((r) => [r.subtask.id, r]));

    const updatedSubtasks: Subtask[] = state.subtasks.map((s) => {
      const found = resultMap.get(s.id);
      if (found) {
        return { ...s, status: "done" as const, result: found.result };
      }
      return s;
    });

    const newParallelResults: Record<string, unknown> = {};
    execResults.forEach(({ subtask, result, durationMs }) => {
      newParallelResults[subtask.id] = { result, durationMs };
    });

    return {
      subtasks: updatedSubtasks,
      active_agent: "parallel_executor",
      parallel_results: {
        ...state.parallel_results,
        _last_run: { totalMs, count: execResults.length },
        ...newParallelResults,
      },
    };
  };
}
