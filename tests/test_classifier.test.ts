/**
 * tests/test_classifier.test.ts
 *
 * RED tests for guidance/classifier.ts — Fase 4
 * TDD: these must fail before the implementation exists.
 *
 * TrajectoryClassifier: rule-based situation detector that injects ephemeral
 * micro-instructions when consecutive errors or context size cross thresholds.
 */

import {
  makeTrajectoryClassifier,
  ACTIVATION_THRESHOLD,
  TOKEN_THRESHOLD,
  MICRO_INSTRUCTIONS,
  type ClassifierInput,
  type SituationLabel,
} from "../src/guidance/classifier";

describe("makeTrajectoryClassifier", () => {
  const classifier = makeTrajectoryClassifier();

  // ---- Factory ------------------------------------------------------------

  it("returns an object with a classify function", () => {
    expect(typeof classifier.classify).toBe("function");
  });

  // ---- Activation gate ----------------------------------------------------

  it("ACTIVATION_THRESHOLD is 2", () => {
    expect(ACTIVATION_THRESHOLD).toBe(2);
  });

  it("TOKEN_THRESHOLD is 8000", () => {
    expect(TOKEN_THRESHOLD).toBe(8000);
  });

  it("shouldActivate is false when consecutiveErrors < 2 and no token overflow", () => {
    const result = classifier.classify({
      consecutiveErrors: 1,
      tokenCount: 100,
    });
    expect(result.shouldActivate).toBe(false);
    expect(result.microInstructions).toEqual([]);
  });

  it("shouldActivate is true when consecutiveErrors >= 2", () => {
    const result = classifier.classify({ consecutiveErrors: 2 });
    expect(result.shouldActivate).toBe(true);
  });

  it("shouldActivate is true when tokenCount > TOKEN_THRESHOLD", () => {
    const result = classifier.classify({
      consecutiveErrors: 0,
      tokenCount: TOKEN_THRESHOLD + 1,
    });
    expect(result.shouldActivate).toBe(true);
  });

  // ---- Label detection ----------------------------------------------------

  it("detects 'no-issue' when not activated", () => {
    const result = classifier.classify({ consecutiveErrors: 0 });
    expect(result.labels).toContain("no-issue" as SituationLabel);
  });

  it("detects 'multiple-errors' when consecutiveErrors == 2", () => {
    const result = classifier.classify({ consecutiveErrors: 2 });
    expect(result.labels).toContain("multiple-errors" as SituationLabel);
  });

  it("detects 'error-loop' when consecutiveErrors >= 3", () => {
    const result = classifier.classify({ consecutiveErrors: 3 });
    expect(result.labels).toContain("error-loop" as SituationLabel);
  });

  it("detects 'error-loop' at consecutiveErrors == 5", () => {
    const result = classifier.classify({ consecutiveErrors: 5 });
    expect(result.labels).toContain("error-loop" as SituationLabel);
  });

  it("detects 'context-overflow' when tokenCount > TOKEN_THRESHOLD", () => {
    const result = classifier.classify({
      consecutiveErrors: 0,
      tokenCount: TOKEN_THRESHOLD + 500,
    });
    expect(result.labels).toContain("context-overflow" as SituationLabel);
  });

  it("detects 'tool-failure' when 2+ recent tool results start with 'Error:'", () => {
    const result = classifier.classify({
      consecutiveErrors: 2,
      recentToolResults: ["Error: file not found", "Error: permission denied"],
    });
    expect(result.labels).toContain("tool-failure" as SituationLabel);
  });

  it("does NOT detect 'tool-failure' when fewer than 2 errors in tool results", () => {
    const result = classifier.classify({
      consecutiveErrors: 2,
      recentToolResults: ["ok", "Error: one error"],
    });
    expect(result.labels).not.toContain("tool-failure" as SituationLabel);
  });

  it("detects 'stuck-on-file' when the same tool is called 3+ times in a row", () => {
    const result = classifier.classify({
      consecutiveErrors: 2,
      recentToolCallNames: ["write_file", "write_file", "write_file"],
    });
    expect(result.labels).toContain("stuck-on-file" as SituationLabel);
  });

  it("does NOT detect 'stuck-on-file' when tool calls vary", () => {
    const result = classifier.classify({
      consecutiveErrors: 2,
      recentToolCallNames: ["write_file", "read_file", "write_file"],
    });
    expect(result.labels).not.toContain("stuck-on-file" as SituationLabel);
  });

  // ---- Micro-instructions -------------------------------------------------

  it("returns micro-instructions matching detected labels", () => {
    const result = classifier.classify({ consecutiveErrors: 3 });
    expect(result.microInstructions.length).toBeGreaterThan(0);
    result.microInstructions.forEach((instr) => {
      expect(typeof instr).toBe("string");
      expect(instr.length).toBeGreaterThan(0);
    });
  });

  it("returns no micro-instructions when shouldActivate is false", () => {
    const result = classifier.classify({ consecutiveErrors: 0 });
    expect(result.microInstructions).toEqual([]);
  });

  it("includes 'error-loop' instruction text when error-loop detected", () => {
    const result = classifier.classify({ consecutiveErrors: 3 });
    const combined = result.microInstructions.join("\n");
    expect(combined.length).toBeGreaterThan(0);
    // error-loop instruction should be a non-trivial sentence
    expect(combined).toMatch(/error|loop|approach/i);
  });

  it("MICRO_INSTRUCTIONS has an entry for each non-trivial SituationLabel", () => {
    const labels: SituationLabel[] = [
      "error-loop",
      "multiple-errors",
      "tool-failure",
      "context-overflow",
      "stuck-on-file",
    ];
    labels.forEach((label) => {
      expect(typeof MICRO_INSTRUCTIONS[label]).toBe("string");
      expect(MICRO_INSTRUCTIONS[label].length).toBeGreaterThan(10);
    });
  });

  // ---- No state mutation --------------------------------------------------

  it("classify does not mutate the input object", () => {
    const input: ClassifierInput = {
      consecutiveErrors: 3,
      recentToolResults: ["Error: fail"],
    };
    const original = JSON.stringify(input);
    classifier.classify(input);
    expect(JSON.stringify(input)).toBe(original);
  });

  // ---- Combined activation ------------------------------------------------

  it("can detect multiple labels in a single call", () => {
    const result = classifier.classify({
      consecutiveErrors: 3,
      tokenCount: TOKEN_THRESHOLD + 100,
      recentToolResults: ["Error: x", "Error: y"],
    });
    expect(result.labels.length).toBeGreaterThanOrEqual(2);
    expect(result.labels).toContain("error-loop" as SituationLabel);
    expect(result.labels).toContain("context-overflow" as SituationLabel);
  });
});
