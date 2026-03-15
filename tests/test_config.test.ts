/**
 * tests/test_config.test.ts
 *
 * RED tests for core/config.ts — Fase 0
 * TDD: these tests must fail before src/core/config.ts exists.
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process so tests never call the real `gh auth token`
// vi.hoisted ensures the mock is available when vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(() => "ghp_mock-gh-cli-token\n"),
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

import { loadConfig, getConfig, resetConfig, type Config } from "../src/core/config";

const VALID_ENV = {
  GITHUB_OAUTH_TOKEN: "ghp_test-key",
  LANGSMITH_API_KEY: "ls-test-key",
  LANGSMITH_PROJECT: "test-project",
  NODE_ENV: "test",
  PORT: "4000",
};

describe("loadConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GitHub OAuth token resolution", () => {
    it("uses GITHUB_OAUTH_TOKEN when set", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.githubToken).toBe("ghp_test-key");
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("falls back to `gh auth token` when GITHUB_OAUTH_TOKEN is absent", () => {
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["GITHUB_OAUTH_TOKEN"];
      const cfg = loadConfig(env as NodeJS.ProcessEnv);
      expect(cfg.githubToken).toBe("ghp_mock-gh-cli-token");
      expect(mockExecSync).toHaveBeenCalledWith("gh auth token", expect.any(Object));
    });

    it("falls back to `gh auth token` when GITHUB_OAUTH_TOKEN is empty string", () => {
      const env = { ...VALID_ENV, GITHUB_OAUTH_TOKEN: "" };
      const cfg = loadConfig(env as NodeJS.ProcessEnv);
      expect(cfg.githubToken).toBe("ghp_mock-gh-cli-token");
    });

    it("throws a helpful error when both GITHUB_OAUTH_TOKEN and gh CLI fail", () => {
      mockExecSync.mockImplementationOnce(() => { throw new Error("gh not found"); });
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["GITHUB_OAUTH_TOKEN"];
      expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/gh auth login/);
    });

    it("throws when gh CLI returns empty string", () => {
      mockExecSync.mockReturnValueOnce("   \n");
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["GITHUB_OAUTH_TOKEN"];
      expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/GITHUB_OAUTH_TOKEN/);
    });
  });

  describe("required variables", () => {
    it("throws if LANGSMITH_API_KEY is missing", () => {
      const env = { ...VALID_ENV, LANGSMITH_API_KEY: "" };
      expect(() => loadConfig(env)).toThrow(/LANGSMITH_API_KEY/);
    });
  });

  describe("optional variables use defaults", () => {
    it("defaults PORT to 3000", () => {
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["PORT"];
      const cfg = loadConfig(env as NodeJS.ProcessEnv);
      expect(cfg.port).toBe(3000);
    });

    it("defaults NODE_ENV to development", () => {
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["NODE_ENV"];
      const cfg = loadConfig(env as NodeJS.ProcessEnv);
      expect(cfg.nodeEnv).toBe("development");
    });

    it("defaults LANGSMITH_PROJECT to poc-agent4-ts", () => {
      const env = { ...VALID_ENV };
      delete (env as Record<string, string>)["LANGSMITH_PROJECT"];
      const cfg = loadConfig(env as NodeJS.ProcessEnv);
      expect(cfg.langsmithProject).toBe("poc-agent4-ts");
    });
  });

  describe("type coercion", () => {
    it("parses PORT as a number", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.port).toBe(4000);
      expect(typeof cfg.port).toBe("number");
    });
  });

  describe("model thresholds", () => {
    it("has fallbackThreshold of 3", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.models.fallbackThreshold).toBe(3);
    });

    it("has localThreshold of 6", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.models.localThreshold).toBe(6);
    });

    it("has primary model gpt-4o", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.models.primary).toContain("gpt-4o");
    });
  });

  describe("sandbox config", () => {
    it("has commandTimeoutMs of 10000", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.sandbox.commandTimeoutMs).toBe(10_000);
    });

    it("allowedCommands is a non-empty array", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.sandbox.allowedCommands.length).toBeGreaterThan(0);
    });

    it("sandbox dir ends with agent_sandbox", () => {
      const cfg = loadConfig(VALID_ENV);
      expect(cfg.sandbox.dir).toMatch(/agent_sandbox$/);
    });
  });

  describe("secrets are not exposed", () => {
    it("githubToken is a string on the Config shape", () => {
      const cfg = loadConfig(VALID_ENV) as unknown as Record<string, unknown>;
      expect(typeof cfg["githubToken"]).toBe("string");
    });
  });
});

// ---------------------------------------------------------------------------
// getConfig / resetConfig singleton
// ---------------------------------------------------------------------------

describe("getConfig singleton", () => {
  const SAVED: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    SAVED.GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
    SAVED.LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY;
    SAVED.LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT;
    SAVED.NODE_ENV = process.env.NODE_ENV;
    SAVED.PORT = process.env.PORT;
    process.env.GITHUB_OAUTH_TOKEN = VALID_ENV.GITHUB_OAUTH_TOKEN;
    process.env.LANGSMITH_API_KEY = VALID_ENV.LANGSMITH_API_KEY;
    process.env.LANGSMITH_PROJECT = VALID_ENV.LANGSMITH_PROJECT;
    process.env.NODE_ENV = VALID_ENV.NODE_ENV;
    process.env.PORT = VALID_ENV.PORT;
    resetConfig();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    resetConfig();
  });

  it("returns a Config instance from process.env", () => {
    const cfg = getConfig();
    expect(cfg).toBeDefined();
    expect(cfg.githubToken).toBe(VALID_ENV.GITHUB_OAUTH_TOKEN);
  });

  it("caches the instance — returns same object on second call", () => {
    const first = getConfig();
    const second = getConfig();
    expect(first).toBe(second);
  });

  it("resetConfig clears the cache so next getConfig reloads", () => {
    const first = getConfig();
    resetConfig();
    process.env.PORT = "9999";
    const second = getConfig();
    expect(first).not.toBe(second);
    expect(second.port).toBe(9999);
  });

  it("resetConfig does not throw when cache is already null", () => {
    resetConfig();
    expect(() => resetConfig()).not.toThrow();
  });
});

// Type-level check
const _typeCheck: Config = loadConfig(VALID_ENV);
void _typeCheck;
