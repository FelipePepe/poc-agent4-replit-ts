/**
 * core/state.ts
 *
 * AgentState — canonical shared state for the entire agent graph.
 *
 * ⚠️  CRITICAL: This schema is defined in full from Phase 0.
 * Do NOT add or remove fields after checkpoints have been persisted —
 * doing so would break stored snapshots and force costly migrations.
 *
 * Field annotations mirror the Python spec in poc-agent4-prompt-v2.md.
 *
 * LangGraph.js 0.2.x channel API:
 *   - ch.initialValueFactory() → returns the default value
 *   - ch.operator(prev, next)  → applies the reducer
 */

import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

// ---------------------------------------------------------------------------
// AgentState — single source of truth for the graph
// ---------------------------------------------------------------------------

export const AgentStateAnnotation = Annotation.Root({
  // --- Phase 1 ---
  /** Full conversation history; uses the built-in messagesStateReducer. */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /** Tool calls invoked in the current step. */
  tool_calls: Annotation<ToolCall[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** Total accumulated error count (never resets). */
  error_count: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** Currently active model identifier. */
  current_model: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "gpt-4o",
  }),

  // --- Phase 2 ---
  /** Unique task identifier (UUID). */
  task_id: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** Ordered list of subtasks produced by PlannerAgent. */
  subtasks: Annotation<Subtask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** Name of the agent currently in control of the flow. */
  active_agent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "supervisor",
  }),

  // --- Phase 3 ---
  /** Aggregated results from parallel sub-agent executions. */
  parallel_results: Annotation<Record<string, unknown>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),

  // --- Phase 4 ---
  /**
   * Ephemeral micro-instructions injected by the TrajectoryClassifier.
   * Appended at the END of context, never in the system prompt.
   * Must NOT persist in the history after resolution.
   */
  active_instructions: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** Consecutive errors without a successful step (resets on success). */
  consecutive_errors: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // --- Phase 5 ---
  /** How many times the model has been switched in this task. */
  model_switches: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // --- Phase 6 ---
  /** ID of the last active snapshot, or null when none exists. */
  snapshot_id: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// Auxiliary types referenced by AgentState
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Subtask {
  id: string;
  description: string;
  /** Type of subtask — used by supervisor to route to the right agent. */
  type?: "code" | "search" | "verify";
  status: "pending" | "in_progress" | "done" | "failed";
  assigned_agent?: string;
  result?: string;
}
