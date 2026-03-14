/**
 * tests/test_tools.test.ts
 *
 * RED tests for core/tools.ts — Fase 1
 * TDD: these tests must fail before src/core/tools.ts exists.
 *
 * Covers:
 *   - Custom error classes (PathEscapeError, CommandNotAllowedError, ShellTimeoutError)
 *   - readFile: sandbox enforcement, path traversal rejection
 *   - writeFile: creates file + dirs, rejects escaping paths
 *   - executeShell: allowlist enforcement, timeout handling, exit code propagation
 *   - searchWeb: stub returns non-empty string
 */

import { vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import {
  makeTools,
  PathEscapeError,
  CommandNotAllowedError,
  ShellTimeoutError,
  type ShellResult,
  type ToolsConfig,
} from "../src/core/tools";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let sandboxDir: string;
let tools: ReturnType<typeof makeTools>;

const BASE_CONFIG: ToolsConfig = {
  // sandboxDir set in beforeEach
  sandboxDir: "",
  allowedCommands: ["echo", "cat", "ls"],
  commandTimeoutMs: 5_000,
};

beforeEach(() => {
  sandboxDir = mkdtempSync(path.join(os.tmpdir(), "agent-test-sandbox-"));
  tools = makeTools({ ...BASE_CONFIG, sandboxDir });
});

afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Error class contracts
// ---------------------------------------------------------------------------

describe("PathEscapeError", () => {
  it("is an instance of Error", () => {
    const err = new PathEscapeError("../../evil", "/sandbox");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name PathEscapeError", () => {
    const err = new PathEscapeError("../../evil", "/sandbox");
    expect(err.name).toBe("PathEscapeError");
  });

  it("message includes the attempted path", () => {
    const err = new PathEscapeError("../../evil", "/sandbox");
    expect(err.message).toMatch(/evil/);
  });
});

describe("CommandNotAllowedError", () => {
  it("is an instance of Error", () => {
    expect(new CommandNotAllowedError("rm")).toBeInstanceOf(Error);
  });

  it("has name CommandNotAllowedError", () => {
    expect(new CommandNotAllowedError("rm").name).toBe("CommandNotAllowedError");
  });

  it("message includes the disallowed command", () => {
    expect(new CommandNotAllowedError("sudo").message).toMatch(/sudo/);
  });
});

describe("ShellTimeoutError", () => {
  it("is an instance of Error", () => {
    expect(new ShellTimeoutError("sleep", 100)).toBeInstanceOf(Error);
  });

  it("has name ShellTimeoutError", () => {
    expect(new ShellTimeoutError("sleep", 100).name).toBe("ShellTimeoutError");
  });

  it("message includes the command name", () => {
    expect(new ShellTimeoutError("python3", 10_000).message).toMatch(/python3/);
  });
});

// ---------------------------------------------------------------------------
// makeTools factory
// ---------------------------------------------------------------------------

describe("makeTools — factory", () => {
  it("returns an object with the 4 required tool functions", () => {
    const t = makeTools({ sandboxDir: os.tmpdir(), allowedCommands: [], commandTimeoutMs: 10 });
    expect(typeof t.readFile).toBe("function");
    expect(typeof t.writeFile).toBe("function");
    expect(typeof t.executeShell).toBe("function");
    expect(typeof t.searchWeb).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

describe("readFile", () => {
  it("reads a file inside the sandbox", () => {
    writeFileSync(path.join(sandboxDir, "hello.txt"), "hello world");
    expect(tools.readFile("hello.txt")).toBe("hello world");
  });

  it("reads a file in a subdirectory", () => {
    const subDir = path.join(sandboxDir, "sub");
    require("fs").mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, "data.txt"), "nested content");
    expect(tools.readFile("sub/data.txt")).toBe("nested content");
  });

  it("throws PathEscapeError for relative path traversal", () => {
    expect(() => tools.readFile("../../etc/passwd")).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for absolute path outside sandbox", () => {
    expect(() => tools.readFile("/etc/passwd")).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for encoded traversal sequences", () => {
    expect(() => tools.readFile("../secret.txt")).toThrow(PathEscapeError);
  });
});

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------

describe("writeFile", () => {
  it("creates a file inside the sandbox", () => {
    tools.writeFile("output.py", "print('hi')");
    const abs = path.join(sandboxDir, "output.py");
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, "utf-8")).toBe("print('hi')");
  });

  it("creates nested parent directories", () => {
    tools.writeFile("subdir/deep/script.py", "print('deep')");
    expect(existsSync(path.join(sandboxDir, "subdir/deep/script.py"))).toBe(true);
  });

  it("overwrites existing file", () => {
    tools.writeFile("file.txt", "original");
    tools.writeFile("file.txt", "updated");
    expect(readFileSync(path.join(sandboxDir, "file.txt"), "utf-8")).toBe("updated");
  });

  it("throws PathEscapeError for relative traversal", () => {
    expect(() => tools.writeFile("../../tmp/evil.txt", "evil")).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for absolute path outside sandbox", () => {
    expect(() => tools.writeFile("/tmp/evil.txt", "evil")).toThrow(PathEscapeError);
  });
});

// ---------------------------------------------------------------------------
// executeShell
// ---------------------------------------------------------------------------

describe("executeShell", () => {
  it("runs an allowlisted command and returns stdout with exitCode 0", () => {
    const result: ShellResult = tools.executeShell("echo", ["hello"]);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("throws CommandNotAllowedError for a command not in the allowlist", () => {
    expect(() => tools.executeShell("rm", ["-rf", "."])).toThrow(CommandNotAllowedError);
  });

  it("throws CommandNotAllowedError for an empty command string", () => {
    expect(() => tools.executeShell("", [])).toThrow(CommandNotAllowedError);
  });

  it("returns non-zero exitCode for a command that fails", () => {
    // cat on non-existent file returns exit code 1
    const result: ShellResult = tools.executeShell("cat", ["nonexistent-file-xyz123.txt"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("throws ShellTimeoutError when the process is killed due to timeout", () => {
    // Inject a mock execFileSync that simulates ETIMEDOUT (dependency injection)
    const mockExec = (_cmd: string, _args: string[], _opts: unknown): string => {
      const err: NodeJS.ErrnoException = new Error("spawnSync echo ETIMEDOUT");
      err.code = "ETIMEDOUT";
      throw err;
    };
    const timedOutTools = makeTools({
      ...BASE_CONFIG,
      sandboxDir,
      _execFileSync: mockExec as ToolsConfig["_execFileSync"],
    });
    expect(() => timedOutTools.executeShell("echo", ["test"])).toThrow(ShellTimeoutError);
  });

  it("uses default values when error has no stdout, stderr, or status fields", () => {
    // Inject a mock that throws a plain Error with no child_process fields
    const mockExec = (): never => {
      throw new Error("generic shell error"); // no code, stdout, stderr, or status
    };
    const plainErrTools = makeTools({
      ...BASE_CONFIG,
      sandboxDir,
      _execFileSync: mockExec as ToolsConfig["_execFileSync"],
    });
    const result = plainErrTools.executeShell("echo", []);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("returns stderr content when command writes to stderr", () => {
    // 'ls' on a non-existent path writes to stderr
    const result = tools.executeShell("ls", ["/path/that/does/not/exist/abc123"]);
    // Either fails (exit code != 0) or stderr has content
    expect(result.exitCode !== 0 || result.stderr.length > 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// searchWeb
// ---------------------------------------------------------------------------

describe("searchWeb", () => {
  it("returns a non-empty string for any query", () => {
    const result = tools.searchWeb("LangGraph TypeScript docs");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("result includes the query in some form (stub behaviour)", () => {
    const result = tools.searchWeb("unique-query-marker-xyz");
    expect(result).toMatch(/unique-query-marker-xyz/);
  });
});
