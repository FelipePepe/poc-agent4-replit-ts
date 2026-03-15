/**
 * tests/test_state.test.ts
 *
 * RED tests for core/state.ts — Fase 0
 * TDD: these tests must fail before src/core/state.ts exists.
 */

import { AgentStateAnnotation, type AgentState } from "../src/core/state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("AgentStateAnnotation", () => {
  describe("default values via initialValueFactory()", () => {
    it("messages defaults to empty array", () => {
       
      const val = (AgentStateAnnotation.spec.messages as any).initialValueFactory() as unknown[];
      expect(val).toEqual([]);
    });

    it("tool_calls defaults to empty array", () => {
       
      const val = (AgentStateAnnotation.spec.tool_calls as any).initialValueFactory() as unknown[];
      expect(val).toEqual([]);
    });

    it("error_count defaults to 0", () => {
       
      const val = (AgentStateAnnotation.spec.error_count as any).initialValueFactory() as number;
      expect(val).toBe(0);
    });

    it("consecutive_errors defaults to 0", () => {
       
      const val = (AgentStateAnnotation.spec.consecutive_errors as any).initialValueFactory() as number;
      expect(val).toBe(0);
    });

    it("model_switches defaults to 0", () => {
       
      const val = (AgentStateAnnotation.spec.model_switches as any).initialValueFactory() as number;
      expect(val).toBe(0);
    });

    it("current_model defaults to gpt-4o", () => {

      const val = (AgentStateAnnotation.spec.current_model as any).initialValueFactory() as string;
      expect(val).toBe("gpt-4o");
    });

    it("task_id defaults to empty string", () => {
       
      const val = (AgentStateAnnotation.spec.task_id as any).initialValueFactory() as string;
      expect(val).toBe("");
    });

    it("active_agent defaults to supervisor", () => {
       
      const val = (AgentStateAnnotation.spec.active_agent as any).initialValueFactory() as string;
      expect(val).toBe("supervisor");
    });

    it("subtasks defaults to empty array", () => {
       
      const val = (AgentStateAnnotation.spec.subtasks as any).initialValueFactory() as unknown[];
      expect(val).toEqual([]);
    });

    it("parallel_results defaults to empty object", () => {
       
      const val = (AgentStateAnnotation.spec.parallel_results as any).initialValueFactory() as object;
      expect(val).toEqual({});
    });

    it("active_instructions defaults to empty array", () => {
       
      const val = (AgentStateAnnotation.spec.active_instructions as any).initialValueFactory() as unknown[];
      expect(val).toEqual([]);
    });

    it("snapshot_id defaults to null", () => {
       
      const val = (AgentStateAnnotation.spec.snapshot_id as any).initialValueFactory() as null;
      expect(val).toBeNull();
    });
  });

  describe("messages reducer accumulates messages via operator()", () => {
    it("appends new messages to existing messages", () => {
      const existing = [new HumanMessage("hello")];
      const incoming = [new AIMessage("world")];
       
      const reduced = (AgentStateAnnotation.spec.messages as any).operator(
        existing,
        incoming
      ) as unknown[];
      expect(reduced).toHaveLength(2);
    });
  });

  describe("replace reducers — operator() replaces with next value", () => {
    const REPLACE_FIELDS = [
      "tool_calls",
      "error_count",
      "current_model",
      "task_id",
      "subtasks",
      "active_agent",
      "active_instructions",
      "consecutive_errors",
      "model_switches",
      "snapshot_id",
    ] as const;

    for (const field of REPLACE_FIELDS) {
      it(`${field}: operator(prev, next) returns next`, () => {
         
        const ch = AgentStateAnnotation.spec[field] as any;
        const prev = "prev" as unknown;
        const next = "next" as unknown;
         
        expect(ch.operator(prev, next)).toBe(next);
      });
    }
  });

  describe("parallel_results reducer merges objects via operator()", () => {
    it("merges new keys into existing results", () => {
      const prev = { a: 1 };
      const next = { b: 2 };
       
      const merged = (AgentStateAnnotation.spec.parallel_results as any).operator(
        prev,
        next
      ) as Record<string, unknown>;
      expect(merged).toEqual({ a: 1, b: 2 });
    });

    it("overwrites existing key on conflict", () => {
      const prev = { a: 1 };
      const next = { a: 99 };
       
      const merged = (AgentStateAnnotation.spec.parallel_results as any).operator(
        prev,
        next
      ) as Record<string, unknown>;
      expect(merged).toEqual({ a: 99 });
    });
  });

  describe("AgentState type — all 12 fields from the spec", () => {
    it("spec has all required fields", () => {
      const fields = Object.keys(AgentStateAnnotation.spec);
      const required = [
        "messages",
        "tool_calls",
        "error_count",
        "current_model",
        "task_id",
        "subtasks",
        "active_agent",
        "parallel_results",
        "active_instructions",
        "consecutive_errors",
        "model_switches",
        "snapshot_id",
      ];
      for (const field of required) {
        expect(fields).toContain(field);
      }
    });
  });
});

// Type-level check — if AgentState is typed correctly, this compiles
const _typeCheck: AgentState = {
  messages: [],
  tool_calls: [],
  error_count: 0,
  current_model: "gpt-4o",
  task_id: "",
  subtasks: [],
  active_agent: "supervisor",
  parallel_results: {},
  active_instructions: [],
  consecutive_errors: 0,
  model_switches: 0,
  snapshot_id: null,
};
void _typeCheck;
