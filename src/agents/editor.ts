/**
 * agents/editor.ts
 *
 * EditorAgent — Fase 2.
 *
 * Finds the first pending "code" subtask and generates the implementation.
 * Calls the LLM to produce a file path + content, then writes the file
 * to the sandbox via the write_file tool.
 *
 * Security: All file writes go through GraphTools which enforces sandbox.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentState, Subtask } from "../core/state";
import type { GraphTools } from "../core/graph";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const EDITOR_SYSTEM_PROMPT = `You are an expert programmer. Implement the requested code.

Return ONLY valid JSON with two fields — no explanation, no markdown fences:
{"path":"relative/filename.ext","content":"full file content here"}

The path must be relative (no leading /). The content must be production-quality code.`;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface CodeOutput {
  path: string;
  content: string;
}

/**
 * Strips optional markdown fences from LLM output and parses as CodeOutput.
 * Returns null if parsing fails.
 */
function parseCodeOutput(raw: string): CodeOutput | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "path" in parsed &&
      "content" in parsed
    ) {
      return parsed as CodeOutput;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Finds the first pending subtask with type "code".
 */
function findPendingCodeTask(subtasks: Subtask[]): Subtask | undefined {
  return subtasks.find((s) => s.type === "code" && s.status === "pending");
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

/**
 * Creates an EditorAgent node that writes code files for pending code subtasks.
 */
export function makeEditorNode(llm: BaseChatModel, tools: GraphTools) {
  return async function editorNode(
    state: AgentState
  ): Promise<Partial<AgentState>> {
    const target = findPendingCodeTask(state.subtasks);

    if (!target) {
      return {};
    }

    try {
      const taskMessage = new SystemMessage(
        `Task: ${target.description}\n\n${EDITOR_SYSTEM_PROMPT}`
      );

      const response = await llm.invoke([taskMessage, ...state.messages]);
      const content =
        typeof response.content === "string" ? response.content : "";
      const code = parseCodeOutput(content) ?? {
        path: "output.py",
        content,
      };

      tools.write_file?.({ path: code.path, content: code.content });

      const updatedSubtasks = state.subtasks.map((s) =>
        s.id === target.id
          ? { ...s, status: "done" as const, result: code.path }
          : s
      );

      return {
        subtasks: updatedSubtasks,
        active_agent: "editor",
      };
    } catch {
      return {
        active_agent: "editor",
        error_count: state.error_count + 1,
        consecutive_errors: state.consecutive_errors + 1,
      };
    }
  };
}
