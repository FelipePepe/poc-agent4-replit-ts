/**
 * scripts/git_hooks/run_gitleaks.ts
 *
 * Scans the repository for accidentally committed secrets using gitleaks.
 * Degrades gracefully if gitleaks is not installed — prints a warning
 * but does NOT block the commit (controlled degradation during initial setup).
 *
 * Install gitleaks: https://github.com/gitleaks/gitleaks/releases
 *
 * Run via: npx tsx scripts/git_hooks/run_gitleaks.ts
 */

import { execSync, spawnSync } from "child_process";

function isGitleaksAvailable(): boolean {
  try {
    execSync("which gitleaks", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function main(): number {
  if (!isGitleaksAvailable()) {
    console.warn(
      "WARNING: gitleaks not found in PATH — secret scan skipped.\n" +
        "Install it from https://github.com/gitleaks/gitleaks/releases"
    );
    return 0;
  }

  const result = spawnSync(
    "gitleaks",
    ["detect", "--no-banner", "--redact", "--source", "."],
    { stdio: "inherit" }
  );

  return result.status ?? 1;
}

process.exit(main());
