/**
 * scripts/git_hooks/run_sonar.ts
 *
 * Launches SonarQube analysis in the background after a push.
 * Non-blocking by design — the push must never be held up by the scanner.
 *
 * Skips gracefully if:
 *  - SONAR_TOKEN_POC_AGENT4_TS is not set in the environment.
 *  - sonar-scanner (npx) is not available.
 *
 * Output is written to .sonar_analysis.log in the project root.
 *
 * Run via: npx tsx scripts/git_hooks/run_sonar.ts
 */

import { spawn } from "child_process";
import { openSync } from "fs";
import { resolve } from "path";

const LOG_FILE = resolve(process.cwd(), ".sonar_analysis.log");
const TOKEN_ENV = "SONAR_TOKEN_POC_AGENT4_TS";

function main(): number {
  const token = process.env[TOKEN_ENV];

  if (!token) {
    console.error(
      `[sonar] ${TOKEN_ENV} not set — skipping SonarQube analysis.\n` +
      `  To enable: export ${TOKEN_ENV}=<token> in your shell profile.`
    );
    return 0; // non-blocking: push must succeed regardless
  }

  const logFd = openSync(LOG_FILE, "w");

  const child = spawn(
    "npx",
    ["sonar-scanner", `-Dsonar.token=${token}`],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, [TOKEN_ENV]: token },
    }
  );

  child.unref(); // detach from parent process so push is not blocked

  console.error(
    `[sonar] SonarQube analysis launched in the background.\n` +
    `  Follow progress: tail -f ${LOG_FILE}`
  );

  return 0; // always exit 0 — non-blocking by design
}

process.exit(main());
