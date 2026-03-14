/**
 * agents/searcher.ts
 *
 * SearcherAgent — Fase 2.
 *
 * Finds the first pending "search" subtask and calls the search_web tool.
 * Appends the results as an AIMessage and marks the subtask as done.
 *
 * Security: Search is read-only; no file or shell access.
 */

import { AIMessage } from "@langchain/core/messages";
import type { AgentState, Subtask } from "../core/state";
import type { GraphTools } from "../core/graph";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Finds the first pending subtask with type "search".
 */
function findPendingSearchTask(subtasks: Subtask[]): Subtask | undefined {
  return subtasks.find((s) => s.type === "search" && s.status === "pending");
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Creates a SearcherAgent node that handles search subtasks.
 */
export function makeSearcherNode(tools: GraphTools) {
  return async function searcherNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const target = findPendingSearchTask(state.subtasks);

    if (!target) {
      return {};
    }

    const results =
      tools.search_web?.({ query: target.description }) ??
      "[No search results available]";

    const updatedSubtasks = state.subtasks.map((s) =>
      s.id === target.id
        ? { ...s, status: "done" as const, result: results }
        : s
    );

    return {
      messages: [new AIMessage(results)],
      subtasks: updatedSubtasks,
      active_agent: "searcher",
    };
  };
}
