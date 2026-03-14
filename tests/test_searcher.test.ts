/**
 * tests/test_searcher.test.ts
 *
 * RED tests for agents/searcher.ts — Fase 2
 * TDD: these tests must fail before src/agents/searcher.ts exists.
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { makeSearcherNode } from "../src/agents/searcher";
import type { AgentState } from "../src/core/state";
import type { GraphTools } from "../src/core/graph";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_STATE: AgentState = {
  messages: [new HumanMessage("how do I add a /ping endpoint in Flask?")],
  tool_calls: [],
  error_count: 0,
  current_model: "claude-sonnet",
  task_id: "task-001",
  subtasks: [
    {
      id: "s1",
      description: "Search how to add /ping in Flask",
      type: "search",
      status: "pending",
    },
  ],
  active_agent: "searcher",
  parallel_results: {},
  active_instructions: [],
  consecutive_errors: 0,
  model_switches: 0,
  snapshot_id: null,
};

const mockTools: Required<GraphTools> = {
  write_file: jest.fn(),
  read_file: jest.fn().mockReturnValue(""),
  execute_shell: jest.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
  search_web: jest.fn().mockReturnValue("[Search results: Flask /ping example code]"),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeSearcherNode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTools.search_web = jest.fn().mockReturnValue("[Search results: Flask /ping example code]");
  });

  it("returns a callable node function", () => {
    const node = makeSearcherNode(mockTools);
    expect(typeof node).toBe("function");
  });

  it("calls search_web with the query from the pending subtask description", async () => {
    const node = makeSearcherNode(mockTools);
    await node(BASE_STATE);
    expect(mockTools.search_web).toHaveBeenCalledTimes(1);
    const [args] = (mockTools.search_web as jest.Mock).mock.calls;
    expect(args[0]).toMatchObject({ query: expect.any(String) });
  });

  it("appends search results as an AIMessage to state messages", async () => {
    const node = makeSearcherNode(mockTools);
    const result = await node(BASE_STATE);
    expect(result.messages).toBeDefined();
    const searchMsg = result.messages!.find(
      (m) => m instanceof AIMessage && (m as AIMessage).content.toString().includes("Search results")
    );
    expect(searchMsg).toBeDefined();
  });

  it("marks the current search subtask as done", async () => {
    const node = makeSearcherNode(mockTools);
    const result = await node(BASE_STATE);
    const doneSubtask = result.subtasks?.find((s) => s.id === "s1");
    expect(doneSubtask?.status).toBe("done");
  });

  it("sets active_agent to searcher", async () => {
    const node = makeSearcherNode(mockTools);
    const result = await node(BASE_STATE);
    expect(result.active_agent).toBe("searcher");
  });

  it("returns empty when there are no pending search subtasks", async () => {
    const stateNoPending = {
      ...BASE_STATE,
      subtasks: [{ ...BASE_STATE.subtasks[0], status: "done" as const }],
    };
    const node = makeSearcherNode(mockTools);
    const result = await node(stateNoPending);
    expect(mockTools.search_web).not.toHaveBeenCalled();
    expect(Object.keys(result).length).toBe(0);
  });

  it("stores search result in the completed subtask result field", async () => {
    const node = makeSearcherNode(mockTools);
    const result = await node(BASE_STATE);
    const completedSubtask = result.subtasks?.find((s) => s.id === "s1");
    expect(completedSubtask?.result).toBeDefined();
    expect(typeof completedSubtask?.result).toBe("string");
  });

  it("uses fallback result when search_web tool is not provided", async () => {
    // Optional chaining: tools.search_web?.() — exercises the ?? fallback branch
    const node = makeSearcherNode({}); // empty tools
    const result = await node(BASE_STATE);
    expect(result.messages).toBeDefined();
    const msg = result.messages![0];
    expect(msg.content.toString()).toContain("No search results");
  });
});
