/**
 * tests/test_mcp.test.ts — Fase 7
 *
 * Unit tests for mcp/server.ts + mcp/client.ts using Jest mocks.
 * NO InMemoryTransport — avoids open async handles and hanging Jest workers.
 *
 * Strategy:
 *  - makeMcpServer: Mock McpServer from the SDK to intercept server.tool()
 *    registrations without starting any async transport.
 *  - loadMcpTools:  Use a plain mock Client object with mockResolvedValue
 *    returns — no real MCP connection required.
 *
 * Exit criterion (Fase 7): agent discovers tools from MCP server at runtime
 * without hardcoding them in GraphConfig.
 */

import { vi } from 'vitest';
import { makeMcpServer, type McpToolHandlers } from "../src/mcp/server";
import { loadMcpTools } from "../src/mcp/client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// ---------------------------------------------------------------------------
// McpServer mock — capture server.tool() registrations without async side-effects
// ---------------------------------------------------------------------------

// vi.hoisted ensures these variables are available inside vi.mock() factories
const { mockToolFn, mockConnectFn, mockCloseFn, mockServerInstance } = vi.hoisted(() => {
  const mockToolFn = vi.fn();
  const mockConnectFn = vi.fn().mockResolvedValue(undefined);
  const mockCloseFn = vi.fn().mockResolvedValue(undefined);
  const mockServerInstance = {
    tool: mockToolFn,
    connect: mockConnectFn,
    close: mockCloseFn,
  };
  return { mockToolFn, mockConnectFn, mockCloseFn, mockServerInstance };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () { return mockServerInstance; }),
}));

beforeEach(() => {
  mockToolFn.mockClear();
  mockConnectFn.mockClear();
  mockCloseFn.mockClear();
});

/** Returns the tool names registered via server.tool() after calling makeMcpServer. */
function registeredNames(handlers: McpToolHandlers): string[] {
  makeMcpServer(handlers);
  // tool() signature: tool(name, description, schema, callback)
  return mockToolFn.mock.calls.map((call) => call[0] as string);
}

// ---------------------------------------------------------------------------
// makeMcpServer — tool registration (deny-by-default principle)
// ---------------------------------------------------------------------------

describe("makeMcpServer", () => {
  it("returns an object with a connect method", () => {
    const server = makeMcpServer({});
    expect(typeof server.connect).toBe("function");
  });

  it("registers read_file when readFile handler is provided", () => {
    expect(registeredNames({ readFile: () => "x" })).toContain("read_file");
  });

  it("does NOT register read_file when no handler provided (deny-by-default)", () => {
    expect(registeredNames({})).not.toContain("read_file");
  });

  it("registers write_file when writeFile handler is provided", () => {
    expect(registeredNames({ writeFile: () => undefined })).toContain("write_file");
  });

  it("does NOT register write_file when no handler provided", () => {
    expect(registeredNames({})).not.toContain("write_file");
  });

  it("registers execute_shell when executeShell handler is provided", () => {
    expect(registeredNames({ executeShell: () => "ok" })).toContain("execute_shell");
  });

  it("does NOT register execute_shell when no handler provided", () => {
    expect(registeredNames({})).not.toContain("execute_shell");
  });

  it("always registers search_web regardless of handlers (safe stub)", () => {
    expect(registeredNames({})).toContain("search_web");
  });

  it("registers search_web even when searchWeb handler is explicitly provided", () => {
    expect(registeredNames({ searchWeb: () => "result" })).toContain("search_web");
  });

  it("registers all four tools when all handlers are provided", () => {
    const names = registeredNames({
      readFile: () => "x",
      writeFile: () => undefined,
      executeShell: () => "ok",
      searchWeb: () => "r",
    });
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("execute_shell");
    expect(names).toContain("search_web");
  });

  it("each registered tool call includes a non-empty description string", () => {
    makeMcpServer({ readFile: () => "x" });
    // tool() is called as: tool(name, description, schema, handler)
    const call = mockToolFn.mock.calls.find((c) => c[0] === "read_file");
    expect(call).toBeDefined();
    expect(typeof call![1]).toBe("string");
    expect((call![1] as string).length).toBeGreaterThan(0);
  });

  it("invokes the readFile handler when the read_file tool callback fires", async () => {
    const readFile = vi.fn().mockReturnValue("file content");
    makeMcpServer({ readFile });
    const call = mockToolFn.mock.calls.find((c) => c[0] === "read_file");
    const cb = call![call!.length - 1] as (args: { path: string }) => unknown;
    const result = await cb({ path: "test.py" });
    expect(readFile).toHaveBeenCalledWith("test.py");
    expect(result).toEqual({ content: [{ type: "text", text: "file content" }] });
  });

  it("invokes the writeFile handler when the write_file tool callback fires", async () => {
    const writeFile = vi.fn();
    makeMcpServer({ writeFile });
    const call = mockToolFn.mock.calls.find((c) => c[0] === "write_file");
    const cb = call![call!.length - 1] as (args: { path: string; content: string }) => unknown;
    const result = await cb({ path: "out.py", content: "print('hi')" });
    expect(writeFile).toHaveBeenCalledWith("out.py", "print('hi')");
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("invokes the executeShell handler when the execute_shell tool callback fires", async () => {
    const executeShell = vi.fn().mockReturnValue("output");
    makeMcpServer({ executeShell });
    const call = mockToolFn.mock.calls.find((c) => c[0] === "execute_shell");
    const cb = call![call!.length - 1] as (args: { command: string; args?: string[] }) => unknown;
    const result = await cb({ command: "echo", args: ["hi"] });
    expect(executeShell).toHaveBeenCalledWith("echo", ["hi"]);
    expect(result).toEqual({ content: [{ type: "text", text: "output" }] });
  });

  it("search_web stub returns a string containing the query when no custom handler", async () => {
    makeMcpServer({});
    const call = mockToolFn.mock.calls.find((c) => c[0] === "search_web");
    const cb = call![call!.length - 1] as (args: { query: string }) => unknown;
    const result = await cb({ query: "langraph" });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toMatch(/langraph/i);
  });
});

// ---------------------------------------------------------------------------
// Mock client helper for loadMcpTools tests
// ---------------------------------------------------------------------------

function makeMockClient(toolNames: string[], callText = "result"): Client {
  return {
    listTools: vi.fn().mockResolvedValue({
      tools: toolNames.map((name) => ({ name })),
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: callText }],
    }),
  } as unknown as Client;
}

