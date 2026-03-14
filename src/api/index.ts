/**
 * src/api/index.ts — Entry point for the REST API server.
 *
 * Reads PORT from environment (default 3000) and starts the Express app.
 * No secrets are logged; errors are caught and reported without stack traces.
 */

import { createApp } from "./server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = createApp();

app.listen(PORT, () => {
   
  console.log(`[api] Server listening on http://localhost:${PORT}`);
});
