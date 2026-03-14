/**
 * agents/planner.ts
 *
 * PlannerAgent — Fase 2.
 *
 * Given a user task in the messages, calls the LLM to decompose it into
 * an ordered list of Subtask objects and stores them in state.subtasks.
 *
 * Security: LLM output is parsed strictly; any non-array JSON is rejected.
 * The planner never writes files or executes shell commands.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentState, Subtask } from "../core/state";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `You are a planner agent. Decompose the user task into an ordered list of concrete subtasks.

Return ONLY a valid JSON array — no explanation, no markdown fences. Each item must have:
- "id": unique string (s1, s2, …)
- "description": concise action to perform
- "type": one of "code", "search", or "verify"
- "status": always "pending"

Example:
[
  {"id":"s1","description":"Create app.py with Flask setup","type":"code","status":"pending"},
  {"id":"s2","description":"Add GET /ping route returning 200","type":"code","status":"pending"},
  {"id":"s3","description":"Verify /ping returns 200 OK","type":"verify","status":"pending"}
]`;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Strips markdown code fences (```json…``` or ```…```) from LLM output.
 */
function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * Parses the LLM response string as Subtask[].
 * Returns null on any parsing failure.
 * Forces status = "pending" on all returned subtasks.
 */
function parseSubtasks(raw: string): Subtask[] | null {
  try {
    const cleaned = stripMarkdownFences(raw.trim());
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return null;
    return (parsed as Subtask[]).map((s) => ({ ...s, status: "pending" as const }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Creates a PlannerAgent node that decomposes the current task into subtasks.
 */
export function makePlannerNode(llm: BaseChatModel) {
  return async function plannerNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    try {
      const response = await llm.invoke([
        new SystemMessage(PLANNER_SYSTEM_PROMPT),
        ...state.messages,
      ]);

      const content =
        typeof response.content === "string" ? response.content : "";
      const subtasks = parseSubtasks(content);

      if (!subtasks) {
        return {
          subtasks: [],
          active_agent: "planner",
          error_count: state.error_count + 1,
          consecutive_errors: state.consecutive_errors + 1,
        };
      }

      return { subtasks, active_agent: "planner" };
    } catch {
      return {
        subtasks: [],
        active_agent: "planner",
        error_count: state.error_count + 1,
        consecutive_errors: state.consecutive_errors + 1,
      };
    }
  };
}
