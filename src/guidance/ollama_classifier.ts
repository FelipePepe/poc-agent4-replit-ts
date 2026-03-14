/**
 * src/guidance/ollama_classifier.ts
 *
 * LLM-based trajectory classifier using Ollama (phi3:mini by default).
 *
 * Design:
 *  - Same interface as the rule-based classifier (classify method + ClassificationResult).
 *  - Calls the Ollama /api/chat endpoint with a structured prompt asking the LLM
 *    to classify the current trajectory as a SituationLabel and provide a micro-instruction.
 *  - Falls back to a no-op result (shouldActivate: false) on any error:
 *    network failure, timeout, malformed JSON — agent is never blocked.
 *  - Used by createGraphRunner when OLLAMA_BASE_URL is set in the environment.
 *
 * Security: no secrets handled here; baseUrl is passed as a config value.
 */

import type { ClassifierInput, ClassificationResult, SituationLabel } from "./classifier";
import { MICRO_INSTRUCTIONS } from "./classifier";

// ---------------------------------------------------------------------------
// Ollama API types
// ---------------------------------------------------------------------------

interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  format: "json";
}

interface OllamaLlmResponse {
  situation: string;
  microInstruction?: string;
}

// ---------------------------------------------------------------------------
// No-op fallback
// ---------------------------------------------------------------------------

const NO_OP_RESULT: ClassificationResult = {
  shouldActivate: false,
  labels: [],
  microInstructions: [],
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(input: ClassifierInput): string {
  const { consecutiveErrors, recentToolResults = [], tokenCount, recentToolCallNames = [] } = input;

  return [
    "You are a trajectory classifier for an AI coding agent.",
    "Analyse the agent's current state and classify the situation.",
    "",
    `consecutive_errors: ${consecutiveErrors}`,
    `token_count: ${tokenCount ?? "unknown"}`,
    `recent_tool_results: ${recentToolResults.join(" | ")}`,
    `recent_tool_call_names: ${recentToolCallNames.join(", ")}`,
    "",
    "Classify the situation as ONE of:",
    "  error-loop, multiple-errors, tool-failure, context-overflow, stuck-on-file, plan-mismatch, no-issue",
    "",
    "Respond with a JSON object only, no extra text:",
    '{ "situation": "<label>", "microInstruction": "<one sentence guidance for the agent>" }',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createLlmClassifier
 *
 * Returns a classifier backed by an Ollama LLM.
 * Falls back silently to no-op on any error so the agent is never blocked.
 *
 * @param baseUrl   Ollama server base URL (e.g. "http://localhost:11434")
 * @param model     Model name (e.g. "phi3:mini")
 */
export function createLlmClassifier(baseUrl: string, model: string) {
  async function classify(input: ClassifierInput): Promise<ClassificationResult> {
    try {
      const request: OllamaChatRequest = {
        model,
        messages: [{ role: "user", content: buildPrompt(input) }],
        stream: false,
        format: "json",
      };

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) return NO_OP_RESULT;

      const data = await response.json() as { message: { content: string } };
      const parsed: OllamaLlmResponse = JSON.parse(data.message.content);

      const situation = parsed.situation as SituationLabel;
      if (situation === "no-issue" || !situation) return NO_OP_RESULT;

      const microInstruction =
        parsed.microInstruction?.trim() ||
        MICRO_INSTRUCTIONS[situation] ||
        "";

      return {
        shouldActivate: true,
        labels: [situation],
        microInstructions: microInstruction ? [microInstruction] : [],
      };
    } catch {
      return NO_OP_RESULT;
    }
  }

  return { classify };
}
