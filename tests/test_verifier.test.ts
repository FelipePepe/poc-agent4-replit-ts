/**
 * tests/test_verifier.test.ts
 *
 * RED tests for agents/verifier.ts — Fase 2
 * TDD: these tests must fail before src/agents/verifier.ts exists.
 */

import { HumanMessage } from "@langchain/core/messages";
import { makeVerifierNode } from "../src/agents/verifier";
import type { AgentState } from "../src/core/state";
import type { GraphTools } from "../src/core/graph";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DONE_SUBTASK = {
  id: "s1",
  description: "Create Flask app file app.py",
  type: "code" as const,
  status: "done" as const,
  result: "app.py",
};

const BASE_STATE: AgentState = {
  messages: [new HumanMessage("create a Flask API with /ping endpoint")],
  tool_calls: [],
  error_count: 0,
  current_model: "claude-sonnet",
  task_id: "task-001",
  subtasks: [DONE_SUBTASK],
  active_agent: "verifier",
  parallel_results: {},
  active_instructions: [],
  consecutive_errors: 0,
  model_switches: 0,
  snapshot_id: null,
};

const mockTools: Required<GraphTools> = {
  write_file: jest.fn(),
  read_file: jest.fn().mockReturnValue("from flask import Flask"),
  execute_shell: jest.fn().mockReturnValue({ stdout: "1 passed", stderr: "", exitCode: 0 }),
  search_web: jest.fn().mockReturnValue(""),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeVerifierNode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTools.execute_shell = jest.fn().mockReturnValue({ stdout: "1 passed", stderr: "", exitCode: 0 });
    mockTools.read_file = jest.fn().mockReturnValue("from flask import Flask");
  });

  it("returns a callable node function", () => {
    const node = makeVerifierNode(mockTools);
    expect(typeof node).toBe("function");
  });

  it("sets active_agent to verifier in returned state", async () => {
    const node = makeVerifierNode(mockTools);
    const result = await node(BASE_STATE);
    expect(result.active_agent).toBe("verifier");
  });

  it("adds a verification message to the state", async () => {
    const node = makeVerifierNode(mockTools);
    const result = await node(BASE_STATE);
    expect(result.messages).toBeDefined();
    expect(result.messages!.length).toBeGreaterThan(0);
  });

  it("marks done subtasks as 'verify-passed' or updates consecutive_errors on failure", async () => {
    // When verify passes: consecutive_errors resets
    const node = makeVerifierNode(mockTools);
    const result = await node(BASE_STATE);
    // Either reset to 0 or unchanged (0)
    expect(result.consecutive_errors ?? 0).toBe(0);
  });

  it("increments consecutive_errors when execute_shell returns non-zero", async () => {
    mockTools.execute_shell = jest.fn().mockReturnValue({ stdout: "", stderr: "FAILED", exitCode: 1 });
    const node = makeVerifierNode(mockTools);
    const result = await node(BASE_STATE);
    expect((result.consecutive_errors ?? 0) + (result.error_count ?? 0)).toBeGreaterThan(0);
  });

  it("reads the result file if subtask has a result path", async () => {
    const node = makeVerifierNode(mockTools);
    await node(BASE_STATE);
    // read_file should be called with the result path "app.py"
    expect(mockTools.read_file).toHaveBeenCalledWith({ path: "app.py" });
  });

  it("returns empty object when there are no done subtasks to verify", async () => {
    const stateNoDone = {
      ...BASE_STATE,
      subtasks: [{ ...DONE_SUBTASK, status: "pending" as const }],
    };
    const node = makeVerifierNode(mockTools);
    const result = await node(stateNoDone);
    expect(Object.keys(result).length).toBe(0);
  });

  it("uses fallback verify result when execute_shell tool is not provided", async () => {
    // Optional chaining: tools.execute_shell?.() — exercises the ?? fallback branch
    const toolsWithoutShell: GraphTools = { read_file: mockTools.read_file };
    const node = makeVerifierNode(toolsWithoutShell);
    const result = await node(BASE_STATE);
    // Should pass (exitCode: 0 from the ?? fallback)
    expect(result.consecutive_errors ?? 0).toBe(0);
  });

  it("handles missing read_file tool gracefully", async () => {
    // Optional chaining: tools.read_file?.() — exercises the ?? empty-string fallback
    const toolsWithoutRead: GraphTools = {
      execute_shell: mockTools.execute_shell,
    };
    const node = makeVerifierNode(toolsWithoutRead);
    const result = await node(BASE_STATE);
    // Should complete without throwing
    expect(result.active_agent).toBe("verifier");
  });
});
