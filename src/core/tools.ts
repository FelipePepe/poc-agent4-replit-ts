/**
 * core/tools.ts
 *
 * Sandboxed agent tools — Fase 1.
 *
 * Security rules:
 * - All file operations are confined to sandboxDir (deny-by-default).
 * - Shell execution uses an explicit allowlist + hard timeout.
 * - Path traversal attempts throw PathEscapeError.
 * - Unlisted commands throw CommandNotAllowedError.
 * - Process timeout throws ShellTimeoutError.
 *
 * makeTools() is a pure factory — injectable in tests.
 * execFileSync is accessed via the module object to allow jest.spyOn.
 */

import path from "path";
import fs from "fs";
import * as childProcess from "child_process";

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class PathEscapeError extends Error {
  constructor(attemptedPath: string, sandboxDir: string) {
    super(
      `Path "${attemptedPath}" attempts to escape sandbox "${sandboxDir}"`
    );
    this.name = "PathEscapeError";
  }
}

export class CommandNotAllowedError extends Error {
  constructor(command: string) {
    super(
      `Command "${command}" is not in the allowed commands list`
    );
    this.name = "CommandNotAllowedError";
  }
}

export class ShellTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(
      `Command "${command}" exceeded the ${timeoutMs}ms timeout`
    );
    this.name = "ShellTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ToolsConfig {
  sandboxDir: string;
  allowedCommands: readonly string[];
  commandTimeoutMs: number;
  /** Injected for testing — defaults to child_process.execFileSync. */
  _execFileSync?: typeof childProcess.execFileSync;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolves relPath inside sandboxDir and verifies it cannot escape.
 * Throws PathEscapeError if the resolved absolute path is outside the sandbox.
 */
function resolveSandboxPath(relPath: string, sandboxDir: string): string {
  const normalized = path.resolve(sandboxDir);
  const absolute = path.resolve(normalized, relPath);

  // Path must start with sandboxDir + sep, or equal sandboxDir exactly
  if (
    !absolute.startsWith(normalized + path.sep) &&
    absolute !== normalized
  ) {
    throw new PathEscapeError(relPath, sandboxDir);
  }

  return absolute;
}

// ---------------------------------------------------------------------------
// Tools factory
// ---------------------------------------------------------------------------

/**
 * Creates a set of sandboxed agent tools bound to the provided config.
 * All file operations are scoped to sandboxDir.
 * Shell execution is restricted to allowedCommands with commandTimeoutMs.
 */
export function makeTools(config: ToolsConfig) {
  const { sandboxDir, allowedCommands, commandTimeoutMs } = config;
  const execFileSyncFn = config._execFileSync ?? childProcess.execFileSync;

  /**
   * Reads a file relative to the sandbox directory.
   * Throws PathEscapeError if path escapes the sandbox.
   */
  function readFile(relPath: string): string {
    const abs = resolveSandboxPath(relPath, sandboxDir);
    return fs.readFileSync(abs, "utf-8");
  }

  /**
   * Writes content to a file relative to the sandbox directory.
   * Creates parent directories as needed.
   * Throws PathEscapeError if path escapes the sandbox.
   */
  function writeFile(relPath: string, content: string): void {
    const abs = resolveSandboxPath(relPath, sandboxDir);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  /**
   * Executes an allowlisted shell command inside the sandbox directory.
   * Throws CommandNotAllowedError if command is not in allowedCommands.
   * Throws ShellTimeoutError if the process exceeds commandTimeoutMs.
   * Returns { stdout, stderr, exitCode } — never throws on non-zero exit.
   */
  function executeShell(command: string, args: string[] = []): ShellResult {
    if (!allowedCommands.includes(command)) {
      throw new CommandNotAllowedError(command);
    }

    try {
      const stdout = execFileSyncFn(command, args, {
        timeout: commandTimeoutMs,
        encoding: "utf-8",
        cwd: sandboxDir,
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        status?: number;
      };

      if (e.code === "ETIMEDOUT") {
        throw new ShellTimeoutError(command, commandTimeoutMs);
      }

      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        exitCode: e.status ?? 1,
      };
    }
  }

  /**
   * Searches the web for the given query.
   * Fase 1 stub — returns a placeholder result.
   * Will be replaced with a real implementation in future phases.
   */
  function searchWeb(query: string): string {
    return `[Search stub — query: ${query}]`;
  }

  return { readFile, writeFile, executeShell, searchWeb };
}
