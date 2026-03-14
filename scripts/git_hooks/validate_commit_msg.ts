/**
 * scripts/git_hooks/validate_commit_msg.ts
 *
 * Validates the commit message against Conventional Commits format:
 *   <type>[(<scope>)][!]: <description>
 *
 * Accepted types: feat, fix, docs, style, refactor, test, chore,
 *                 build, ci, perf, revert
 *
 * Usage (from commit-msg hook): npx tsx scripts/git_hooks/validate_commit_msg.ts "$1"
 */

import { readFileSync } from "fs";

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([a-z0-9._/-]+\))?!?: .+/;

function main(): number {
  const msgFile = process.argv[2];
  if (!msgFile) {
    console.error("Usage: validate_commit_msg.ts <commit-msg-file>");
    return 1;
  }

  const firstLine = readFileSync(msgFile, "utf8").split("\n")[0].trim();

  if (CONVENTIONAL_COMMIT_RE.test(firstLine)) return 0;

  console.error(
    "Invalid commit message. Use Conventional Commits, e.g. " +
      "'feat(core): add task state machine'."
  );
  return 1;
}

process.exit(main());
