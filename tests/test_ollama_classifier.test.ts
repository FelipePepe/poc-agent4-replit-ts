/**
 * tests/test_ollama_classifier.test.ts
 *
 * RED tests for src/guidance/ollama_classifier.ts
 * TDD: tests must fail before the implementation exists.
 *
 * createLlmClassifier(baseUrl, model) — async LLM-based trajectory classifier
 * that calls the Ollama HTTP API and falls back to no-op on errors.
 */

import { vi } from "vitest";
import type { ClassifierInput } from "../src/guidance/classifier";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function ollamaResponse(content: string) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ message: { content } }),
  });
}

function ollamaError() {
  return Promise.reject(new Error("connection refused"));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseInput: ClassifierInput = {
  consecutiveErrors: 3,
  recentToolResults: ["Error: file not found", "Error: permission denied"],
  tokenCount: 1000,
  recentToolCallNames: ["write_file", "write_file", "write_file"],
};

// ---------------------------------------------------------------------------
// createLlmClassifier
// ---------------------------------------------------------------------------

describe("createLlmClassifier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a classifier object with a classify method", async () => {
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    expect(typeof classifier.classify).toBe("function");
  });

  it("calls Ollama API with the correct URL and model", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "tool-failure", microInstruction: "retry carefully" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    await classifier.classify(baseInput);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(JSON.parse(opts.body).model).toBe("phi3:mini");
  });

  it("returns shouldActivate=true and labels from LLM response", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "tool-failure", microInstruction: "check file paths" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(true);
    expect(result.labels).toContain("tool-failure");
    expect(result.microInstructions.length).toBeGreaterThan(0);
  });

  it("uses the microInstruction from LLM response when provided", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "error-loop", microInstruction: "try a different strategy" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.microInstructions).toContain("try a different strategy");
  });

  it("falls back to no-op when Ollama is unreachable", async () => {
    mockFetch.mockReturnValueOnce(ollamaError());
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(false);
    expect(result.labels).toEqual([]);
    expect(result.microInstructions).toEqual([]);
  });

  it("falls back to no-op when LLM response is malformed JSON", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse("not valid json at all")
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(false);
  });

  it("returns shouldActivate=false for situation=no-issue", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "no-issue", microInstruction: "" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify({ consecutiveErrors: 0 });
    expect(result.shouldActivate).toBe(false);
  });

  it("sends context info in the prompt (errors, tool results)", async () => {
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "no-issue", microInstruction: "" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    await classifier.classify(baseInput);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const promptText = body.messages[0].content;
    expect(promptText).toContain("3"); // consecutiveErrors
    expect(promptText).toContain("Error: file not found");
  });

  it("returns no-op when HTTP response is not ok (line 99)", async () => {
    // Exercises: if (!response.ok) return NO_OP_RESULT
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      })
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(false);
    expect(result.labels).toEqual([]);
    expect(result.microInstructions).toEqual([]);
  });

  it("falls back to MICRO_INSTRUCTIONS when LLM microInstruction is empty string (lines 108-110)", async () => {
    // Exercises: parsed.microInstruction?.trim() is falsy → falls back to MICRO_INSTRUCTIONS[situation]
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "error-loop", microInstruction: "" }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(true);
    expect(result.labels).toContain("error-loop");
    // Should use MICRO_INSTRUCTIONS["error-loop"] as fallback
    expect(result.microInstructions.length).toBeGreaterThan(0);
    expect(result.microInstructions[0]).toContain("error loop");
  });

  it("falls back to MICRO_INSTRUCTIONS when LLM microInstruction is absent (undefined)", async () => {
    // Exercises: parsed.microInstruction is undefined → parsed.microInstruction?.trim() is undefined (falsy)
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({ situation: "tool-failure" })) // no microInstruction key
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    expect(result.shouldActivate).toBe(true);
    expect(result.labels).toContain("tool-failure");
    expect(result.microInstructions.length).toBeGreaterThan(0);
  });

  it("returns empty microInstructions when both microInstruction and MICRO_INSTRUCTIONS fallback are empty (lines 108-115)", async () => {
    // Exercises:
    //   line 108-110: parsed.microInstruction?.trim() is "" (falsy)
    //                 AND MICRO_INSTRUCTIONS[situation] is undefined (unknown situation label)
    //                 → falls through to "" (line 110: || "")
    //   line 115: microInstruction ? [microInstruction] : [] → uses [] (the false branch)
    mockFetch.mockReturnValueOnce(
      ollamaResponse(JSON.stringify({
        situation: "unknown-custom-label", // not in MICRO_INSTRUCTIONS map
        microInstruction: "",              // empty string → falsy
      }))
    );
    const { createLlmClassifier } = await import("../src/guidance/ollama_classifier");
    const classifier = createLlmClassifier("http://localhost:11434", "phi3:mini");
    const result = await classifier.classify(baseInput);
    // situation !== "no-issue" → shouldActivate: true
    expect(result.shouldActivate).toBe(true);
    // microInstruction ends up "" → microInstructions is []
    expect(result.microInstructions).toEqual([]);
  });
});
