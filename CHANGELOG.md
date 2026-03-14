# Changelog

## [1.1.1] — 2026-03-14

### Added
- Pre-push hook: SonarQube analysis launched in background on every push (non-blocking)
- Skips gracefully if `SONAR_TOKEN_POC_AGENT4_TS` is not set

## [1.1.0] — 2026-03-14

### Added
- Real LangGraph execution wired from REST API via injectable `GraphRunner`
- `POST /api/agent/tasks` now returns `"processing"` immediately and runs the graph in background
- On success: task transitions to `"completed"` with `artifacts`; on failure: `"failed"` with error message
- `InMemoryTaskService`: persists prompt, new `updateTask()` for partial patches
- 13 new tests — 286 total

## [1.0.1] — 2026-03-14

### Changed
- Migrated test runner from Jest/ts-jest to Vitest + @vitest/coverage-v8
- Added SonarQube integration: `sonar-project.properties`, `scripts/run_sonar.sh`, `npm run sonar`
- JUnit XML report for SonarQube via Vitest built-in junit reporter

## [1.0.0] — 2026-03-14

### Added
- **Fase 0** — AgentState, Config, SQLite WAL, minimal LangGraph graph
- **Fase 1** — Sandboxed tools (read_file, write_file, execute_shell, search_web) + ReAct loop
- **Fase 2** — PlannerAgent, EditorAgent, VerifierAgent, SearcherAgent
- **Fase 3** — ParallelExecutorNode + ConflictResolver (Promise.all fan-out)
- **Fase 4** — TrajectoryClassifier with ephemeral micro-instruction injection
- **Fase 5** — ModelRouter: automatic doom-loop prevention (Sonnet → Haiku → Ollama/phi3-mini)
- **Fase 6** — SnapshotEngine: git commit + SQLite metadata roundtrip
- **Fase 7** — MCP server + loadMcpTools() dynamic tool discovery
- **Fase 8** — REST API (Express) + Swagger UI at `/api-docs/`
- GitFlow documentation (`docs/git-workflow.md`)
- 273 tests, 100% line coverage, ~93% branch coverage
- Husky hooks: Conventional Commits, Gitleaks, protected-branch policy, lint-staged
