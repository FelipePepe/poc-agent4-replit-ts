/**
 * src/core/tracing.ts
 *
 * LangSmith tracing setup and traceable wrapper.
 *
 * Design:
 *  - setupLangSmith() configures the LangChain auto-tracing env vars.
 *    LangGraph invocations are then traced automatically — no per-step
 *    instrumentation needed; LangChain/LangGraph handle the propagation.
 *  - wrapWithTrace() wraps any async function with langsmith/traceable
 *    so top-level runner calls appear as named root spans in LangSmith.
 *  - Both are no-ops when langsmithApiKey is empty (safe in test / CI).
 *
 * Security: API key is read from Config, never logged.
 */

import { traceable } from "langsmith/traceable";
import type { Config } from "./config";

/**
 * setupLangSmith
 *
 * Sets the three env vars that activate LangChain's automatic tracing:
 *  - LANGCHAIN_TRACING_V2=true   → enables the v2 tracing pipeline
 *  - LANGCHAIN_API_KEY           → authenticates with LangSmith
 *  - LANGCHAIN_PROJECT           → groups traces under the project name
 *
 * Skips silently when config.langsmithApiKey is empty (e.g. in tests).
 */
export function setupLangSmith(config: Config): void {
  if (!config.langsmithApiKey) return;

  process.env.LANGCHAIN_TRACING_V2 = "true";
  process.env.LANGCHAIN_API_KEY = config.langsmithApiKey;
  process.env.LANGCHAIN_PROJECT = config.langsmithProject;
}

/**
 * wrapWithTrace
 *
 * Wraps an async function with langsmith/traceable so it appears as a
 * named root span in LangSmith, capturing inputs, outputs, and latency.
 *
 * @param fn    The async function to wrap.
 * @param name  The span name shown in LangSmith UI.
 */
export function wrapWithTrace<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  name: string
): T {
  return traceable(fn, { name }) as T;
}
