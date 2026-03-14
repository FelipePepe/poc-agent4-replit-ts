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
 *  - createApp(service?, graphRunner?) is a pure factory: no global state,
 *    fully injectable.
 *  - When graphRunner is provided, POST creates the task in "processing" state
 *    and launches the runner in the background (fire-and-forget). On success
 *    the task transitions to "completed"; on failure to "failed".
 *  - When graphRunner is omitted, POST creates the task in "queued" state
 *    (backward-compatible behaviour).
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
import swaggerUi from "swagger-ui-express";
import { InMemoryTaskService } from "./task_service";

// ---------------------------------------------------------------------------
// GraphRunner — injectable type; keeps server.ts decoupled from graph.ts
// ---------------------------------------------------------------------------

/**
 * GraphRunner
 *
 * A function that receives a prompt string and returns a Promise resolving to
 * the graph execution result.  Keeping this as a plain function type makes it
 * trivially mockable in tests and avoids any coupling to LangGraph internals.
 */
export type GraphRunner = (prompt: string) => Promise<{ artifacts: string[] }>;

// ---------------------------------------------------------------------------
// OpenAPI spec
// ---------------------------------------------------------------------------

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "PoC Agent4 Replit — REST API",
    version: "v1",
    description:
      "REST API for the multi-agent LangGraph system. Submit prompts as tasks and poll for results.",
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        operationId: "health",
        tags: ["System"],
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string", example: "ok" } } },
              },
            },
          },
        },
      },
    },
    "/api/agent/tasks": {
      post: {
        summary: "Create a new agent task",
        operationId: "createTask",
        tags: ["Tasks"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["prompt"],
                properties: {
                  prompt: { type: "string", example: "Write a Python hello-world script" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Task created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskEnvelope" },
              },
            },
          },
          "400": {
            description: "Invalid prompt",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
    "/api/agent/tasks/{taskId}": {
      get: {
        summary: "Get task status",
        operationId: "getTask",
        tags: ["Tasks"],
        parameters: [
          {
            name: "taskId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Task found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskEnvelope" },
              },
            },
          },
          "404": {
            description: "Task not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      TaskDetail: {
        type: "object",
        properties: {
          taskId:    { type: "string", format: "uuid" },
          status:    { type: "string", enum: ["queued", "processing", "completed", "failed"] },
          progress:  { type: "number", minimum: 0, maximum: 100 },
          artifacts: { type: "array", items: { type: "string" } },
          prompt:    { type: "string" },
          result:    { type: "string" },
        },
      },
      TaskEnvelope: {
        type: "object",
        properties: {
          data: { $ref: "#/components/schemas/TaskDetail" },
          meta: { type: "object", properties: { apiVersion: { type: "string", example: "v1" } } },
        },
      },
      ErrorEnvelope: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code:    { type: "string" },
              message: { type: "string" },
            },
          },
          meta: { type: "object", properties: { apiVersion: { type: "string", example: "v1" } } },
        },
      },
    },
  },
};

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
 *
 * @param service      Optional InMemoryTaskService instance (default: new instance).
 * @param graphRunner  Optional GraphRunner for background graph execution.
 *                     When provided, POST creates the task in "processing" state
 *                     and fires the runner asynchronously.
 */
export function createApp(
  service: InMemoryTaskService = new InMemoryTaskService(),
  graphRunner?: GraphRunner
): express.Application {
  const app = express();

  // Parse JSON bodies; no need for larger body-parser config in this PoC.
  app.use(express.json());

  // ---- GET /api-docs (Swagger UI) -----------------------------------------
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

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

    const trimmedPrompt = prompt.trim();

    if (graphRunner) {
      // Create task in "processing" state and run the graph in the background.
      const task = service.createTask({ prompt: trimmedPrompt });
      service.updateTask(task.taskId, { status: "processing" });

      // Fire-and-forget: do NOT await here so the HTTP response returns immediately.
      graphRunner(trimmedPrompt).then(
        (result) => {
          service.updateTask(task.taskId, {
            status: "completed",
            progress: 100,
            artifacts: result.artifacts,
          });
        },
        (err: unknown) => {
          service.updateTask(task.taskId, {
            status: "failed",
            result: err instanceof Error ? err.message : String(err),
          });
        }
      );

      // Return the snapshot taken right after updateTask("processing").
      res.status(201).json(successEnvelope(service.getTask(task.taskId)));
    } else {
      // Legacy behaviour: task stays in "queued".
      const task = service.createTask({ prompt: trimmedPrompt });
      res.status(201).json(successEnvelope(task));
    }
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
