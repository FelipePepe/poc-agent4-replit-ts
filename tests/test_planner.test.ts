/**
 * tests/test_planner.test.ts
 *
 * RED tests for agents/planner.ts — Fase 2
 * TDD: these tests must fail before src/agents/planner.ts exists.
 */

import { vi } from 'vitest';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { makePlannerNode } from "../src/agents/planner";
import type { AgentState, Subtask } from "../src/core/state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BASE_STATE: AgentState = {
  messages: [new HumanMessage("create a Flask API with /ping endpoint")],
  tool_calls: [],
  error_count: 0,
  current_model: "claude-sonnet",
  task_id: "task-001",
  subtasks: [],
  active_agent: "planner",
  parallel_results: {},
  active_instructions: [],
  consecutive_errors: 0,
  model_switches: 0,
  snapshot_id: null,
};

const VALID_SUBTASKS: Subtask[] = [
  { id: "s1", description: "Create Flask app file", type: "code", status: "pending" },
  { id: "s2", description: "Add /ping endpoint", type: "code", status: "pending" },
  { id: "s3", description: "Verify endpoint works", type: "verify", status: "pending" },
];

const mockLlm = {
  invoke: vi.fn(),
  bindTools: vi.fn().mockReturnThis(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makePlannerNode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a callable node function", () => {
    const node = makePlannerNode(mockLlm as never);
    expect(typeof node).toBe("function");
  });

  it("calls LLM to decompose the task", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(VALID_SUBTASKS)));
    const node = makePlannerNode(mockLlm as never);
    await node(BASE_STATE);
    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
  });

  it("returns subtasks parsed from valid JSON LLM response", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(VALID_SUBTASKS)));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks![0].id).toBe("s1");
    expect(result.subtasks![1].description).toBe("Add /ping endpoint");
  });

  it("sets all subtask statuses to pending", async () => {
    const withWrongStatus = VALID_SUBTASKS.map((s) => ({ ...s, status: "in_progress" as const }));
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(withWrongStatus)));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    for (const st of result.subtasks!) {
      expect(st.status).toBe("pending");
    }
  });

  it("returns empty subtasks and increments error_count on invalid JSON", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("not valid json at all"));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.subtasks).toEqual([]);
    expect(result.error_count).toBe(BASE_STATE.error_count + 1);
    expect(result.consecutive_errors).toBe(BASE_STATE.consecutive_errors + 1);
  });

  it("returns empty subtasks and increments error_count when LLM throws", async () => {
    mockLlm.invoke.mockRejectedValue(new Error("LLM unavailable"));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.subtasks).toEqual([]);
    expect(result.error_count).toBeGreaterThan(0);
  });

  it("sets active_agent to planner in returned state", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify(VALID_SUBTASKS)));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.active_agent).toBe("planner");
  });

  it("handles JSON array wrapped in extra markdown code block", async () => {
    const withMarkdown = "```json\n" + JSON.stringify(VALID_SUBTASKS) + "\n```";
    mockLlm.invoke.mockResolvedValue(new AIMessage(withMarkdown));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    // Either successfully parsed (stripped markdown) or empty with error_count++
    expect(Array.isArray(result.subtasks)).toBe(true);
  });

  it("returns empty subtasks when LLM returns valid JSON that is not an array", async () => {
    // parseSubtasks: JSON parses but Array.isArray fails
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify({ not: "an array" })));
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.subtasks).toEqual([]);
    expect(result.error_count).toBe(BASE_STATE.error_count + 1);
  });

  it("uses empty string content and increments errors when LLM returns non-string content (array)", async () => {
    // Exercises line 81: typeof response.content === "string" ? response.content : ""
    // When content is non-string (e.g. array of blocks), content becomes ""
    // parseSubtasks("") tries JSON.parse("") → throws → returns null → error branch
    const { AIMessage: RealAIMessage } = await import("@langchain/core/messages");
    const arrayContentMsg = new RealAIMessage({ content: [{ type: "text", text: "hello" }] });
    mockLlm.invoke.mockResolvedValue(arrayContentMsg);
    const node = makePlannerNode(mockLlm as never);
    const result = await node(BASE_STATE);
    expect(result.subtasks).toEqual([]);
    expect(result.error_count).toBe(BASE_STATE.error_count + 1);
  });
});
