/**
 * tests/test_editor.test.ts
 *
 * RED tests for agents/editor.ts — Fase 2
 * TDD: these tests must fail before src/agents/editor.ts exists.
 */

import { vi } from 'vitest';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { makeEditorNode } from "../src/agents/editor";
import type { AgentState } from "../src/core/state";
import type { GraphTools } from "../src/core/graph";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PENDING_SUBTASK = {
  id: "s1",
  description: "Create Flask app file app.py",
  type: "code" as const,
  status: "pending" as const,
};

const BASE_STATE: AgentState = {
  messages: [new HumanMessage("create a Flask API with /ping endpoint")],
  tool_calls: [],
  error_count: 0,
  current_model: "claude-sonnet",
  task_id: "task-001",
  subtasks: [PENDING_SUBTASK],
  active_agent: "editor",
  parallel_results: {},
  active_instructions: [],
  consecutive_errors: 0,
  model_switches: 0,
  snapshot_id: null,
};

const mockLlm = {
  invoke: vi.fn(),
  bindTools: vi.fn().mockReturnThis(),
};

const mockTools: Required<GraphTools> = {
  write_file: vi.fn(),
  read_file: vi.fn().mockReturnValue(""),
  execute_shell: vi.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
  search_web: vi.fn().mockReturnValue(""),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeEditorNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTools.write_file = vi.fn();
    mockTools.read_file = vi.fn().mockReturnValue("");
  });

  it("returns a callable node function", () => {
    const node = makeEditorNode(mockLlm as never, mockTools);
    expect(typeof node).toBe("function");
  });

  it("calls LLM to generate code for the first pending subtask", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("# app.py\nfrom flask import Flask\napp = Flask(__name__)"));
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
  });

  it("calls write_file with generated code", async () => {
    const code = "from flask import Flask\napp = Flask(__name__)";
    mockLlm.invoke.mockResolvedValue(new AIMessage(code));
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    expect(mockTools.write_file).toHaveBeenCalledTimes(1);
    const [args] = (mockTools.write_file as ReturnType<typeof vi.fn>).mock.calls;
    expect(args[0]).toMatchObject({ content: code });
  });

  it("uses exact path and content when LLM returns valid CodeOutput JSON", async () => {
    // Exercises parseCodeOutput return parsed as CodeOutput (line 55)
    const codeOutput = JSON.stringify({ path: "app.py", content: "from flask import Flask" });
    mockLlm.invoke.mockResolvedValue(new AIMessage(codeOutput));
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    const [args] = (mockTools.write_file as ReturnType<typeof vi.fn>).mock.calls;
    expect(args[0]).toMatchObject({ path: "app.py", content: "from flask import Flask" });
  });

  it("marks the current subtask as done", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("some code"));
    const node = makeEditorNode(mockLlm as never, mockTools);
    const result = await node(BASE_STATE);
    const doneSubtask = result.subtasks?.find((s) => s.id === "s1");
    expect(doneSubtask?.status).toBe("done");
  });

  it("sets active_agent to editor in returned state", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("code"));
    const node = makeEditorNode(mockLlm as never, mockTools);
    const result = await node(BASE_STATE);
    expect(result.active_agent).toBe("editor");
  });

  it("increments error_count when LLM throws", async () => {
    mockLlm.invoke.mockRejectedValue(new Error("LLM error"));
    const node = makeEditorNode(mockLlm as never, mockTools);
    const result = await node(BASE_STATE);
    expect(result.error_count).toBeGreaterThan(0);
    expect(result.consecutive_errors).toBeGreaterThan(0);
  });

  it("does nothing and returns empty when there are no pending subtasks", async () => {
    const stateNoPending = {
      ...BASE_STATE,
      subtasks: [{ ...PENDING_SUBTASK, status: "done" as const }],
    };
    const node = makeEditorNode(mockLlm as never, mockTools);
    const result = await node(stateNoPending);
    expect(mockLlm.invoke).not.toHaveBeenCalled();
    expect(Object.keys(result).length).toBe(0);
  });

  it("falls back to output.py when LLM returns JSON without path/content keys", async () => {
    // parseCodeOutput: JSON parses but fields are missing — exercises lines 49-57
    const badSchema = JSON.stringify({ wrong: "structure" });
    mockLlm.invoke.mockResolvedValue(new AIMessage(badSchema));
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    expect(mockTools.write_file).toHaveBeenCalledTimes(1);
    const [args] = (mockTools.write_file as ReturnType<typeof vi.fn>).mock.calls;
    expect(args[0]).toMatchObject({ path: "output.py" });
  });

  it("falls back to output.py when LLM returns JSON with path but no content", async () => {
    // Exercises the '\"content\" in parsed' branch being false
    const pathOnly = JSON.stringify({ path: "app.py" }); // no content
    mockLlm.invoke.mockResolvedValue(new AIMessage(pathOnly));
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    const [args] = (mockTools.write_file as ReturnType<typeof vi.fn>).mock.calls;
    expect(args[0]).toMatchObject({ path: "output.py" });
  });

  it("uses empty string content when LLM returns non-string content (array)", async () => {
    // Exercises line 94: typeof response.content === "string" ? ... : ""
    // AIMessage content can be an array of content blocks (multimodal responses)
    const { AIMessage: RealAIMessage } = await import("@langchain/core/messages");
    const arrayContentMsg = new RealAIMessage({ content: [{ type: "text", text: "hello" }] });
    mockLlm.invoke.mockResolvedValue(arrayContentMsg);
    const node = makeEditorNode(mockLlm as never, mockTools);
    await node(BASE_STATE);
    // When content is not a string, parseCodeOutput("") returns null → fallback to output.py
    expect(mockTools.write_file).toHaveBeenCalledTimes(1);
    const [args] = (mockTools.write_file as ReturnType<typeof vi.fn>).mock.calls;
    // Content is "", which is not valid JSON, so parseCodeOutput returns null → fallback
    expect(args[0]).toMatchObject({ path: "output.py" });
  });

  it("leaves non-target subtasks unchanged when marking target as done (line 103 ternary)", async () => {
    // Exercises line 103: s.id === target.id ? ... : s — the `: s` branch (non-target subtask)
    const stateWithMultipleSubtasks = {
      ...BASE_STATE,
      subtasks: [
        PENDING_SUBTASK, // s1 — this is the code task that will be processed
        {
          id: "s2",
          description: "Search for something",
          type: "search" as const,
          status: "pending" as const,
        },
      ],
    };
    mockLlm.invoke.mockResolvedValue(new AIMessage(JSON.stringify({ path: "app.py", content: "code" })));
    const node = makeEditorNode(mockLlm as never, mockTools);
    const result = await node(stateWithMultipleSubtasks);
    // s1 should be done, s2 should remain unchanged (the `:s` branch)
    const s1 = result.subtasks?.find((s) => s.id === "s1");
    const s2 = result.subtasks?.find((s) => s.id === "s2");
    expect(s1?.status).toBe("done");
    expect(s2?.status).toBe("pending");
  });
});
