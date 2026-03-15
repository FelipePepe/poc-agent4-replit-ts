/**
 * tests/test_tracing.test.ts
 *
 * RED tests for src/core/tracing.ts
 * TDD: these tests must fail before the implementation exists.
 *
 * setupLangSmith(config) — configures env vars for LangSmith auto-tracing.
 * wrapWithTrace(fn, name) — wraps a function with LangSmith traceable.
 */

import { vi } from "vitest";
import type { Config } from "../src/core/config";

// ---------------------------------------------------------------------------
// Mock langsmith/traceable
// ---------------------------------------------------------------------------

const mockTraceable = vi.fn((fn: unknown) => fn); // passthrough by default

vi.mock("langsmith/traceable", () => ({
  traceable: mockTraceable,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    githubToken: "test-key",
    langsmithApiKey: "ls-test-key",
    langsmithProject: "test-project",
    nodeEnv: "test",
    port: 3000,
    dbPath: ":memory:",
    models: {
      primary: "gpt-4o",
      fallback: "gpt-4o-mini",
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
// setupLangSmith
// ---------------------------------------------------------------------------

describe("setupLangSmith", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // restore env after each test
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  it("sets LANGCHAIN_TRACING_V2=true when apiKey is present", async () => {
    const { setupLangSmith } = await import("../src/core/tracing");
    setupLangSmith(makeConfig());
    expect(process.env.LANGCHAIN_TRACING_V2).toBe("true");
  });

  it("sets LANGCHAIN_API_KEY from config.langsmithApiKey", async () => {
    const { setupLangSmith } = await import("../src/core/tracing");
    setupLangSmith(makeConfig({ langsmithApiKey: "my-ls-key" }));
    expect(process.env.LANGCHAIN_API_KEY).toBe("my-ls-key");
  });

  it("sets LANGCHAIN_PROJECT from config.langsmithProject", async () => {
    const { setupLangSmith } = await import("../src/core/tracing");
    setupLangSmith(makeConfig({ langsmithProject: "my-project" }));
    expect(process.env.LANGCHAIN_PROJECT).toBe("my-project");
  });

  it("does NOT set LANGCHAIN_TRACING_V2 when apiKey is empty", async () => {
    delete process.env.LANGCHAIN_TRACING_V2;
    const { setupLangSmith } = await import("../src/core/tracing");
    setupLangSmith(makeConfig({ langsmithApiKey: "" }));
    expect(process.env.LANGCHAIN_TRACING_V2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// wrapWithTrace
// ---------------------------------------------------------------------------

describe("wrapWithTrace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls traceable with the function and options including name", async () => {
    const { wrapWithTrace } = await import("../src/core/tracing");
    const fn = async () => ({ artifacts: [] });
    wrapWithTrace(fn, "my-runner");
    expect(mockTraceable).toHaveBeenCalledOnce();
    expect(mockTraceable).toHaveBeenCalledWith(fn, expect.objectContaining({ name: "my-runner" }));
  });

  it("returns the wrapped function from traceable", async () => {
    const fn = async () => ({ artifacts: [] });
    const wrapped = async () => ({ artifacts: ["wrapped"] });
    mockTraceable.mockReturnValueOnce(wrapped);
    const { wrapWithTrace } = await import("../src/core/tracing");
    const result = wrapWithTrace(fn, "runner");
    expect(result).toBe(wrapped);
  });
});
