/**
 * core/graph.ts
 *
 * LangGraph graph definition — Fase 0: minimal single-node graph.
 *
 * Phase 0 topology:
 *   START → supervisor → END
 *
 * The supervisor node calls the LLM with the current messages and
 * appends the response. No tool calls yet — that is Phase 1.
 *
 * Design:
 * - buildGraph(config) is a pure factory — injectable and testable.
 * - The LLM is injected via GraphConfig so tests can pass a mock.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentStateAnnotation, type AgentState } from "./state";
import type { Config } from "./config";

// ---------------------------------------------------------------------------
// Graph configuration
// ---------------------------------------------------------------------------

export interface GraphConfig {
  config: Config;
  llm: BaseChatModel;
}

// ---------------------------------------------------------------------------
// Supervisor node (Phase 0: calls LLM, returns response)
// ---------------------------------------------------------------------------

function makeSupervisorNode(llm: BaseChatModel) {
  return async function supervisorNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const systemMessage = new SystemMessage(
      "You are a supervisor agent coordinating a multi-agent system. " +
        "Analyse the user request and respond helpfully."
    );

    const response = await llm.invoke([systemMessage, ...state.messages]);

    return {
      messages: [response],
      active_agent: "supervisor",
      current_model: state.current_model,
    };
  };
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

export function buildGraph(graphConfig: GraphConfig) {
  const { llm } = graphConfig;

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", makeSupervisorNode(llm))
    .addEdge(START, "supervisor")
    .addEdge("supervisor", END);

  return graph.compile();
}
