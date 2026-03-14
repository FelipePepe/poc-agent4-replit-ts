/**
 * core/graph.ts
 *
 * LangGraph graph definition — Fase 0 + Fase 1 + Fase 3 + Fase 4 + Fase 5.
 *
 * Topology:
 *   START → supervisor
 *   supervisor -(tool_calls?)→ tool_executor → supervisor  (ReAct loop)
 *   supervisor -(2+ pending subtasks, no tool_calls)→ parallel_executor → verifier
 *   supervisor -(otherwise)→ verifier → END
 *
 * Fase 4 — ephemeral classifier injection:
 *   Before each LLM call the supervisor checks consecutiveErrors / token count.
 *   When the classifier activates it appends a SystemMessage with micro-instructions
 *   to the LLM call context ONLY (never stored in state.messages).
 *   active_instructions in state tracks what was injected for logging.
 *
 * Fase 5 — model switching anti-doom-loop:
 *   Supervisor selects model based on consecutive_errors using the injected
 *   modelRouter. On every model change, model_switches is incremented and
 *   current_model is updated. Auto-returns to main model when errors resolve.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentStateAnnotation, type AgentState } from "./state";
import type { Config } from "./config";
import type { ShellResult } from "./tools";
import {
  makeParallelExecutorNode,
  type WorkerMap,
} from "../agents/parallel_executor";
import {
  makeTrajectoryClassifier,
  ACTIVATION_THRESHOLD,
} from "../guidance/classifier";
import { makeModelRouter } from "./models";
import type { BaseMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// GraphTools — plain-function interface for sandbox tools
// ---------------------------------------------------------------------------

export interface GraphTools {
  read_file?: (args: { path: string }) => string;
  write_file?: (args: { path: string; content: string }) => void;
  execute_shell?: (args: {
    command: string;
    args?: string[];
  }) => ShellResult;
  search_web?: (args: { query: string }) => string;
}

// ---------------------------------------------------------------------------
// Graph configuration
// ---------------------------------------------------------------------------

export interface GraphConfig {
  config: Config;
  llm: BaseChatModel;
  /** Optional tools injected for test isolation. */
  tools?: GraphTools;
  /** Optional parallel worker map injected for Fase 3 (default: empty). */
  parallelWorkers?: WorkerMap;
  /**
   * Optional classifier for Fase 4 ephemeral injection.
   * When provided, the supervisor calls it on every step where
   * consecutiveErrors >= ACTIVATION_THRESHOLD to get micro-instructions.
   */
  classifier?: ReturnType<typeof makeTrajectoryClassifier>;
  /**
   * Optional model router for Fase 5 anti-doom-loop switching.
   * When provided, the supervisor selects the appropriate LLM based on
   * consecutive_errors and increments model_switches on transitions.
   */
  modelRouter?: ReturnType<typeof makeModelRouter>;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token count: 1 token ≈ 4 characters.
 * Good enough for the activation gate — no external tokeniser needed.
 */
function estimateTokens(messages: BaseMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(content.length / 4);
  }, 0);
}

// ---------------------------------------------------------------------------
// Supervisor node — calls LLM, returns response
// ---------------------------------------------------------------------------

