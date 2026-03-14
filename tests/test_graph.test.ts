/**
 * tests/test_graph.test.ts
 *
 * RED tests for core/graph.ts — Fase 0
 * TDD: these tests must fail before src/core/graph.ts exists.
 *
 * The goal of Fase 0: a graph that receives a message, calls the LLM,
 * and returns the response. One node, no conditional edges.
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildGraph, type GraphConfig } from "../src/core/graph";
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
