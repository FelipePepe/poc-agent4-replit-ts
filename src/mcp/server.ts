/**
 * src/mcp/server.ts
 *
 * MCP server for the agent sandbox — Fase 7
 *
 * Exposes sandbox tools (read_file, write_file, execute_shell, search_web)
 * as MCP tools that can be discovered and invoked by an MCP client.
 *
 * Design:
 *  - Tool handlers are injected via McpToolHandlers, keeping the server
 *    pure and fully testable without real filesystem/shell access.
 *  - Tools are registered ONLY when the corresponding handler is provided
 *    (opt-in), so clients can dynamically discover what's available.
 *  - search_web is always registered (it's a stub with no side effects).
 *
 * Security notes:
 *  - No handler = no tool exposed: defense-in-depth deny-by-default.
 *  - Actual sandbox restrictions (path escape, command allowlist, timeouts)
 *    are enforced at the handler level (tools.ts), not here.
 *  - Input validation for tool arguments is performed by the Zod schemas.
 *
 * Note on TS2589: McpServer.tool() uses ZodRawShapeCompat which expands to
 * `Record<string, z3.ZodTypeAny | z4.$ZodType>`, causing TypeScript to exceed
 * its type-instantiation depth when resolving overloads. registerTool() below
 * bypasses this via `as unknown` without sacrificing runtime safety.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolHandlers {
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  executeShell?: (command: string, args?: string[]) => string;
  searchWeb?: (query: string) => string;
}

/** Minimal shape of a registered-tool callback result. */
type ToolResult = { content: Array<{ type: string; text: string }> };

/**
 * registerTool
 *
 * Wraps server.tool() with `as unknown` to prevent TS2589 that arises from
 * McpServer's ZodRawShapeCompat → z3.ZodTypeAny | z4.$ZodType union causing
 * infinite type-instantiation depth in TypeScript 5.x.
 *
 * This is a known SDK-level issue; runtime behavior is identical.
 */
function registerTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Record<string, unknown>,
  cb: (args: Record<string, unknown>) => Promise<ToolResult>,
): void {
  (server as unknown as {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      cb: (args: Record<string, unknown>) => Promise<ToolResult>,
    ) => void;
  }).tool(name, description, schema, cb);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * makeMcpServer
 *
 * Creates and configures an McpServer with sandbox tools.
 * Each tool is registered only when its handler is present in `handlers`.
 * search_web is always registered (no external dependency).
 *
 * @param handlers  Injectable tool implementations.
 */
export function makeMcpServer(handlers: McpToolHandlers): McpServer {
  const server = new McpServer({
    name: "agent-sandbox",
    version: "0.1.0",
  });

  // ---- read_file ----------------------------------------------------------
  if (handlers.readFile) {
    const readFn = handlers.readFile;
    registerTool(server, "read_file", "Read a file from the agent sandbox",
      { path: z.string() },
      async ({ path }) => ({
        content: [{ type: "text", text: readFn(path as string) }],
      })
    );
  }

  // ---- write_file ---------------------------------------------------------
  if (handlers.writeFile) {
    const writeFn = handlers.writeFile;
    registerTool(server, "write_file", "Write a file to the agent sandbox",
      { path: z.string(), content: z.string() },
      async ({ path, content }) => {
        writeFn(path as string, content as string);
        return { content: [{ type: "text", text: "ok" }] };
      }
    );
  }

  // ---- execute_shell ------------------------------------------------------
  if (handlers.executeShell) {
    const shellFn = handlers.executeShell;
    registerTool(
      server,
      "execute_shell",
      "Execute an allowlisted shell command in the agent sandbox",
      { command: z.string(), args: z.array(z.string()).optional() },
      async ({ command, args }) => ({
        content: [{ type: "text", text: shellFn(command as string, args as string[] | undefined) }],
      })
    );
  }

  // ---- search_web (always available — stub) --------------------------------
  const webFn =
    handlers.searchWeb ?? ((query: string) => `[Search stub — query: ${query}]`);
  registerTool(server, "search_web", "Search the web for information",
    { query: z.string() },
    async ({ query }) => ({
      content: [{ type: "text", text: webFn(query as string) }],
    })
  );

  return server;
}
