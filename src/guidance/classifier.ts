/**
 * src/guidance/classifier.ts
 *
 * TrajectoryClassifier — Fase 4
 *
 * A rule-based classifier that detects problematic agent trajectories and
 * provides ephemeral micro-instructions to guide the supervisor LLM.
 *
 * Design decisions:
 *  - Rule-based (not phi3-mini): The Python PoC uses Ollama for this; the
 *    TypeScript port uses deterministic rules for correctness + testability.
 *    Behaviour is equivalent: classify trajectory → inject micro-instruction.
 *  - Activation gate: only runs when consecutiveErrors >= 2 OR tokens > 8000.
 *    This keeps it a "decision-time" tool, never called on every step.
 *  - Ephemeral injection: instructions are returned to the caller (supervisor),
 *    which adds them to the LLM call context but NEVER stores them in the
 *    message history — they vanish once the situation resolves.
 *
 * Security: pure function, no I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum consecutive errors to trigger the classifier. */
export const ACTIVATION_THRESHOLD = 2;

/** Token count above which context-overflow is detected. */
export const TOKEN_THRESHOLD = 8000;

/** Minimum number of failing tool results to flag "tool-failure". */
const TOOL_FAILURE_COUNT = 2;

/** Minimum streak of the same tool call name to flag "stuck-on-file". */
const STUCK_STREAK = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SituationLabel =
  | "error-loop"
  | "multiple-errors"
  | "tool-failure"
  | "context-overflow"
  | "stuck-on-file"
  | "plan-mismatch"
  | "no-issue";

export interface ClassifierInput {
  /** Number of consecutive errors in the current trajectory. */
  consecutiveErrors: number;
  /** Recent tool result strings (e.g., ToolMessage.content values). */
  recentToolResults?: string[];
  /** Estimated token count of the current context. */
  tokenCount?: number;
  /** Names of recent tool calls (for stuck-on-file detection). */
  recentToolCallNames?: string[];
}

export interface ClassificationResult {
  /** False when activation threshold was not met — classifier skipped. */
  shouldActivate: boolean;
  /** Ordered list of detected situation labels. */
  labels: SituationLabel[];
  /** Ephemeral micro-instructions to inject at the end of the LLM context. */
  microInstructions: string[];
}

// ---------------------------------------------------------------------------
// Micro-instruction library
// ---------------------------------------------------------------------------

/**
 * MICRO_INSTRUCTIONS — 10+ hand-crafted instructions, one per situation label.
 *
 * These are injected at the END of the LLM context (not the system prompt)
 * and are NOT persisted in message history after the situation resolves.
 */
export const MICRO_INSTRUCTIONS: Record<SituationLabel, string> = {
  "error-loop":
    "You are stuck in an error loop (3+ consecutive errors). " +
    "Try a fundamentally different approach: simplify the operation, verify " +
    "preconditions with read_file, and avoid repeating the exact same failed action. " +
    "If a file write keeps failing, check whether the directory exists first.",

  "multiple-errors":
    "Multiple consecutive errors have occurred. " +
    "Review your last action carefully: ensure file paths are correct, " +
    "arguments are valid, and the target file or directory exists. " +
    "Use read_file to inspect the current state before making further changes.",

  "tool-failure":
    "Several recent tool calls have failed. " +
    "Double-check all tool arguments and file paths before retrying. " +
    "Use read_file to understand the current state. " +
    "Prefer smaller, verifiable steps over large combined operations.",

  "context-overflow":
    "The conversation context is growing very large. " +
    "Focus exclusively on the immediate next step. " +
    "Avoid retrieving large files unnecessarily. " +
    "Summarise progress mentally and proceed with precision.",

  "stuck-on-file":
    "You are repeatedly calling the same tool on the same target. " +
    "If file writes continue to fail, read the file first to understand its state. " +
    "Consider whether the file needs to be created, overwritten, or appended. " +
    "A different approach may be required.",

  "plan-mismatch":
    "The current state may no longer match the original plan. " +
    "Re-read the task description. Verify that your intended actions still " +
    "align with the goal before proceeding. Adjust the plan if necessary.",

  "no-issue": "",
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * makeTrajectoryClassifier
 *
 * Returns a classifier object with a single `classify(input)` method.
 * Call `classify` after each supervisor step when `consecutiveErrors >= 2`
 * or context token count exceeds TOKEN_THRESHOLD.
 */
export function makeTrajectoryClassifier() {
  function classify(input: ClassifierInput): ClassificationResult {
    const {
      consecutiveErrors,
      recentToolResults = [],
      tokenCount,
      recentToolCallNames = [],
    } = input;

    // ------------------------------------------------------------------
    // Activation gate — skip entirely when below both thresholds
    // ------------------------------------------------------------------
    const shouldActivate =
      consecutiveErrors >= ACTIVATION_THRESHOLD ||
      (tokenCount !== undefined && tokenCount > TOKEN_THRESHOLD);

    if (!shouldActivate) {
      return { shouldActivate: false, labels: ["no-issue"], microInstructions: [] };
    }

    // ------------------------------------------------------------------
    // Label detection
    // ------------------------------------------------------------------
    const labels: SituationLabel[] = [];

    // Error severity
    if (consecutiveErrors >= 3) {
      labels.push("error-loop");
    } else if (consecutiveErrors >= 2) {
      labels.push("multiple-errors");
    }

    // Context overflow
    if (tokenCount !== undefined && tokenCount > TOKEN_THRESHOLD) {
      labels.push("context-overflow");
    }

    // Tool failure: count recent results that start with "Error:"
    const failCount = recentToolResults.filter((r) =>
      r.startsWith("Error:")
    ).length;
    if (failCount >= TOOL_FAILURE_COUNT) {
      labels.push("tool-failure");
    }

    // Stuck on file: same tool name repeated STUCK_STREAK times in a row
    if (recentToolCallNames.length >= STUCK_STREAK) {
      const tail = recentToolCallNames.slice(-STUCK_STREAK);
      const allSame = tail.every((name) => name === tail[0]);
      if (allSame) {
        labels.push("stuck-on-file");
      }
    }

    // ------------------------------------------------------------------
    // Build micro-instructions list
    // ------------------------------------------------------------------
    const microInstructions = labels
      .map((label) => MICRO_INSTRUCTIONS[label])
      .filter((instr) => instr.length > 0);

    return { shouldActivate: true, labels, microInstructions };
  }

  return { classify };
}
