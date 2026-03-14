# PoC Agent4 Replit — TypeScript Port

A **learning PoC** that replicates the architecture of Replit Agent 4: a multi-agent system with LangGraph orchestration, implemented in TypeScript running on Node.js.

The original spec is in the sibling Python project (`poc-agent4-prompt-v2.md`). This port follows the same phase order and exit criteria, adapted to the TypeScript/Node.js ecosystem.

---

## Architecture

```
GET  /api-docs/           ← Swagger UI (OpenAPI 3.0)
POST /api/agent/tasks
GET  /api/agent/tasks/:id
GET  /health
       │
       ▼
  createApp()  ─── InMemoryTaskService
       │
       ▼
  buildGraph()
       │
  ┌────▼────────────────────────────────────┐
  │  supervisor (ReAct loop)                │
  │     │  tool_calls → tool_executor ──┐   │
  │     │                               │   │
  │     │  2+ pending subtasks          │   │
  │     └──► parallel_executor ─────────┘   │
  │             │  resolve conflicts         │
  │     ◄───────┘                           │
  │     │  otherwise                        │
  │     └──► verifier ──► END              │
  └─────────────────────────────────────────┘
        │           │             │
   SnapshotEngine  Classifier   ModelRouter
   (git + SQLite)  (rule-based)  (Sonnet→Haiku→local)
```

### Key Modules

| Path | Responsibility |
|---|---|
| `src/core/graph.ts` | LangGraph topology, GraphConfig, GraphTools |
| `src/core/state.ts` | AgentStateAnnotation — 12 typed fields |
| `src/core/config.ts` | Factory for Config from env vars |
| `src/core/db.ts` | SQLite WAL singleton |
| `src/core/tools.ts` | Sandboxed read_file, write_file, execute_shell (allowlist) |
| `src/core/models.ts` | ModelRouter: Sonnet→Haiku→Ollama/phi3-mini |
| `src/agents/supervisor.ts` | Orchestrator, classifier injection, model routing |
| `src/agents/planner.ts` | Task decomposition into Subtask[] |
| `src/agents/editor.ts` | Code generation / file modification |
| `src/agents/verifier.ts` | Test execution and result validation |
| `src/agents/searcher.ts` | Documentation search |
| `src/agents/parallel_executor.ts` | Promise.all fan-out over pending subtasks |
| `src/agents/conflict_resolver.ts` | Last-writer-wins merge of parallel results |
| `src/guidance/classifier.ts` | TrajectoryClassifier — ephemeral micro-instructions |
| `src/snapshots/engine.ts` | SnapshotEngine: git commit + SQLite metadata |
| `src/mcp/server.ts` | MCP tool server with deny-by-default registration |
| `src/mcp/client.ts` | loadMcpTools() — dynamic tool discovery at runtime |
| `src/api/server.ts` | Express REST API (createApp factory) + OpenAPI 3.0 spec |
| `src/api/task_service.ts` | InMemoryTaskService |
| `src/api/index.ts` | Entry point — boots Express on `PORT` (default 3000) |

---

## Phase Delivery Order

```
Fase 0 → Fase 1 → Fase 2 → Fase 6 → Fase 3 → Fase 4 → Fase 5 → Fase 7 → Fase 8
```

| Phase | What it adds |
|---|---|
| **0** | AgentState, Config, SQLite WAL, minimal graph wiring |
| **1** | Sandboxed tools + ReAct (supervisor ↔ tool_executor loop) |
| **2** | PlannerAgent, EditorAgent, VerifierAgent, SearcherAgent |
| **6** | SnapshotEngine — `git commit + SQLite` roundtrip |
| **3** | ParallelExecutorNode + ConflictResolver |
| **4** | TrajectoryClassifier — ephemeral guidance injection |
| **5** | ModelRouter — automatic doom-loop prevention |
| **7** | MCP server + loadMcpTools() dynamic discovery |
| **8** | REST API demo surface |

---

## Setup

```bash
node --version   # must be >= 20.x (tested on 25.7.0)
npm install      # also installs git hooks via husky (pre-commit, commit-msg, pre-merge-commit)

# Optional: local classifier model
ollama pull phi3-mini

# Environment
cp .env.example .env        # set ANTHROPIC_API_KEY, LANGSMITH_API_KEY
```

> **Git hooks installed automatically** by `npm install` via husky `prepare` script.
> Hooks enforce: Conventional Commits, Gitleaks secret scanning, protected-branch policy, lint-staged.

