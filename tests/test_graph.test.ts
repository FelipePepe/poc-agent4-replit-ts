/**
 * tests/test_graph.test.ts
 *
 * Tests for core/graph.ts — Fase 0 + Fase 1
 *
 * Fase 0: minimal single-node graph (START → supervisor → END).
 * Fase 1: ReAct loop (supervisor -(tool_calls)→ tool_executor → supervisor
 *          → verifier → END).
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildGraph, type GraphConfig, type GraphTools } from "../src/core/graph";
import { loadConfig } from "../src/core/config";

const TEST_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  LANGSMITH_API_KEY: "ls-test-key",
};

// Mock LLM that avoids real API calls
const mockLlm = {
  invoke: jest.fn().mockResolvedValue(new AIMessage("mocked response")),
  bindTools: jest.fn().mockReturnThis(),
};

describe("buildGraph", () => {
  let graphConfig: GraphConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    graphConfig = {
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
    };
  });

  it("returns a compiled graph without throwing", () => {
    const graph = buildGraph(graphConfig);
    expect(graph).toBeDefined();
  });

  it("compiled graph has an invoke method", () => {
    const graph = buildGraph(graphConfig);
    expect(typeof graph.invoke).toBe("function");
  });

  it("invokes LLM with the received message", async () => {
    const graph = buildGraph(graphConfig);
    await graph.invoke({
      messages: [new HumanMessage("test task")],
    });
    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
  });

  it("returns state with messages after invocation", async () => {
    const graph = buildGraph(graphConfig);
    const result = await graph.invoke({
      messages: [new HumanMessage("hello")],
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("sets active_agent to supervisor in initial state", async () => {
    const graph = buildGraph(graphConfig);
    const result = await graph.invoke({
      messages: [new HumanMessage("start")],
    });
    expect(result.active_agent).toBe("supervisor");
  });

  it("sets current_model in state", async () => {
    const graph = buildGraph(graphConfig);
    const result = await graph.invoke({
      messages: [new HumanMessage("start")],
    });
    expect(result.current_model).toBeDefined();
    expect(typeof result.current_model).toBe("string");
  });

  it("error_count starts at 0", async () => {
    const graph = buildGraph(graphConfig);
    const result = await graph.invoke({
      messages: [new HumanMessage("start")],
    });
    expect(result.error_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fase 1 — ReAct loop: supervisor → tool_executor → supervisor → verifier → END
// ---------------------------------------------------------------------------

describe("buildGraph Fase 1 — ReAct loop", () => {
  const toolCallMessage = new AIMessage({
    content: "",
    tool_calls: [
      {
        id: "tc-001",
        name: "write_file",
        args: { path: "hello.py", content: "print('Hello Mundo')" },
      },
    ],
  });

  let mockTools: Required<GraphTools>;
  let fase1Config: GraphConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTools = {
      write_file: jest.fn(),
      read_file: jest.fn().mockReturnValue(""),
      execute_shell: jest.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
      search_web: jest.fn().mockReturnValue("stub results"),
    };

    fase1Config = {
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      tools: mockTools,
    };
  });

  it("executes write_file tool when LLM returns tool_calls", async () => {
    // First invoke: supervisor returns tool_calls → tool_executor runs
    // Second invoke: supervisor returns plain response → verifier → END
    mockLlm.invoke
      .mockResolvedValueOnce(toolCallMessage)
      .mockResolvedValueOnce(new AIMessage("task complete"));

    const graph = buildGraph(fase1Config);
    await graph.invoke({ messages: [new HumanMessage("create hello.py")] });

    expect(mockTools.write_file).toHaveBeenCalledWith({
      path: "hello.py",
      content: "print('Hello Mundo')",
    });
    expect(mockLlm.invoke).toHaveBeenCalledTimes(2);
  });

  it("skips tool_executor when LLM returns no tool_calls", async () => {
    mockLlm.invoke.mockResolvedValueOnce(new AIMessage("done directly"));

    const graph = buildGraph(fase1Config);
    await graph.invoke({ messages: [new HumanMessage("what time is it")] });

    expect(mockTools.write_file).not.toHaveBeenCalled();
    expect(mockTools.read_file).not.toHaveBeenCalled();
    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
  });

  it("composes a ToolMessage into state after tool execution", async () => {
    mockLlm.invoke
      .mockResolvedValueOnce(toolCallMessage)
      .mockResolvedValueOnce(new AIMessage("done"));

    const graph = buildGraph(fase1Config);
    const result = await graph.invoke({ messages: [new HumanMessage("start")] });

    // Messages: HumanMessage + AIMessage(tool_calls) + ToolMessage + AIMessage(done)
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
  });

  it("read_file tool is called with correct arguments", async () => {
    const readMsg = new AIMessage({
      content: "",
      tool_calls: [
        { id: "tc-002", name: "read_file", args: { path: "main.py" } },
      ],
    });

    mockLlm.invoke
      .mockResolvedValueOnce(readMsg)
      .mockResolvedValueOnce(new AIMessage("read complete"));

    const graph = buildGraph(fase1Config);
    await graph.invoke({ messages: [new HumanMessage("read main.py")] });

    expect(mockTools.read_file).toHaveBeenCalledWith({ path: "main.py" });
  });

  it("returns error ToolMessage when tool name is unknown", async () => {
    const unknownToolMsg = new AIMessage({
      content: "",
      tool_calls: [
        { id: "tc-003", name: "unknown_tool", args: { x: 1 } },
      ],
    });

    mockLlm.invoke
      .mockResolvedValueOnce(unknownToolMsg)
      .mockResolvedValueOnce(new AIMessage("done"));

    const graph = buildGraph(fase1Config);
    const result = await graph.invoke({ messages: [new HumanMessage("trigger unknown")] });

    // Graph should not throw — ToolMessage with error content should be added
    expect(result.messages.length).toBeGreaterThan(1);
  });

  it("JSON-serialises non-string tool results into ToolMessage content", async () => {
    const shellCallMsg = new AIMessage({
      content: "",
      tool_calls: [
        { id: "tc-004", name: "execute_shell", args: { command: "echo", args: ["hi"] } },
      ],
    });

    // execute_shell mock returns a ShellResult object (non-string)
    mockTools.execute_shell = jest.fn().mockReturnValue({ stdout: "hi\n", stderr: "", exitCode: 0 });

    mockLlm.invoke
      .mockResolvedValueOnce(shellCallMsg)
      .mockResolvedValueOnce(new AIMessage("done"));

    const graph = buildGraph(fase1Config);
    const result = await graph.invoke({ messages: [new HumanMessage("run echo")] });

    // The ToolMessage content should be the JSON-serialised ShellResult
    const toolMsg = result.messages.find(
      (m: { content?: unknown }) => typeof m.content === "string" && (m.content as string).includes("stdout")
    );
    expect(toolMsg).toBeDefined();
  });
});