// ---------------------------------------------------------------------------
// loadMcpTools — dynamic tool discovery (Fase 7 exit criterion)
// ---------------------------------------------------------------------------

describe("loadMcpTools — dynamic discovery (Fase 7 exit criterion)", () => {
  it("returns an object", async () => {
    const tools = await loadMcpTools(makeMockClient([]));
    expect(typeof tools).toBe("object");
  });

  it("includes read_file function when server exposes it", async () => {
    const tools = await loadMcpTools(makeMockClient(["read_file"]));
    expect(typeof tools.read_file).toBe("function");
  });

  it("does NOT include read_file when server does not expose it", async () => {
    const tools = await loadMcpTools(makeMockClient([]));
    expect(tools.read_file).toBeUndefined();
  });

  it("read_file calls callTool with correct args and returns text", async () => {
    const client = makeMockClient(["read_file"], "hello content");
    const tools = await loadMcpTools(client);
    const result = await Promise.resolve(tools.read_file!({ path: "hello.py" }));
    expect(result).toBe("hello content");
    expect(client.callTool).toHaveBeenCalledWith({
      name: "read_file",
      arguments: { path: "hello.py" },
    });
  });

  it("write_file calls callTool with correct path and content args", async () => {
    const client = makeMockClient(["write_file"]);
    const tools = await loadMcpTools(client);
    await Promise.resolve(tools.write_file!({ path: "out.py", content: "print('hi')" }));
    expect(client.callTool).toHaveBeenCalledWith({
      name: "write_file",
      arguments: { path: "out.py", content: "print('hi')" },
    });
  });

  it("execute_shell calls callTool with command and args array", async () => {
    const client = makeMockClient(["execute_shell"], "output");
    const tools = await loadMcpTools(client);
    await Promise.resolve(tools.execute_shell!({ command: "echo", args: ["hello"] }));
    expect(client.callTool).toHaveBeenCalledWith({
      name: "execute_shell",
      arguments: { command: "echo", args: ["hello"] },
    });
  });

  it("search_web calls callTool with query and returns text", async () => {
    const client = makeMockClient(["search_web"], "search results");
    const tools = await loadMcpTools(client);
    const result = await Promise.resolve(tools.search_web!({ query: "langraph" }));
    expect(result).toBe("search results");
    expect(client.callTool).toHaveBeenCalledWith({
      name: "search_web",
      arguments: { query: "langraph" },
    });
  });

  it("returns only tools the server exposes (others remain undefined)", async () => {
    const tools = await loadMcpTools(makeMockClient(["read_file", "search_web"]));
    expect(typeof tools.read_file).toBe("function");
    expect(typeof tools.search_web).toBe("function");
    expect(tools.write_file).toBeUndefined();
    expect(tools.execute_shell).toBeUndefined();
  });

  it("all four tools are mapped when server exposes all of them", async () => {
    const tools = await loadMcpTools(
      makeMockClient(["read_file", "write_file", "execute_shell", "search_web"])
    );
    expect(typeof tools.read_file).toBe("function");
    expect(typeof tools.write_file).toBe("function");
    expect(typeof tools.execute_shell).toBe("function");
    expect(typeof tools.search_web).toBe("function");
  });
});
