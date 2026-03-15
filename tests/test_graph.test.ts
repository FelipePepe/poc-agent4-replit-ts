/**
 * tests/test_graph.test.ts
 *
 * Tests for core/graph.ts — Fase 0 + Fase 1 + Fase 3 (parallel routing)
 *
 * Fase 0: minimal single-node graph (START → supervisor → END).
 * Fase 1: ReAct loop (supervisor -(tool_calls)→ tool_executor → supervisor
 *          → verifier → END).
 * Fase 3: parallel routing (supervisor -(2+ pending subtasks)→ parallel_executor
 *          → verifier → END).
 */

import { vi } from 'vitest';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildGraph, type GraphConfig, type GraphTools } from "../src/core/graph";
import { loadConfig } from "../src/core/config";
import { makeTrajectoryClassifier } from "../src/guidance/classifier";
import { makeModelRouter, FALLBACK_THRESHOLD, LOCAL_THRESHOLD } from "../src/core/models";

const TEST_ENV = {
  GITHUB_TOKEN: "ghp_test-key",
  LANGSMITH_API_KEY: "ls-test-key",
};

// Mock LLM that avoids real API calls
const mockLlm = {
  invoke: vi.fn().mockResolvedValue(new AIMessage("mocked response")),
  bindTools: vi.fn().mockReturnThis(),
};

