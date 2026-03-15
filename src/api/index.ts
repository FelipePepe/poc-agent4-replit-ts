/**
 * src/api/index.ts — Entry point for the REST API server.
 *
 * Reads PORT from environment (default 3000) and starts the Express app.
 * Wires the real LangGraph graph runner if GITHUB_TOKEN is available.
 * If env vars are missing, the server starts without a graph runner and
 * tasks will remain in "queued" state (safe degraded mode).
 */

import { createApp } from "./server";
import { createGraphRunner } from "./graph_runner";
import { getConfig } from "../core/config";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

let graphRunner;
try {
  const config = getConfig();
  graphRunner = createGraphRunner(config);
  console.log("[api] Graph runner initialized — tasks will be executed by LangGraph.");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[api] Graph runner not available (${message}). Tasks will stay in 'queued' state.`);
}

const app = createApp(undefined, graphRunner);

app.listen(PORT, () => {
  console.log(`[api] Server listening on http://localhost:${PORT}`);
  console.log(`[api] Swagger UI at http://localhost:${PORT}/api-docs/`);
});
