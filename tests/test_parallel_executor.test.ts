/**
 * tests/test_parallel_executor.test.ts
 *
 * RED tests for agents/parallel_executor.ts — Fase 3
 * TDD: these must fail before the implementation exists.
 *
 * Key exit criterion: parallel execution time < sum of sequential times.
 */

import { HumanMessage } from "@langchain/core/messages";
import { makeParallelExecutorNode, type WorkerMap } from "../src/agents/parallel_executor";
import type { AgentState } from "../src/core/state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Artificial async delay — simulates real work. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    messages: [new HumanMessage("run tasks")],
    tool_calls: [],
    error_count: 0,
    current_model: "claude-sonnet",
    task_id: "task-par-001",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeParallelExecutorNode", () => {
  it("returns a function (node)", () => {
    const node = makeParallelExecutorNode({});
    expect(typeof node).toBe("function");
  });

  it("returns active_agent 'parallel_executor' when no pending subtasks", async () => {
    const node = makeParallelExecutorNode({});
    const state = makeState({ subtasks: [] });
    const result = await node(state);
    expect(result.active_agent).toBe("parallel_executor");
  });

  it("calls a worker for each pending subtask", async () => {
    const called: string[] = [];
    const workers: WorkerMap = {
      code: async (subtask) => {
        called.push(subtask.id);
        return "done";
      },
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "write a", type: "code", status: "pending" },
        { id: "s2", description: "write b", type: "code", status: "pending" },
      ],
    });
    await node(state);
    expect(called).toContain("s1");
    expect(called).toContain("s2");
  });

  it("skips non-pending subtasks", async () => {
    const called: string[] = [];
    const workers: WorkerMap = {
      code: async (subtask) => {
        called.push(subtask.id);
        return "done";
      },
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "done task", type: "code", status: "done" },
        { id: "s2", description: "pending task", type: "code", status: "pending" },
      ],
    });
    await node(state);
    expect(called).not.toContain("s1");
    expect(called).toContain("s2");
  });

  it("marks processed subtasks as done", async () => {
    const workers: WorkerMap = {
      code: async () => "result-a",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task a", type: "code", status: "pending" },
      ],
    });
    const result = await node(state);
    const updated = result.subtasks!.find((s) => s.id === "s1");
    expect(updated?.status).toBe("done");
  });

  it("stores worker result in subtask.result", async () => {
    const workers: WorkerMap = {
      search: async () => "search-output",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "search docs", type: "search", status: "pending" },
      ],
    });
    const result = await node(state);
    const updated = result.subtasks!.find((s) => s.id === "s1");
    expect(updated?.result).toBe("search-output");
  });

  it("populates parallel_results with per-subtask entries", async () => {
    const workers: WorkerMap = {
      code: async () => "r1",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task", type: "code", status: "pending" },
      ],
    });
    const result = await node(state);
    expect(result.parallel_results).toHaveProperty("s1");
  });

  it("parallel_results entry includes result and durationMs", async () => {
    const workers: WorkerMap = {
      code: async () => "output",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task", type: "code", status: "pending" },
      ],
    });
    const result = await node(state);
    const entry = result.parallel_results!["s1"] as { result: string; durationMs: number };
    expect(entry.result).toBe("output");
    expect(typeof entry.durationMs).toBe("number");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses 'default' worker fallback for unknown subtask type", async () => {
    let usedFallback = false;
    const workers: WorkerMap = {
      default: async () => {
        usedFallback = true;
        return "fallback";
      },
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task", type: "verify", status: "pending" },
      ],
    });
    await node(state);
    expect(usedFallback).toBe(true);
  });

  it("uses 'default' worker for subtask with no type field", async () => {
    let usedDefault = false;
    const workers: WorkerMap = {
      default: async () => {
        usedDefault = true;
        return "default-result";
      },
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        // type intentionally omitted → undefined → falls back to "default"
        { id: "s1", description: "no-type task", status: "pending" },
      ],
    });
    await node(state);
    expect(usedDefault).toBe(true);
  });

  it("records _last_run metadata with totalMs and count", async () => {
    const workers: WorkerMap = {
      code: async () => "x",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "a", type: "code", status: "pending" },
        { id: "s2", description: "b", type: "code", status: "pending" },
      ],
    });
    const result = await node(state);
    const meta = result.parallel_results!["_last_run"] as { totalMs: number; count: number };
    expect(meta.count).toBe(2);
    expect(typeof meta.totalMs).toBe("number");
  });

  /**
   * KEY SPEC TEST — exit criterion for Fase 3:
   * Total parallel time must be less than sum of individual worker times.
   */
  it("executes workers concurrently: total time < sum of sequential times", async () => {
    const WORKER_DELAY = 80; // ms per worker

    const workers: WorkerMap = {
      code: async () => {
        await delay(WORKER_DELAY);
        return "done";
      },
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task a", type: "code", status: "pending" },
        { id: "s2", description: "task b", type: "code", status: "pending" },
        { id: "s3", description: "task c", type: "code", status: "pending" },
      ],
    });

    const before = Date.now();
    const result = await node(state);
    const elapsed = Date.now() - before;

    const sequentialTime = 3 * WORKER_DELAY;
    // Parallel should finish in roughly WORKER_DELAY, not 3×
    expect(elapsed).toBeLessThan(sequentialTime);

    const meta = result.parallel_results!["_last_run"] as { count: number };
    expect(meta.count).toBe(3);
  });

  it("preserves existing parallel_results from state", async () => {
    const workers: WorkerMap = {
      code: async () => "new",
    };
    const node = makeParallelExecutorNode(workers);
    const state = makeState({
      subtasks: [
        { id: "s1", description: "task", type: "code", status: "pending" },
      ],
      parallel_results: { prior: "value" },
    });
    const result = await node(state);
    expect(result.parallel_results!["prior"]).toBe("value");
    expect(result.parallel_results!["s1"]).toBeDefined();
  });
});