describe("buildGraph", () => {
  let graphConfig: GraphConfig;

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.clearAllMocks();

    mockTools = {
      write_file: vi.fn(),
      read_file: vi.fn().mockReturnValue(""),
      execute_shell: vi.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
      search_web: vi.fn().mockReturnValue("stub results"),
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

  it("returns error ToolMessage when the tool function throws", async () => {
    const throwingMsg = new AIMessage({
      content: "",
      tool_calls: [{ id: "tc-throw", name: "write_file", args: { path: "x.py", content: "bad" } }],
    });
    mockTools.write_file = vi.fn().mockImplementation(() => {
      throw new Error("disk write failed");
    });
    mockLlm.invoke
      .mockResolvedValueOnce(throwingMsg)
      .mockResolvedValueOnce(new AIMessage("recovered"));

    const graph = buildGraph(fase1Config);
    const result = await graph.invoke({ messages: [new HumanMessage("test error")] });

    const errMsg = result.messages.find(
      (m: { content?: unknown }) =>
        typeof m.content === "string" && (m.content as string).includes("Error:")
    );
    expect(errMsg).toBeDefined();
  });

  it("uses auto-generated call id when tool_call has no id", async () => {
    // tool_call without an id field — graph should still work
    const noIdMsg = new AIMessage({
      content: "",
      tool_calls: [{ name: "write_file", args: { path: "auto.py", content: "x" } }],
    });
    mockLlm.invoke
      .mockResolvedValueOnce(noIdMsg)
      .mockResolvedValueOnce(new AIMessage("done"));

    const graph = buildGraph(fase1Config);
    const result = await graph.invoke({ messages: [new HumanMessage("no id test")] });
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("JSON-serialises non-string tool results into ToolMessage content", async () => {
    const shellCallMsg = new AIMessage({
      content: "",
      tool_calls: [
        { id: "tc-004", name: "execute_shell", args: { command: "echo", args: ["hi"] } },
      ],
    });

    // execute_shell mock returns a ShellResult object (non-string)
    mockTools.execute_shell = vi.fn().mockReturnValue({ stdout: "hi\n", stderr: "", exitCode: 0 });

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

  // -------------------------------------------------------------------------
  // Fase 3 — Parallel routing
  // -------------------------------------------------------------------------

  it("routes to parallel_executor when initial state has 2+ pending subtasks", async () => {
    // Mock LLM returns no tool_calls → router checks subtasks → parallel_executor
    mockLlm.invoke.mockResolvedValue(new AIMessage("no tools needed"));

    const workerCalled: string[] = [];
    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      parallelWorkers: {
        code: async (subtask) => {
          workerCalled.push(subtask.id);
          return `result-${subtask.id}`;
        },
      },
    });

    await graph.invoke({
      messages: [new HumanMessage("run parallel tasks")],
      subtasks: [
        { id: "s1", description: "write a", type: "code", status: "pending" },
        { id: "s2", description: "write b", type: "code", status: "pending" },
      ],
    });

    expect(workerCalled).toContain("s1");
    expect(workerCalled).toContain("s2");
  });

  it("parallel path populates parallel_results after execution", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("no tools"));

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      parallelWorkers: {
        code: async (subtask) => `output-${subtask.id}`,
      },
    });

    const result = await graph.invoke({
      messages: [new HumanMessage("parallel test")],
      subtasks: [
        { id: "p1", description: "task p1", type: "code", status: "pending" },
        { id: "p2", description: "task p2", type: "code", status: "pending" },
        { id: "p3", description: "task p3", type: "code", status: "pending" },
      ],
    });

    expect(result.parallel_results).toHaveProperty("p1");
    expect(result.parallel_results).toHaveProperty("p2");
    expect(result.parallel_results).toHaveProperty("p3");
    expect(result.parallel_results["_last_run"]).toMatchObject({ count: 3 });
  });

  // -------------------------------------------------------------------------
  // Fase 4 — Ephemeral classifier injection
  // -------------------------------------------------------------------------

  it("injects micro-instruction into LLM call when consecutive_errors >= 2", async () => {
    const capturedArgs: unknown[][] = [];
    mockLlm.invoke = vi.fn().mockImplementation(async (msgs: unknown[]) => {
      capturedArgs.push(msgs);
      return new AIMessage("response");
    });

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: makeTrajectoryClassifier(),
    });

    await graph.invoke({
      messages: [new HumanMessage("help")],
      consecutive_errors: 3,  // triggers "error-loop"
    });

    // The LLM should have been called with a [GUIDANCE] message
    expect(capturedArgs.length).toBeGreaterThan(0);
    const lastCall = capturedArgs[capturedArgs.length - 1];
    const hasGuidance = lastCall.some(
      (m) =>
        typeof (m as { content?: unknown }).content === "string" &&
        ((m as { content: string }).content as string).includes("[GUIDANCE]")
    );
    expect(hasGuidance).toBe(true);
  });

  it("sets active_instructions in state after classifier injection", async () => {
    mockLlm.invoke.mockResolvedValue(new AIMessage("ok"));

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: makeTrajectoryClassifier(),
    });

    const result = await graph.invoke({
      messages: [new HumanMessage("task")],
      consecutive_errors: 3,
    });

    expect(Array.isArray(result.active_instructions)).toBe(true);
    expect(result.active_instructions.length).toBeGreaterThan(0);
  });

  it("does NOT inject when consecutive_errors < 2 (no activation)", async () => {
    const capturedArgs: unknown[][] = [];
    mockLlm.invoke = vi.fn().mockImplementation(async (msgs: unknown[]) => {
      capturedArgs.push(msgs);
      return new AIMessage("fine");
    });

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: makeTrajectoryClassifier(),
    });

    await graph.invoke({
      messages: [new HumanMessage("all good")],
      consecutive_errors: 0,
    });

    const lastCall = capturedArgs[capturedArgs.length - 1];
    const hasGuidance = lastCall.some(
      (m) =>
        typeof (m as { content?: unknown }).content === "string" &&
        ((m as { content: string }).content as string).includes("[GUIDANCE]")
    );
    expect(hasGuidance).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Fase 5 — Model switching anti-doom-loop
  // -------------------------------------------------------------------------

  it("uses fallback LLM when consecutive_errors >= FALLBACK_THRESHOLD", async () => {
    const mainLlm = { invoke: vi.fn().mockResolvedValue(new AIMessage("main")) };
    const fallbackLlm = { invoke: vi.fn().mockResolvedValue(new AIMessage("fallback")) };
    const localLlm = { invoke: vi.fn().mockResolvedValue(new AIMessage("local")) };

    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: mainLlm as never, fallback: fallbackLlm as never, local: localLlm as never },
      { main: "sonnet", fallback: "haiku", local: "ollama" }
    );

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mainLlm as unknown as GraphConfig["llm"],
      modelRouter: router,
    });

    await graph.invoke({
      messages: [new HumanMessage("broken")],
      consecutive_errors: 3,
      current_model: "sonnet",
    });

    expect(fallbackLlm.invoke).toHaveBeenCalled();
    expect(mainLlm.invoke).not.toHaveBeenCalled();
  });

  it("increments model_switches and updates current_model on switch", async () => {
    const mainLlm = { invoke: vi.fn().mockResolvedValue(new AIMessage("ok")) };
    const fallbackLlm = { invoke: vi.fn().mockResolvedValue(new AIMessage("fallback ok")) };

    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: mainLlm as never, fallback: fallbackLlm as never, local: mainLlm as never },
      { main: "sonnet", fallback: "haiku", local: "ollama" }
    );

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mainLlm as unknown as GraphConfig["llm"],
      modelRouter: router,
    });

    const result = await graph.invoke({
      messages: [new HumanMessage("error loop")],
      consecutive_errors: 3,
      current_model: "sonnet",   // was on sonnet
      model_switches: 0,
    });

    expect(result.model_switches).toBe(1);
    expect(result.current_model).toBe("haiku");
  });

  // -------------------------------------------------------------------------
  // Branch coverage: estimateTokens with non-string message content (line 90)
  // -------------------------------------------------------------------------

  it("handles messages with non-string (array) content in estimateTokens", async () => {
    // Exercises line 90: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    // By passing a classifier (so estimateTokens is called) AND a message with array content
    mockLlm.invoke = vi.fn().mockResolvedValue(new AIMessage("ok"));

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: makeTrajectoryClassifier(),
    });

    // AIMessage with array content (multimodal) triggers the JSON.stringify branch
    const arrayContentMsg = new AIMessage({ content: [{ type: "text", text: "prior message" }] });

    // With consecutive_errors >= ACTIVATION_THRESHOLD, estimateTokens is called
    await graph.invoke({
      messages: [arrayContentMsg],
      consecutive_errors: 3,
    });

    // Should complete without error and have called the LLM
    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Branch coverage: classifier shouldActivate=false does NOT inject guidance (line 134)
  // -------------------------------------------------------------------------

  it("does not inject guidance when classifier returns shouldActivate=false", async () => {
    // Exercises line 134: the branch where shouldActivate is false
    const capturedArgs: unknown[][] = [];
    mockLlm.invoke = vi.fn().mockImplementation(async (msgs: unknown[]) => {
      capturedArgs.push(msgs);
      return new AIMessage("ok");
    });

    // Inject a stub classifier that always returns shouldActivate=false
    const noOpClassifier = {
      classify: () => ({
        shouldActivate: false,
        labels: [],
        microInstructions: [],
      }),
    };

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: noOpClassifier as ReturnType<typeof makeTrajectoryClassifier>,
    });

    await graph.invoke({
      messages: [new HumanMessage("test")],
      consecutive_errors: 3, // above threshold so classifier is called
    });

    // No [GUIDANCE] message should appear in the LLM call
    const lastCall = capturedArgs[capturedArgs.length - 1];
    const hasGuidance = lastCall.some(
      (m) =>
        typeof (m as { content?: unknown }).content === "string" &&
        ((m as { content: string }).content as string).includes("[GUIDANCE]")
    );
    expect(hasGuidance).toBe(false);
  });

  it("does not inject guidance when classifier returns empty microInstructions", async () => {
    // Exercises line 134: shouldActivate=true but microInstructions is empty
    const capturedArgs: unknown[][] = [];
    mockLlm.invoke = vi.fn().mockImplementation(async (msgs: unknown[]) => {
      capturedArgs.push(msgs);
      return new AIMessage("ok");
    });

    // Inject a stub classifier that returns shouldActivate=true but empty microInstructions
    const emptyInstructionsClassifier = {
      classify: () => ({
        shouldActivate: true,
        labels: ["error-loop"],
        microInstructions: [], // empty → should NOT inject
      }),
    };

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      classifier: emptyInstructionsClassifier as ReturnType<typeof makeTrajectoryClassifier>,
    });

    await graph.invoke({
      messages: [new HumanMessage("test")],
      consecutive_errors: 3,
    });

    const lastCall = capturedArgs[capturedArgs.length - 1];
    const hasGuidance = lastCall.some(
      (m) =>
        typeof (m as { content?: unknown }).content === "string" &&
        ((m as { content: string }).content as string).includes("[GUIDANCE]")
    );
    expect(hasGuidance).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Branch coverage: tool throws non-Error value (line 230)
  // -------------------------------------------------------------------------

  it("returns ToolMessage with String(err) when tool throws a non-Error value", async () => {
    // Exercises line 230: err instanceof Error ? err.message : String(err)
    // The non-Error branch is when a tool throws a plain string or object
    const throwsStringMsg = new AIMessage({
      content: "",
      tool_calls: [
        { id: "tc-nonError", name: "write_file", args: { path: "x.py", content: "x" } },
      ],
    });

    const mockToolsLocal = {
      write_file: vi.fn().mockImplementation(() => {
        throw "string error value"; // non-Error throw — intentional for branch coverage
      }),
      read_file: vi.fn().mockReturnValue(""),
      execute_shell: vi.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
      search_web: vi.fn().mockReturnValue(""),
    };

    mockLlm.invoke = vi.fn()
      .mockResolvedValueOnce(throwsStringMsg)
      .mockResolvedValueOnce(new AIMessage("done"));

    const graph = buildGraph({
      config: loadConfig(TEST_ENV),
      llm: mockLlm as unknown as GraphConfig["llm"],
      tools: mockToolsLocal,
    });

    const result = await graph.invoke({ messages: [new HumanMessage("test non-error throw")] });

    // ToolMessage content should contain the stringified error
    const toolMsg = result.messages.find(
      (m: { content?: unknown }) =>
        typeof m.content === "string" &&
        (m.content as string).includes("string error value")
    );
    expect(toolMsg).toBeDefined();
  });
});
