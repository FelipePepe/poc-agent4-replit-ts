/**
 * src/agents/conflict_resolver.ts
 *
 * ConflictResolver — Fase 3
 *
 * Detects and resolves write conflicts between parallel agent results.
 * A conflict occurs when two or more workers produce a result for the
 * same key (e.g., two agents writing to the same file path).
 *
 * Resolution strategy: last-writer-wins (Object.assign order).
 * This is appropriate for a PoC where correctness > advanced merging.
 *
 * Security notes:
 *  - Pure function — no I/O, no side effects.
 *  - Input validation: handles empty arrays and single-item arrays safely.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConflictResult {
  /** True if any key appears in more than one input result. */
  hasConflict: boolean;
  /** Deduplicated list of keys that appeared in multiple results. */
  conflictingKeys: string[];
  /** Merged output using last-writer-wins strategy. */
  resolved: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * resolveConflicts
 *
 * Merges an array of result maps, detecting overlapping keys.
 *
 * @param results  Array of Record<string, unknown> — one entry per parallel worker.
 * @returns        ConflictResult with conflict info and merged resolved map.
 */
export function resolveConflicts(
  results: Record<string, unknown>[]
): ConflictResult {
  if (results.length === 0) {
    return { hasConflict: false, conflictingKeys: [], resolved: {} };
  }

  const seen = new Set<string>();
  const conflictsSet = new Set<string>();

  for (const result of results) {
    for (const key of Object.keys(result)) {
      if (seen.has(key)) {
        conflictsSet.add(key);
      } else {
        seen.add(key);
      }
    }
  }

  // Last-writer-wins merge
  const resolved = Object.assign({}, ...results) as Record<string, unknown>;

  return {
    hasConflict: conflictsSet.size > 0,
    conflictingKeys: [...conflictsSet],
    resolved,
  };
}
