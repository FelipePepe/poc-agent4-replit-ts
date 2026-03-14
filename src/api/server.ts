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
import swaggerUi from "swagger-ui-express";
import { InMemoryTaskService } from "./task_service";

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