---

## Usage

```bash
# Run tests (strict TDD: 273 tests, 100% line coverage)
npm test

# Run tests in watch mode
npm run test:watch

# Type-check only (no emit)
npm run typecheck

# Lint
npm run lint

# Start the REST API in dev mode (tsx, live reload)
npm run dev

# Build to dist/ and start compiled output
npm run build
npm start
```

### REST API

```bash
# Swagger UI (interactive docs)
open http://localhost:3000/api-docs/

# Health check
curl http://localhost:3000/health

# Create a task
curl -X POST http://localhost:3000/api/agent/tasks \
     -H 'Content-Type: application/json' \
     -d '{"prompt": "create a Flask CRUD API with tests"}'

# Get task status
curl http://localhost:3000/api/agent/tasks/<taskId>
```

---

## Git Workflow

Este proyecto sigue **GitFlow estricto**. Ver [`docs/git-workflow.md`](docs/git-workflow.md) para la referencia completa.

```
feature/* ──► develop ──► release/* ──► main (tag vX.Y.Z)
                                   └──► develop (back-merge)
```

- `main` y `develop` están protegidas — **no hay commits directos**.
- Toda integración es vía PR en GitHub.
- Flujo de release: `release/vX.Y.Z` desde `develop` → PR a `main` → tag → back-merge a `develop`.

---

## Security Design

- **Deny-by-default**: all tool handlers must be explicitly provided; unknown shell commands are rejected at `tools.ts`.
- **Sandbox isolation**: agent file/shell operations restricted to `workspace/agent_sandbox/`.
- **Secret management**: API keys in `.env`, never committed (`.gitignore`).
- **Input validation**: prompt trimmed and length-checked before reaching service.
- **Error sanitisation**: HTTP errors return `{ error: { code, message } }` without internal stack traces.
- **RBAC / least privilege**: no admin surface; credentials backend-only.

---

## Key Architectural Differences vs. Replit Agent 4

| Dimension | This PoC | Replit Agent 4 (assumed) |
|---|---|---|
| Orchestration | LangGraph.js StateGraph | Custom streaming orchestrator |
| Classifier | Rule-based (zero latency) | LLM-based (phi3-mini Ollama in spec) |
| Persistence | SQLite WAL (in-process) | Distributed task store |
| Parallelism | Promise.all per subtask batch | Separate microservices |
| Model switching | Threshold-based (errors≥3/6) | Adaptive with LangSmith traces |
| Tool transport | MCP SDK (InMemoryTransport in tests) | Native IDE integration |
| Sandbox | Path-escape checks + command allowlist | Container-level isolation |

### What we simplified (and why)

1. **Rule-based classifier over phi3-mini**: removes infra dependency and 3–8s latency per step. Sufficient for the doom-loop prevention goal of the PoC.
2. **SQLite over PostgreSQL**: simpler setup, WAL mode provides adequate concurrent-write performance for a single-process agent.
3. **In-memory task store**: no persistence across restarts; acceptable for a learning PoC.
4. **No streaming**: LangGraph `invoke()` rather than `stream()`; adequate for batch task demonstration.
5. **No real LangSmith traces**: LangSmith client is configured but not wired per-step; observatory out of scope for PoC phases.

---

## Test Coverage

```
273 tests | 16 suites | 100% lines | ~93% branches
```

All suites use strict TDD (red → green → refactor). No test file may be merged without first failing on a missing implementation.

---

## Post-Mortem Notes

**What worked well:**
- Strict TDD from day one — every new file was driven by failing tests.
- Injectable factories (`buildGraph`, `createApp`, `makeTools`) made mocking trivial.
- LangGraph's typed StateAnnotation prevented many state-mutation bugs at compile time.
- The `registerTool()` bypass for `TS2589` (MCP SDK type depth) was necessary and well-documented.

**What was harder than expected:**
- `ts-jest` + MCP's `ZodRawShapeCompat` (dual zod v3/v4 union) caused 140s compile times.
- `InMemoryTransport` keeps Node.js event-loop alive — test mocking was the correct solution.
- LangGraph.js Annotation API changed between 0.1.x and 0.2.x; `.initialValueFactory()` vs `.default()` caused early confusion.

**What remains (not in PoC scope):**
- Real LangSmith trace wiring
- phi3-mini Ollama classifier integration
- Actual graph invocation from the REST API (task execution)
- Docker / container sandbox isolation
