/**
 * src/api/server.ts — Fase 8
 *
 * Express REST API for the PoC Agent4 system.
 *
 * Endpoints:
 *  GET  /health                  → 200 { status: "ok" }
 *  POST /api/agent/tasks         → 201 { data: TaskDetail, meta }
 *  GET  /api/agent/tasks/:taskId → 200 { data: TaskDetail, meta }
 *                                → 404 { error: { code, message }, meta }
 *
 * Design:
 *  - createApp(service?) is a pure factory: no global state, fully injectable.
 *  - All inputs are validated before reaching the service layer (OWASP A03).
 *  - Error responses follow a consistent envelope: { error, meta }.
 *  - No secrets or credentials handled here: principle of least privilege.
 *
 * Security notes:
 *  - express.json() limits body parsing to application/json.
 *  - prompt validation rejects missing and empty strings.
 *  - Error messages do not leak internal stack traces or path information.
 */

import express, { type Request, type Response } from "express";
import { InMemoryTaskService } from "./task_service";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const META = { apiVersion: "v1" } as const;

function successEnvelope<T>(data: T) {
  return { data, meta: META };
}

function errorEnvelope(code: string, message: string) {
  return { error: { code, message }, meta: META };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * createApp
 *
 * Creates and configures the Express application.
 * An optional `service` can be injected for testing.
 *
 * @param service  Optional InMemoryTaskService instance (default: new instance).
 */
export function createApp(
  service: InMemoryTaskService = new InMemoryTaskService()
): express.Application {
  const app = express();

  // Parse JSON bodies; no need for larger body-parser config in this PoC.
  app.use(express.json());

  // ---- GET /health --------------------------------------------------------
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // ---- POST /api/agent/tasks ----------------------------------------------
  app.post("/api/agent/tasks", (req: Request, res: Response) => {
    const { prompt } = req.body as { prompt?: unknown };

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res
        .status(400)
        .json(errorEnvelope("INVALID_PROMPT", "prompt must be a non-empty string"));
      return;
    }

    const task = service.createTask({ prompt: prompt.trim() });
    res.status(201).json(successEnvelope(task));
  });

  // ---- GET /api/agent/tasks/:taskId ---------------------------------------
  app.get("/api/agent/tasks/:taskId", (req: Request, res: Response) => {
    const { taskId } = req.params;
    const task = service.getTask(taskId);

    if (!task) {
      res
        .status(404)
        .json(errorEnvelope("TASK_NOT_FOUND", "Task not found"));
      return;
    }

    res.json(successEnvelope(task));
  });

  return app;
}
