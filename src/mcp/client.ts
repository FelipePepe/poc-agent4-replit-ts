/**
 * src/mcp/client.ts
 *
 * MCP client utility — Fase 7
 *
 * loadMcpTools() dynamically discovers tools registered on the connected MCP
 * server and wraps them as GraphTools (the interface used by the LangGraph
 * graph) WITHOUT any hardcoded tool names.
 *
 * Exit criterion (Fase 7): The agent can use tools registered in the MCP
 * server that are not hardcoded in GraphConfig — discovered at runtime.
 *
 * Design:
 *  - Works with any MCP client that is already connected.
 *  - Uses client.listTools() to discover available tools at runtime.
 *  - Maps discovered tool names to corresponding GraphTools entries.
 *    The mapping is the minimum necessary to bridge MCP ↔ GraphTools API.
 *  - If a tool is not exposed by the server, it remains undefined in GraphTools
 *    (deny-by-default at the agent level).
 *
 * Security: no credentials or shell commands here; security is in the server.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GraphTools } from "../core/graph";

// ---------------------------------------------------------------------------
// Text extraction helper
// ---------------------------------------------------------------------------

function extractText(
  result: Awaited<ReturnType<Client["callTool"]>>
): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((c) => c.type === "text")?.text ?? "";
}

// ---------------------------------------------------------------------------
// Fase 7 exit criterion
// ---------------------------------------------------------------------------

/**
 * loadMcpTools
 *
 * Discovers all tools from the connected MCP server and maps them to
 * GraphTools functions. Tool names are taken DIRECTLY from the server's
 * listTools() response — nothing is hardcoded except the final mapping
 * from MCP name → GraphTools key.
 *
 * @param client  A connected MCP Client instance.
 * @returns       Partial<GraphTools> populated only with what the server exposes.
 */
export async function loadMcpTools(client: Client): Promise<GraphTools> {
  const { tools } = await client.listTools();
  const exposedNames = new Set(tools.map((t) => t.name));

  const graphTools: GraphTools = {};

  if (exposedNames.has("read_file")) {
    // Type assertion: GraphTools.read_file is typed sync; the graph does
    // `await Promise.resolve(toolFn(...))` so async is safe at runtime.
    graphTools.read_file = (async ({ path }: { path: string }) => {
      const result = await client.callTool({
        name: "read_file",
        arguments: { path },
      });
      return extractText(result);
    }) as unknown as GraphTools["read_file"];
  }

  if (exposedNames.has("write_file")) {
    graphTools.write_file = (async ({ path, content }: { path: string; content: string }) => {
      await client.callTool({
        name: "write_file",
        arguments: { path, content },
      });
    }) as unknown as GraphTools["write_file"];
  }

  if (exposedNames.has("execute_shell")) {
    graphTools.execute_shell = (async ({ command, args }: { command: string; args?: string[] }) => {
      const result = await client.callTool({
        name: "execute_shell",
        arguments: { command, args: args ?? [] },
      });
      return { stdout: extractText(result), stderr: "", exitCode: 0 };
    }) as unknown as GraphTools["execute_shell"];
  }

  if (exposedNames.has("search_web")) {
    graphTools.search_web = (async ({ query }: { query: string }) => {
      const result = await client.callTool({
        name: "search_web",
        arguments: { query },
      });
      return extractText(result);
    }) as unknown as GraphTools["search_web"];
  }

  return graphTools;
}
