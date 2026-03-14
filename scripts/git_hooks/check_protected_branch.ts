/**
 * scripts/git_hooks/check_protected_branch.ts
 *
 * Blocks direct commits on protected branches (main, develop).
 * Allow unborn HEAD (first commit in a new repo).
 *
 * Run via: npx tsx scripts/git_hooks/check_protected_branch.ts
 */

import { execSync } from "child_process";

const PROTECTED_BRANCHES = new Set(["main", "develop"]);

function hasCommits(): boolean {
  try {
    execSync("git rev-parse --verify HEAD", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function currentBranch(): string | null {
  try {
    const result = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf8",
    });
    return result.trim();
  } catch {
    // Detached HEAD
    return null;
  }
}

function main(): number {
  if (!hasCommits()) return 0;
  const branch = currentBranch();
  if (branch === null) return 0;
  if (PROTECTED_BRANCHES.has(branch)) {
    console.error(
      `Direct commits are blocked on protected branch '${branch}'. Use a PR.`
    );
    return 1;
  }
  return 0;
}

process.exit(main());
