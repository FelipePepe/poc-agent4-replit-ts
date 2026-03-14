/**
 * tests/test_api.test.ts — Fase 8
 *
 * RED tests for src/api/server.ts + src/api/task_service.ts
 * TDD: these tests must fail before the implementation exists.
 *
 * REST API endpoints:
 *  GET  /health                    → 200 { status: "ok" }
 *  POST /api/agent/tasks           → 201 { data: { taskId, status }, meta }
 *  GET  /api/agent/tasks/:taskId   → 200 { data: TaskDetail, meta }
 *                                  → 404 { error: { code, message }, meta } if not found
 *
 * Exit criterion (Fase 8): all phases wired through a REST surface that
 * accepts task prompts and returns task state.
 */

import request from "supertest";
import { createApp } from "../src/api/server";
import { InMemoryTaskService } from "../src/api/task_service";

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  const app = createApp();

  it("returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/agent/tasks
// ---------------------------------------------------------------------------

describe("POST /api/agent/tasks", () => {
  const app = createApp();

  it("returns 201 on valid prompt", async () => {
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "build me a thing" });
    expect(res.status).toBe(201);
  });

  it("response body has data.taskId string", async () => {
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "hello" });
    expect(typeof res.body.data.taskId).toBe("string");
    expect(res.body.data.taskId.length).toBeGreaterThan(0);
  });

  it("response body has data.status = 'queued'", async () => {
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "some task" });
    expect(res.body.data.status).toBe("queued");
  });

  it("response body has meta.apiVersion = 'v1'", async () => {
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "test" });
    expect(res.body.meta.apiVersion).toBe("v1");
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await request(app).post("/api/agent/tasks").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is an empty string", async () => {
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "" });
    expect(res.status).toBe(400);
  });

  it("400 response has error.code", async () => {
    const res = await request(app).post("/api/agent/tasks").send({});
    expect(typeof res.body.error.code).toBe("string");
  });

  it("400 response has error.message", async () => {
    const res = await request(app).post("/api/agent/tasks").send({});
    expect(typeof res.body.error.message).toBe("string");
  });

  it("sequential creates return distinct taskIds", async () => {
    const r1 = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "first" });
    const r2 = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "second" });
    expect(r1.body.data.taskId).not.toBe(r2.body.data.taskId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/agent/tasks/:taskId
// ---------------------------------------------------------------------------

describe("GET /api/agent/tasks/:taskId", () => {
  it("returns 200 and task data for existing task", async () => {
    const app = createApp();
    const create = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "find me" });
    const taskId = create.body.data.taskId as string;

    const res = await request(app).get(`/api/agent/tasks/${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.taskId).toBe(taskId);
  });

  it("returned data has status field", async () => {
    const app = createApp();
    const create = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "check status" });
    const taskId = create.body.data.taskId as string;

    const res = await request(app).get(`/api/agent/tasks/${taskId}`);
    expect(typeof res.body.data.status).toBe("string");
  });

  it("returns 404 for unknown taskId", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/tasks/nonexistent-xyz");
    expect(res.status).toBe(404);
  });

  it("404 response has error.code = 'TASK_NOT_FOUND'", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/tasks/nonexistent-abc");
    expect(res.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("404 response has meta.apiVersion = 'v1'", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/tasks/nonexistent-def");
    expect(res.body.meta.apiVersion).toBe("v1");
  });

  it("returned task data has details fields (progress, artifacts)", async () => {
    const app = createApp();
    const create = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "full detail" });
    const taskId = create.body.data.taskId as string;

    const res = await request(app).get(`/api/agent/tasks/${taskId}`);
    expect(typeof res.body.data.progress).toBe("number");
    expect(Array.isArray(res.body.data.artifacts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InMemoryTaskService unit tests
// ---------------------------------------------------------------------------

describe("InMemoryTaskService", () => {
  it("createTask returns a task with a taskId", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "hello" });
    expect(typeof task.taskId).toBe("string");
    expect(task.taskId.length).toBeGreaterThan(0);
  });

  it("createTask returns status = 'queued'", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "test" });
    expect(task.status).toBe("queued");
  });

  it("createTask generates unique IDs", () => {
    const service = new InMemoryTaskService();
    const ids = new Set(
      Array.from({ length: 10 }, () => service.createTask({ prompt: "x" }).taskId)
    );
    expect(ids.size).toBe(10);
  });

  it("getTask returns the task after it was created", () => {
    const service = new InMemoryTaskService();
    const created = service.createTask({ prompt: "find me" });
    const found = service.getTask(created.taskId);
    expect(found).not.toBeNull();
    expect(found!.taskId).toBe(created.taskId);
  });

  it("getTask returns null for unknown id", () => {
    const service = new InMemoryTaskService();
    expect(service.getTask("unknown-id")).toBeNull();
  });

  it("task has progress = 0 by default", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "check" });
    expect(task.progress).toBe(0);
  });

  it("task has artifacts = [] by default", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "check" });
    expect(task.artifacts).toEqual([]);
  });

  it("accepts an injected service in createApp", async () => {
    const service = new InMemoryTaskService();
    const app = createApp(service);
    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "injected" });
    expect(res.status).toBe(201);
    // The task should also be retrievable from the injected service
    const taskId = res.body.data.taskId as string;
    expect(service.getTask(taskId)).not.toBeNull();
  });
});
