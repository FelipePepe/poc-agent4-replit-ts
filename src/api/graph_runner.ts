/**
 * src/api/graph_runner.ts
 *
 * Factory that wires the real LangGraph graph to the REST API's GraphRunner interface.
 *
 * Usage (in src/api/index.ts):
 *   import { createGraphRunner } from "./graph_runner";
 *   import { getConfig } from "../core/config";
 *   const runner = createGraphRunner(getConfig());
 *   const app = createApp(undefined, runner);
 *
 * Design:
 *  - Pure factory — no global state, fully injectable/testable.
 *  - Uses Ollama fallback as placeholder for local model (phi3-mini) until
 *    Ollama integration is fully wired (roadmap item #3).
 *  - If ANTHROPIC_API_KEY is invalid the graph.invoke() will throw and the
 *    REST layer will transition the task to "failed" — no crash at startup.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { buildGraph } from "../core/graph";
import { makeTools } from "../core/tools";
import { makeTrajectoryClassifier } from "../guidance/classifier";
import { makeModelRouter } from "../core/models";
import type { Config } from "../core/config";
import type { GraphRunner } from "./server";

/**
 * createGraphRunner
 *
 * Builds a GraphRunner from the given Config. Creates LLM instances,
 * sandboxed tools, classifier, and model router, then compiles the graph.
 *
 * The returned function accepts a prompt string and resolves with the
 * artifacts produced by the agent (file paths written during execution).
 */
export function createGraphRunner(config: Config): GraphRunner {
  const mainLlm = new ChatAnthropic({
    model: config.models.primary,
    apiKey: config.anthropicApiKey,
  });

  const fallbackLlm = new ChatAnthropic({
    model: config.models.fallback,
    apiKey: config.anthropicApiKey,
  });

  // Local model (phi3-mini via Ollama) — placeholder until Ollama wiring is complete
  const localLlm = fallbackLlm;

  const tools = makeTools({
    sandboxDir: config.sandbox.dir,
    commandTimeoutMs: config.sandbox.commandTimeoutMs,
    allowedCommands: [...config.sandbox.allowedCommands],
  });

  const classifier = makeTrajectoryClassifier();

  const modelRouter = makeModelRouter(
    { fallback: config.models.fallbackThreshold, local: config.models.localThreshold },
    { main: mainLlm, fallback: fallbackLlm, local: localLlm },
    { main: config.models.primary, fallback: config.models.fallback, local: config.models.local }
  );

  const graph = buildGraph({ config, llm: mainLlm, tools, classifier, modelRouter });

  return async (prompt: string): Promise<{ artifacts: string[] }> => {
    const result = await graph.invoke({
      messages: [new HumanMessage(prompt)],
    });
    return { artifacts: result.artifacts ?? [] };
  };
}
