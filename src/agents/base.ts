/**
 * agents/base.ts
 *
 * Shared types for all agent nodes.
 * Each agent is a factory function that returns an async node function
 * compatible with LangGraph's StateGraph node interface.
 */

import type { AgentState } from "../core/state";

/**
 * A LangGraph node function for an agent:
 * receives the current state, returns a partial state update.
 */
export type AgentNodeFn = (
  state: AgentState
) => Promise<Partial<AgentState>>;
