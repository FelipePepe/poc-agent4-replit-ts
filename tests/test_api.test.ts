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

  // ── New tests: prompt persistence ────────────────────────────────────────

  it("createTask persists the prompt on the task", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "my prompt" });
    expect(task.prompt).toBe("my prompt");
  });

  it("getTask returns a task with the original prompt", () => {
    const service = new InMemoryTaskService();
    const created = service.createTask({ prompt: "stored prompt" });
    const found = service.getTask(created.taskId);
    expect(found!.prompt).toBe("stored prompt");
  });

  // ── New tests: updateTask ─────────────────────────────────────────────────

  it("updateTask updates the status of a task", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "update me" });
    service.updateTask(task.taskId, { status: "processing" });
    expect(service.getTask(task.taskId)!.status).toBe("processing");
  });

  it("updateTask updates progress", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "progress" });
    service.updateTask(task.taskId, { progress: 50 });
    expect(service.getTask(task.taskId)!.progress).toBe(50);
  });

  it("updateTask updates artifacts", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "artifacts" });
    service.updateTask(task.taskId, { artifacts: ["file1.ts", "file2.ts"] });
    expect(service.getTask(task.taskId)!.artifacts).toEqual(["file1.ts", "file2.ts"]);
  });

  it("updateTask updates result", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "result" });
    service.updateTask(task.taskId, { result: "done!" });
    expect(service.getTask(task.taskId)!.result).toBe("done!");
  });

  it("updateTask with unknown taskId does not throw (no-op)", () => {
    const service = new InMemoryTaskService();
    expect(() => {
      service.updateTask("nonexistent-id", { status: "completed" });
    }).not.toThrow();
  });

  it("updateTask partial patch does not overwrite untouched fields", () => {
    const service = new InMemoryTaskService();
    const task = service.createTask({ prompt: "partial" });
    service.updateTask(task.taskId, { status: "processing" });
    const found = service.getTask(task.taskId)!;
    expect(found.prompt).toBe("partial");
    expect(found.progress).toBe(0);
    expect(found.artifacts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GraphRunner integration
// ---------------------------------------------------------------------------

import type { GraphRunner } from "../src/api/server";

describe("createApp with GraphRunner", () => {
  it("POST /api/agent/tasks with graph runner returns 201 immediately with status 'processing'", async () => {
    const graphRunner: GraphRunner = (_prompt) =>
      new Promise((resolve) => setTimeout(() => resolve({ artifacts: [] }), 5000));

    const service = new InMemoryTaskService();
    const app = createApp(service, graphRunner);

    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "run the graph" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("processing");
  });

  it("graph runner is called with the trimmed prompt", async () => {
    const receivedPrompts: string[] = [];
    const graphRunner: GraphRunner = (prompt) => {
      receivedPrompts.push(prompt);
      return Promise.resolve({ artifacts: [] });
    };

    const service = new InMemoryTaskService();
    const app = createApp(service, graphRunner);

    await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "  hello world  " });

    // Give the background task time to run
    await new Promise((r) => setTimeout(r, 20));

    expect(receivedPrompts).toEqual(["hello world"]);
  });

  it("when graph runner resolves, task becomes 'completed' with artifacts", async () => {
    let resolveRunner!: (val: { artifacts: string[] }) => void;
    const graphRunner: GraphRunner = (_prompt) =>
      new Promise((resolve) => { resolveRunner = resolve; });

    const service = new InMemoryTaskService();
    const app = createApp(service, graphRunner);

    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "complete me" });
    const taskId = res.body.data.taskId as string;

    // Resolve the runner after the HTTP response
    resolveRunner({ artifacts: ["output.py", "README.md"] });
    await new Promise((r) => setTimeout(r, 20));

    const task = service.getTask(taskId)!;
    expect(task.status).toBe("completed");
    expect(task.progress).toBe(100);
    expect(task.artifacts).toEqual(["output.py", "README.md"]);
  });

  it("when graph runner rejects, task becomes 'failed' with error message in result", async () => {
    let rejectRunner!: (err: Error) => void;
    const graphRunner: GraphRunner = (_prompt) =>
      new Promise<{ artifacts: string[] }>((_resolve, reject) => { rejectRunner = reject; });

    const service = new InMemoryTaskService();
    const app = createApp(service, graphRunner);

    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "fail me" });
    const taskId = res.body.data.taskId as string;

    rejectRunner(new Error("graph exploded"));
    await new Promise((r) => setTimeout(r, 20));

    const task = service.getTask(taskId)!;
    expect(task.status).toBe("failed");
    expect(task.result).toBe("graph exploded");
  });

  it("POST without graph runner keeps status 'queued' (backward compat)", async () => {
    const service = new InMemoryTaskService();
    const app = createApp(service); // no graphRunner

    const res = await request(app)
      .post("/api/agent/tasks")
      .send({ prompt: "old behaviour" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("queued");
  });
});
