/**
 * scripts/git_hooks/check_merge_commit.ts
 *
 * Blocks local merge commits on protected branches.
 * Integrations to main/develop must go through GitHub PRs only.
 *
 * Run via: npx tsx scripts/git_hooks/check_merge_commit.ts
 */

import { execSync } from "child_process";

const PROTECTED_BRANCHES = new Set(["main", "develop"]);

function currentBranch(): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    encoding: "utf8",
  }).trim();
}

function headParentCount(): number {
  const result = execSync("git rev-list --parents -n 1 HEAD", {
    encoding: "utf8",
  }).trim();
  // First token is the commit hash; remaining tokens are parent hashes
  return Math.max(result.split(/\s+/).length - 1, 0);
}

function main(): number {
  const branch = currentBranch();
  if (PROTECTED_BRANCHES.has(branch) && headParentCount() > 1) {
    console.error(
      `Merge commits are blocked on protected branch '${branch}'. Use PR flow.`
    );
    return 1;
  }
  return 0;
}

process.exit(main());