function makeSupervisorNode(
  llm: BaseChatModel,
  classifier?: ReturnType<typeof makeTrajectoryClassifier>,
  modelRouter?: ReturnType<typeof makeModelRouter>
) {
  return async function supervisorNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const systemMessage = new SystemMessage(
      "You are a supervisor agent coordinating a multi-agent system. " +
        "Analyse the user request and use the available tools when needed."
    );

    // ------------------------------------------------------------------
    // Fase 5: select active model based on consecutive_errors
    // ------------------------------------------------------------------
    const activeLlm = modelRouter?.selectFor(state.consecutive_errors) ?? llm;
    const switchedTo = modelRouter?.detectSwitch(
      state.current_model,
      state.consecutive_errors
    ) ?? null;
    const modelSwitches = state.model_switches + (switchedTo !== null ? 1 : 0);
    const currentModel = switchedTo ?? state.current_model;

    // ------------------------------------------------------------------
    // Fase 4: ephemeral classifier injection
    // ------------------------------------------------------------------
    let activeInstructions: string[] = [];
    const contextMessages: BaseMessage[] = [...state.messages];

    if (classifier && state.consecutive_errors >= ACTIVATION_THRESHOLD) {
      const classResult = classifier.classify({
        consecutiveErrors: state.consecutive_errors,
        tokenCount: estimateTokens(state.messages),
      });
      if (classResult.shouldActivate && classResult.microInstructions.length > 0) {
        // Inject at END — NOT stored in state.messages
        contextMessages.push(
          new SystemMessage(
            "[GUIDANCE] " + classResult.microInstructions.join(" ")
          )
        );
        activeInstructions = classResult.microInstructions;
      }
    }

    const response = await activeLlm.invoke([systemMessage, ...contextMessages]);

    return {
      messages: [response],
      active_agent: "supervisor",
      current_model: currentModel,
      model_switches: modelSwitches,
      active_instructions: activeInstructions,
    };
  };
}

// ---------------------------------------------------------------------------
// Routing — supervisor conditional edge
// ---------------------------------------------------------------------------

function supervisorRouter(
  state: AgentState
): "tool_executor" | "parallel_executor" | "verifier" {
  const lastMessage = state.messages[state.messages.length - 1];
  if (
    lastMessage instanceof AIMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    return "tool_executor";
  }
  // Fase 3: fan-out when there are 2+ independent pending subtasks
  const pendingCount = state.subtasks.filter((s) => s.status === "pending").length;
  if (pendingCount >= 2) {
    return "parallel_executor";
  }
  return "verifier";
}

// ---------------------------------------------------------------------------
// Tool executor node — executes one round of tool calls
// ---------------------------------------------------------------------------

function makeToolExecutorNode(tools: GraphTools) {
  return async function toolExecutorNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    // Routing invariant: supervisorRouter only routes here when the last
    // message is an AIMessage with non-empty tool_calls.
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolMessages: ToolMessage[] = [];

    // Routing invariant: supervisorRouter guarantees tool_calls is non-empty.
    for (const call of lastMessage.tool_calls!) {
      const toolFn = tools[call.name as keyof GraphTools];
      const callId = call.id ?? `tc-${Date.now()}`;

      if (!toolFn) {
        toolMessages.push(
          new ToolMessage({
            content: `Tool "${call.name}" is not available`,
            tool_call_id: callId,
            name: call.name,
          })
        );
        continue;
      }

      try {
        const result = await Promise.resolve(
          (toolFn as (args: Record<string, unknown>) => unknown)(
            call.args as Record<string, unknown>
          )
        );
        toolMessages.push(
          new ToolMessage({
            content:
              result === undefined || result === null
                ? "ok"
                : typeof result === "string"
                  ? result
                  : JSON.stringify(result),
            tool_call_id: callId,
            name: call.name,
          })
        );
      } catch (err: unknown) {
        toolMessages.push(
          new ToolMessage({
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            tool_call_id: callId,
            name: call.name,
          })
        );
      }
    }

    return { messages: toolMessages };
  };
}

// ---------------------------------------------------------------------------
// Verifier node — Fase 1 pass-through (will grow in Fase 2+)
// ---------------------------------------------------------------------------

async function verifierNode(
  _state: AgentState
): Promise<Partial<AgentState>> {
  // Fase 1 minimal: no validation logic. Future phases check task correctness.
  return {};
}

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

export function buildGraph(graphConfig: GraphConfig) {
  const { llm, tools = {}, parallelWorkers = {}, classifier, modelRouter } = graphConfig;

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", makeSupervisorNode(llm, classifier, modelRouter))
    .addNode("tool_executor", makeToolExecutorNode(tools))
    .addNode("parallel_executor", makeParallelExecutorNode(parallelWorkers))
    .addNode("verifier", verifierNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", supervisorRouter, {
      tool_executor: "tool_executor",
      parallel_executor: "parallel_executor",
      verifier: "verifier",
    })
    .addEdge("tool_executor", "supervisor")
    .addEdge("parallel_executor", "verifier")
    .addEdge("verifier", END);

  return graph.compile();
}

