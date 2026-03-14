/**
 * tests/test_graph_runner.test.ts
 *
 * RED tests for src/api/graph_runner.ts
 * TDD: these tests must fail before the implementation exists.
 *
 * createGraphRunner(config) — factory that builds a real GraphRunner
 * from a Config, wiring buildGraph + makeTools + classifier + modelRouter.
 */

import { vi } from "vitest";
import type { Config } from "../src/core/config";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
const mockBuildGraph = vi.fn(() => ({ invoke: mockInvoke }));

vi.mock("../src/core/graph", () => ({
  buildGraph: mockBuildGraph,
}));

vi.mock("../src/core/tools", () => ({
  makeTools: vi.fn(() => ({})),
}));

vi.mock("../src/guidance/classifier", () => ({
  makeTrajectoryClassifier: vi.fn(() => ({})),
  ACTIVATION_THRESHOLD: 3,
}));

vi.mock("../src/core/models", () => ({
  makeModelRouter: vi.fn(() => ({})),
  FALLBACK_THRESHOLD: 3,
  LOCAL_THRESHOLD: 6,
}));

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: class {
    invoke = vi.fn();
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: "test-key",
    langsmithApiKey: "ls-key",
    langsmithProject: "test-proj",
    nodeEnv: "test",
    port: 3000,
    dbPath: ":memory:",
    models: {
      primary: "claude-sonnet-4-5",
      fallback: "claude-haiku-4-5",
      fallbackThreshold: 3,
      localThreshold: 6,
      local: "phi3-mini",
    },
    sandbox: {
      dir: "/tmp/sandbox",
      commandTimeoutMs: 5000,
      allowedCommands: ["ls"],
    },
    maxIterations: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createGraphRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a function (GraphRunner)", async () => {
    const { createGraphRunner } = await import("../src/api/graph_runner");
    const runner = createGraphRunner(makeConfig());
    expect(typeof runner).toBe("function");
  });

  it("calls buildGraph with config, llm, tools, classifier, modelRouter", async () => {
    const { createGraphRunner } = await import("../src/api/graph_runner");
    createGraphRunner(makeConfig());
    expect(mockBuildGraph).toHaveBeenCalledOnce();
    const arg = mockBuildGraph.mock.calls[0][0];
    expect(arg).toHaveProperty("config");
    expect(arg).toHaveProperty("llm");
    expect(arg).toHaveProperty("tools");
    expect(arg).toHaveProperty("classifier");
    expect(arg).toHaveProperty("modelRouter");
  });

  it("runner invokes graph with HumanMessage containing the prompt", async () => {
    mockInvoke.mockResolvedValue({ artifacts: ["file.ts"] });
    const { createGraphRunner } = await import("../src/api/graph_runner");
    const runner = createGraphRunner(makeConfig());
    await runner("write a hello world script");
    expect(mockInvoke).toHaveBeenCalledOnce();
    const state = mockInvoke.mock.calls[0][0];
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("write a hello world script");
  });

  it("returns artifacts from the final graph state", async () => {
    mockInvoke.mockResolvedValue({ artifacts: ["src/hello.ts", "tests/hello.test.ts"] });
    const { createGraphRunner } = await import("../src/api/graph_runner");
    const runner = createGraphRunner(makeConfig());
    const result = await runner("write a hello world script");
    expect(result).toEqual({ artifacts: ["src/hello.ts", "tests/hello.test.ts"] });
  });

  it("returns empty artifacts when graph state has none", async () => {
    mockInvoke.mockResolvedValue({ artifacts: [] });
    const { createGraphRunner } = await import("../src/api/graph_runner");
    const runner = createGraphRunner(makeConfig());
    const result = await runner("prompt");
    expect(result).toEqual({ artifacts: [] });
  });

  it("propagates graph errors to the caller", async () => {
    mockInvoke.mockRejectedValue(new Error("LLM timeout"));
    const { createGraphRunner } = await import("../src/api/graph_runner");
    const runner = createGraphRunner(makeConfig());
    await expect(runner("prompt")).rejects.toThrow("LLM timeout");
  });
});
