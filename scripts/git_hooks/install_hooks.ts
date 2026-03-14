/**
 * scripts/git_hooks/install_hooks.ts
 *
 * Installs git hooks for this project using husky.
 *
 * Usage:
 *   npx tsx scripts/git_hooks/install_hooks.ts
 *
 * Husky hooks live in .husky/ and are committed to the repository.
 * Running this script (or `npm run prepare`) registers them with git.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";

const HOOKS_DIR = ".husky";

function writeHook(name: string, content: string): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  const hookPath = join(HOOKS_DIR, name);
  writeFileSync(hookPath, `#!/usr/bin/env sh\n${content}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  console.log(`  ✔ ${hookPath}`);
}

function main(): number {
  console.log("Installing husky hooks...");

  // Register hooks with git via husky
  execSync("npx husky", { stdio: "inherit" });

  // pre-commit: branch policy + branch naming + secret scan + lint-staged
  if (!existsSync(join(HOOKS_DIR, "pre-commit"))) {
    writeHook(
      "pre-commit",
      [
        "npx tsx scripts/git_hooks/check_protected_branch.ts",
        "npx tsx scripts/git_hooks/check_branch_naming.ts",
        "npx tsx scripts/git_hooks/run_gitleaks.ts",
        "npx lint-staged",
      ].join("\n")
    );
  }

  // commit-msg: Conventional Commits validation
  if (!existsSync(join(HOOKS_DIR, "commit-msg"))) {
    writeHook(
      "commit-msg",
      'npx tsx scripts/git_hooks/validate_commit_msg.ts "$1"'
    );
  }

  // pre-merge-commit: block local merges on protected branches
  if (!existsSync(join(HOOKS_DIR, "pre-merge-commit"))) {
    writeHook(
      "pre-merge-commit",
      "npx tsx scripts/git_hooks/check_merge_commit.ts"
    );
  }

  console.log("Done. Git hooks installed successfully.");
  return 0;
}

process.exit(main());
