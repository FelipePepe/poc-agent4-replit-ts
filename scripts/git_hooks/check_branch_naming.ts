/**
 * scripts/git_hooks/check_branch_naming.ts
 *
 * Validates that the current branch name follows the GitFlow convention.
 *
 * Allowed patterns:
 *   main, develop,
 *   feature/*, bugfix/*, chore/*, docs/*, refactor/*,
 *   release/*, hotfix/*, spike/*
 *
 * Run via: npx tsx scripts/git_hooks/check_branch_naming.ts
 */

import { execSync } from "child_process";

const ALLOWED_PATTERNS = [
  /^main$/,
  /^develop$/,
  /^feature\/[a-z0-9._-]+$/,
  /^bugfix\/[a-z0-9._-]+$/,
  /^chore\/[a-z0-9._-]+$/,
  /^docs\/[a-z0-9._-]+$/,
  /^refactor\/[a-z0-9._-]+$/,
  /^release\/[a-z0-9._-]+$/,
  /^hotfix\/[a-z0-9._-]+$/,
  /^spike\/[a-z0-9._-]+$/,
];

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
    return null;
  }
}

function main(): number {
  if (!hasCommits()) return 0;
  const branch = currentBranch();
  if (branch === null) return 0;
  if (ALLOWED_PATTERNS.some((pattern) => pattern.test(branch))) return 0;
  console.error(
    "Invalid branch name. Use one of: main, develop, feature/*, bugfix/*, " +
      "chore/*, docs/*, refactor/*, release/*, hotfix/*, spike/*."
  );
  return 1;
}

process.exit(main());
