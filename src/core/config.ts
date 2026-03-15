/**
 * core/config.ts
 *
 * Centralised configuration loaded from environment variables.
 *
 * Security rules:
 * - Secrets are validated at call time; a missing required var throws.
 * - Values are never logged or serialised by this module.
 * - No plaintext secrets in code; use .env (gitignored).
 * - loadConfig() is a pure function — injectable in tests.
 * - The exported `config` singleton lazy-loads from process.env on
 *   first access so tests can set env vars before importing.
 *
 * GitHub OAuth token resolution order:
 *   1. GITHUB_OAUTH_TOKEN env var (set by OAuth callback in multi-user mode)
 *   2. `gh auth token` CLI (local dev — requires `gh auth login`)
 *   3. Throws with a helpful message if neither is available.
 */

import path from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface Config {
  readonly githubToken: string;
  readonly langsmithApiKey: string;
  readonly langsmithProject: string;
  readonly nodeEnv: string;
  readonly port: number;
  readonly dbPath: string;
  readonly models: {
    readonly primary: string;
    readonly fallback: string;
    readonly fallbackThreshold: number;
    readonly localThreshold: number;
    readonly local: string;
  };
  readonly sandbox: {
    readonly dir: string;
    readonly commandTimeoutMs: number;
    readonly allowedCommands: readonly string[];
  };
  readonly maxIterations: number;
}

// ---------------------------------------------------------------------------
// Pure factory — use this in tests
// ---------------------------------------------------------------------------

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const githubToken = resolveGithubToken(env);
  const langsmithApiKey = requireVar(env, "LANGSMITH_API_KEY");

  return {
    githubToken,
    langsmithApiKey,
    langsmithProject: optionalVar(env, "LANGSMITH_PROJECT", "poc-agent4-ts"),
    nodeEnv: optionalVar(env, "NODE_ENV", "development"),
    port: parseInt(optionalVar(env, "PORT", "3000"), 10),
    dbPath: optionalVar(
      env,
      "DB_PATH",
      path.resolve(process.cwd(), "workspace", "agent4.db")
    ),
    models: {
      primary: "gpt-4o",
      fallback: "gpt-4o-mini",
      fallbackThreshold: 3,
      localThreshold: 6,
      local: "phi3-mini",
    },
    sandbox: {
      dir: path.resolve(process.cwd(), "workspace", "agent_sandbox"),
      commandTimeoutMs: 10_000,
      allowedCommands: [
        "ls",
        "cat",
        "echo",
        "python",
        "python3",
        "node",
        "npm",
        "npx",
        "tsc",
        "jest",
        "pytest",
        "pip",
        "pip3",
      ],
    },
    maxIterations: 10,
  };
}

// ---------------------------------------------------------------------------
// Singleton — lazy, so tests can override process.env before first use
// ---------------------------------------------------------------------------

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig(process.env);
  }
  return _config;
}

/** Reset singleton — for tests that need to reload config. */
export function resetConfig(): void {
  _config = null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * resolveGithubToken
 *
 * Resolution order:
 *  1. GITHUB_OAUTH_TOKEN env var — used in multi-user / CI / OAuth callback flows.
 *  2. `gh auth token` — used in local dev after `gh auth login`.
 *
 * Throws a descriptive error if neither source provides a token.
 */
function resolveGithubToken(env: NodeJS.ProcessEnv): string {
  const fromEnv = env["GITHUB_OAUTH_TOKEN"];
  if (fromEnv) return fromEnv;

  try {
    const token = execSync("gh auth token", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (token) return token;
  } catch {
    // gh not installed or not logged in — fall through to error
  }

  throw new Error(
    "GitHub OAuth token not found.\n" +
    "  Local dev:  run `gh auth login` then retry.\n" +
    "  Production: set the GITHUB_OAUTH_TOKEN environment variable."
  );
}

function requireVar(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalVar(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string
): string {
  return env[key] ?? fallback;
}
