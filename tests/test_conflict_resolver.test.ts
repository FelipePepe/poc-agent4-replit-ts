/**
 * tests/test_conflict_resolver.test.ts
 *
 * RED tests for agents/conflict_resolver.ts — Fase 3
 * TDD: these must fail before the implementation exists.
 */

import { resolveConflicts, type ConflictResult } from "../src/agents/conflict_resolver";

describe("resolveConflicts", () => {
  it("returns hasConflict false and empty conflictingKeys for non-overlapping results", () => {
    const result: ConflictResult = resolveConflicts([
      { "file-a.py": "content-a" },
      { "file-b.py": "content-b" },
    ]);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictingKeys).toEqual([]);
  });

  it("returns hasConflict true when two results share a key", () => {
    const result = resolveConflicts([
      { "app.py": "version-1" },
      { "app.py": "version-2" },
    ]);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingKeys).toContain("app.py");
  });

  it("reports each conflicting key only once", () => {
    const result = resolveConflicts([
      { "x.py": "a" },
      { "x.py": "b" },
      { "x.py": "c" },
    ]);
    const dup = result.conflictingKeys.filter((k) => k === "x.py");
    expect(dup.length).toBe(1);
  });

  it("resolves conflicts with last-writer-wins strategy", () => {
    const result = resolveConflicts([
      { "app.py": "first" },
      { "app.py": "second" },
      { "app.py": "third" },
    ]);
    expect(result.resolved["app.py"]).toBe("third");
  });

  it("merges non-conflicting keys from all results", () => {
    const result = resolveConflicts([
      { "a.py": "alpha" },
      { "b.py": "beta" },
      { "c.py": "gamma" },
    ]);
    expect(result.resolved["a.py"]).toBe("alpha");
    expect(result.resolved["b.py"]).toBe("beta");
    expect(result.resolved["c.py"]).toBe("gamma");
  });

  it("handles an empty input array gracefully", () => {
    const result = resolveConflicts([]);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictingKeys).toEqual([]);
    expect(result.resolved).toEqual({});
  });

  it("handles a single result without conflicts", () => {
    const result = resolveConflicts([{ "only.py": "solo" }]);
    expect(result.hasConflict).toBe(false);
    expect(result.resolved["only.py"]).toBe("solo");
  });

  it("detects multiple distinct conflicting keys", () => {
    const result = resolveConflicts([
      { "a.py": "v1", "b.py": "v1" },
      { "a.py": "v2", "b.py": "v2" },
    ]);
    expect(result.conflictingKeys).toContain("a.py");
    expect(result.conflictingKeys).toContain("b.py");
    expect(result.conflictingKeys.length).toBe(2);
  });
});
