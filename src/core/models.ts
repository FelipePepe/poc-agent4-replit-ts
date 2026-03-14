/**
 * src/core/models.ts
 *
 * Model switching logic — Fase 5 Anti-Doom-Loop
 *
 * Escalation strategy:
 *   consecutive_errors < 3   → main model    (Claude Sonnet)
 *   consecutive_errors 3–5   → fallback model (Claude Haiku)
 *   consecutive_errors >= 6  → local model    (Ollama phi3-mini)
 *
 * Auto-return: when consecutive_errors drops back to 0, the main model is
 * selected again — no explicit reset required.
 *
 * Design:
 *  - selectModelName() is a pure function — no state, no LLM creation.
 *  - makeModelRouter() wraps a static map of pre-created LLM instances and
 *    provides selectFor() + detectSwitch() helpers used by the supervisor.
 *  - Both are fully injectable and testable without real API calls.
 *
 * Security: no credentials handled here; LLM instances are injected by callers.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum consecutive errors to switch from main to fallback model. */
export const FALLBACK_THRESHOLD = 3;

/** Minimum consecutive errors to switch from fallback to local model. */
export const LOCAL_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelNames {
  main: string;
  fallback: string;
  local: string;
}

export interface ModelThresholds {
  fallback: number;
  local: number;
}

export interface ModelMap {
  main: BaseChatModel;
  fallback: BaseChatModel;
  local: BaseChatModel;
}

// ---------------------------------------------------------------------------
// Pure selection function
// ---------------------------------------------------------------------------

/**
 * selectModelName
 *
 * Returns the appropriate model name string based on the current error count.
 * Pure function — no side effects.
 */
export function selectModelName(
  consecutiveErrors: number,
  fallbackThreshold: number,
  localThreshold: number,
  names: ModelNames
): string {
  if (consecutiveErrors >= localThreshold) return names.local;
  if (consecutiveErrors >= fallbackThreshold) return names.fallback;
  return names.main;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * makeModelRouter
 *
 * Wraps a map of pre-created LLM instances and exposes:
 *  - selectFor(consecutiveErrors):   returns the appropriate BaseChatModel
 *  - detectSwitch(currentModel, consecutiveErrors):
 *      returns the new model name if a switch is needed, null if unchanged
 */
export function makeModelRouter(
  thresholds: ModelThresholds,
  models: ModelMap,
  names: ModelNames
) {
  function selectFor(consecutiveErrors: number): BaseChatModel {
    if (consecutiveErrors >= thresholds.local) return models.local;
    if (consecutiveErrors >= thresholds.fallback) return models.fallback;
    return models.main;
  }

  /**
   * Returns the new model name when a transition occurs, null otherwise.
   * Used by the supervisor to log switches and increment model_switches.
   */
  function detectSwitch(
    currentModelName: string,
    consecutiveErrors: number
  ): string | null {
    const targetName = selectModelName(
      consecutiveErrors,
      thresholds.fallback,
      thresholds.local,
      names
    );
    return targetName !== currentModelName ? targetName : null;
  }

  return { selectFor, detectSwitch };
}
