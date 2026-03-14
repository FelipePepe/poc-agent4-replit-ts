/**
 * tests/test_models.test.ts
 *
 * RED tests for core/models.ts — Fase 5
 * TDD: these must fail before the implementation exists.
 *
 * Model switching anti-doom-loop:
 *   - 0 ≤ consecutive_errors < 3  → main model   (Claude Sonnet)
 *   - 3 ≤ consecutive_errors < 6  → fallback model (Claude Haiku)
 *   - consecutive_errors ≥ 6      → local model   (Ollama)
 *   - consecutive_errors drops to 0 → auto-return to main model
 */

import { vi } from 'vitest';
import {
  selectModelName,
  makeModelRouter,
  FALLBACK_THRESHOLD,
  LOCAL_THRESHOLD,
  type ModelNames,
} from "../src/core/models";

const DEFAULT_NAMES: ModelNames = {
  main: "claude-sonnet",
  fallback: "claude-haiku",
  local: "ollama/phi3-mini",
};

describe("selectModelName", () => {
  it("FALLBACK_THRESHOLD is 3", () => {
    expect(FALLBACK_THRESHOLD).toBe(3);
  });

  it("LOCAL_THRESHOLD is 6", () => {
    expect(LOCAL_THRESHOLD).toBe(6);
  });

  it("returns main model when consecutiveErrors is 0", () => {
    expect(selectModelName(0, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-sonnet");
  });

  it("returns main model when consecutiveErrors is 1", () => {
    expect(selectModelName(1, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-sonnet");
  });

  it("returns main model when consecutiveErrors is 2", () => {
    expect(selectModelName(2, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-sonnet");
  });

  it("returns fallback model when consecutiveErrors equals FALLBACK_THRESHOLD", () => {
    expect(selectModelName(3, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-haiku");
  });

  it("returns fallback model when consecutiveErrors is 4", () => {
    expect(selectModelName(4, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-haiku");
  });

  it("returns fallback model when consecutiveErrors is 5", () => {
    expect(selectModelName(5, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("claude-haiku");
  });

  it("returns local model when consecutiveErrors equals LOCAL_THRESHOLD", () => {
    expect(selectModelName(6, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("ollama/phi3-mini");
  });

  it("returns local model when consecutiveErrors is 8", () => {
    expect(selectModelName(8, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES)).toBe("ollama/phi3-mini");
  });

  it("returns main model when errors reset to 0 (auto-return)", () => {
    // First switch to fallback, then errors resolve
    const afterError = selectModelName(3, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES);
    expect(afterError).toBe("claude-haiku");
    const afterResolve = selectModelName(0, FALLBACK_THRESHOLD, LOCAL_THRESHOLD, DEFAULT_NAMES);
    expect(afterResolve).toBe("claude-sonnet");
  });
});

describe("makeModelRouter", () => {
  // Mock LLMs
  const makeMockLlm = (name: string) => ({
    name,
    invoke: vi.fn().mockResolvedValue({ content: `response from ${name}` }),
  });

  it("returns a router with selectFor method", () => {
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: makeMockLlm("haiku") as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    expect(typeof router.selectFor).toBe("function");
  });

  it("selectFor returns main LLM when consecutiveErrors is 0", () => {
    const mainLlm = makeMockLlm("sonnet");
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: mainLlm as never, fallback: makeMockLlm("haiku") as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    expect(router.selectFor(0)).toBe(mainLlm);
  });

  it("selectFor returns fallback LLM when consecutiveErrors >= 3", () => {
    const haikuLlm = makeMockLlm("haiku");
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: haikuLlm as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    expect(router.selectFor(3)).toBe(haikuLlm);
    expect(router.selectFor(4)).toBe(haikuLlm);
  });

  it("selectFor returns local LLM when consecutiveErrors >= 6", () => {
    const ollamaLlm = makeMockLlm("ollama");
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: makeMockLlm("haiku") as never, local: ollamaLlm as never },
      DEFAULT_NAMES
    );
    expect(router.selectFor(6)).toBe(ollamaLlm);
    expect(router.selectFor(10)).toBe(ollamaLlm);
  });

  it("detectSwitch returns null when model stays the same", () => {
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: makeMockLlm("haiku") as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    // Same consecutive error level: no switch
    expect(router.detectSwitch("claude-sonnet", 0)).toBeNull();
  });

  it("detectSwitch returns new model name when model changes", () => {
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: makeMockLlm("haiku") as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    // Was on sonnet, now errors hit threshold → switch to haiku
    const newModel = router.detectSwitch("claude-sonnet", 3);
    expect(newModel).toBe("claude-haiku");
  });

  it("detectSwitch returns null when reverting to the same model", () => {
    const router = makeModelRouter(
      { fallback: FALLBACK_THRESHOLD, local: LOCAL_THRESHOLD },
      { main: makeMockLlm("sonnet") as never, fallback: makeMockLlm("haiku") as never, local: makeMockLlm("ollama") as never },
      DEFAULT_NAMES
    );
    // Already on haiku, errors still >= 3
    expect(router.detectSwitch("claude-haiku", 4)).toBeNull();
  });
});
