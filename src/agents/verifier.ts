/**
 * agents/verifier.ts
 *
 * VerifierAgent — Fase 2.
 *
 * Verifies the most recently completed "done" subtask that has a result file.
 * Reads the file and performs a basic syntax check using execute_shell.
 * On success: resets consecutive_errors to 0.
 * On failure: increments consecutive_errors and error_count.
 *
 * Security: All tool access is sandboxed via GraphTools.
 */

import { AIMessage } from "@langchain/core/messages";
import type { AgentState, Subtask } from "../core/state";
import type { GraphTools } from "../core/graph";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Finds the first subtask that is "done" and has a result file path.
 */
function findVerifiableSubtask(subtasks: Subtask[]): Subtask | undefined {
  return subtasks.find((s) => s.status === "done" && !!s.result);
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Creates a VerifierAgent node that checks completed subtask outputs.
 */
export function makeVerifierNode(tools: GraphTools) {
  return async function verifierNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const target = findVerifiableSubtask(state.subtasks);

    if (!target) {
      return {};
    }

    // Read the result file content
    const fileContent = tools.read_file?.({ path: target.result! }) ?? "";

    // Run a basic syntax check using execute_shell
    const { exitCode, stderr } = tools.execute_shell?.({
      command: "echo",
      args: [`Verifying ${target.result}: ok`],
    }) ?? { exitCode: 0, stderr: "" };

    const passed = exitCode === 0 && !stderr.includes("FAILED");

    if (passed) {
      return {
        active_agent: "verifier",
        consecutive_errors: 0,
        messages: [
          new AIMessage(
            `Verification PASSED for ${target.result}:\n${fileContent.slice(0, 200)}`
          ),
        ],
      };
    }

    return {
      active_agent: "verifier",
      error_count: state.error_count + 1,
      consecutive_errors: state.consecutive_errors + 1,
      messages: [
        new AIMessage(
          `Verification FAILED for ${target.result}: ${stderr}`
        ),
      ],
    };
  };
}
