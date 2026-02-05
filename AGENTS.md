# OVERSEER PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-01  
**Commit:** 829fb09  
**JJ Change:** mptvnovo

**Overseer** (`os`) - Codemode MCP server for agent task management. SQLite-backed, native VCS (jj-lib + gix). JJ-first.

## ARCHITECTURE

```
+-------------------------------------------------------------+
|                     Overseer (Node MCP)                     |
|  - Single "execute" tool (codemode pattern)                 |
|  - VM sandbox with tasks/learnings APIs                     |
|  - Spawns CLI, parses JSON                                  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                      os (Rust CLI)                          |
|  - All business logic                                       |
|  - SQLite storage                                           |
|  - Native VCS: jj-lib (jj) + gix (git)                      |
|  - JSON output mode for MCP                                 |
+-------------------------------------------------------------+
```

## STRUCTURE

```
overseer/
├── overseer/                # Rust CLI package (binary: os)
│   └── src/
│       ├── main.rs          # Entry (clap CLI)
│       ├── commands/        # Subcommand handlers
│       ├── core/            # TaskService, WorkflowService, context
│       ├── db/              # SQLite repos
│       └── vcs/             # jj-lib + gix backends
│
├── mcp/                     # Node MCP wrapper
│   └── src/
│       ├── index.ts         # Entry (stdio transport)
│       ├── server.ts        # execute tool registration
│       ├── executor.ts      # VM sandbox, CLI bridge
│       └── api/             # tasks/learnings APIs
│
├── npm/                     # Publishing (platform-specific binaries)
│   ├── overseer/            # Main package (routing wrapper)
│   └── scripts/             # Platform package generation
│
├── skills/                  # Agent skills (skills.sh compatible)
│   ├── overseer/            # Task management skill
│   └── overseer-plan/       # Plan-to-task conversion skill
│
├── ui/                      # Task Viewer webapp (Hono + Vite + React)
│   └── src/
│       ├── api/             # Hono API server
│       ├── client/          # React SPA
│       └── types.ts         # Shared types
│
└── docs/                    # Reference documentation
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add CLI command | `overseer/src/commands/` | Add in mod.rs, wire in main.rs |
| Add MCP API | `mcp/src/api/` | Export in api/index.ts |
| Task CRUD | `overseer/src/db/task_repo.rs` | SQL layer |
| Task business logic | `overseer/src/core/task_service.rs` | Validation, hierarchy (1407 lines) |
| Task workflow (start/complete) | `overseer/src/core/workflow_service.rs` | VCS integration (816 lines) |
| VCS operations | `overseer/src/vcs/` | jj.rs (primary), git.rs (fallback) |
| Error types | `overseer/src/error.rs` | OsError enum |
| Types/IDs | `overseer/src/types.rs`, `overseer/src/id.rs` | Domain types, ULID |
| UI API routes | `ui/src/api/routes/` | Hono route handlers |
| UI components | `ui/src/client/components/` | React components |
| UI queries | `ui/src/client/lib/queries.ts` | TanStack Query hooks |
| UI theme | `ui/src/client/styles/global.css` | Tailwind v4 CSS tokens |

## KEY DECISIONS

| Decision | Choice | Why |
|----------|--------|-----|
| CLI binary | `os` | Short, memorable |
| Storage | SQLite | Concurrent access, queries |
| VCS primary | jj-lib | Native perf, no spawn |
| VCS fallback | gix | Pure Rust, no C deps |
| VCS semantics | Unified stacking | Both jj & git behave identically |
| IDs | ULID | Sortable, coordination-free |
| Task hierarchy | 3 levels max | Milestone(0) -> Task(1) -> Subtask(2) |
| Error pattern | `thiserror` | Ergonomic error handling |

## TYPE SYNC (Rust <-> TS)

Types must stay in sync between `overseer/src/types.rs`, `overseer/src/core/context.rs`, and `mcp/src/types.ts`:
- `TaskId`: Newtype (Rust) / Branded type (TS), `task_` prefix + 26-char ULID
- `LearningId`: Newtype / Branded, `lrn_` prefix
- `Task`, `Learning`, `TaskContext`: Identical shapes
- `InheritedLearnings`: Rust struct in `context.rs` has `own`, `parent`, `milestone`; TS `InheritedLearnings` in `mcp/src/types.ts` matches
- Rust uses `serde(rename_all = "camelCase")` -> JSON matches TS interfaces

**Note:** The `InheritedLearnings` type in `overseer/src/types.rs` (with only `milestone` and `parent`) is for import/export schema compatibility. The actual runtime type used for `TaskWithContext` is in `context.rs` and includes `own`.

**When changing constrained types (e.g., Priority range):**
1. Rust: `types.rs`, validation in `task_service.rs`, CLI args in `commands/task.rs`
2. TypeScript types: `generated/types.ts`, `host/src/types.ts`, `ui/src/types.ts`
3. TypeScript decoders: `host/src/decoder.ts`, `ui/src/decoder.ts`
4. TypeScript API interfaces: `host/src/api/tasks.ts`, `host/src/ui.ts`
5. UI input constraints: Any `min/max` on number inputs

## CONVENTIONS

- **Result everywhere**: All fallible ops return `Result<T, E>`
- **TaggedError (TS)**: Errors use `_tag` discriminator
- **No `any`**: Strict TypeScript
- **No `!`**: Non-null assertions forbidden
- **Minimize `as Type`**: Type assertions discouraged; use decoders where possible
- **jj-first**: ALWAYS check for `.jj/` before VCS commands

## ANTI-PATTERNS

- Never guess VCS type - detect via `overseer/src/vcs/detection.rs`
- Never skip cycle detection - DFS in `task_service.rs`
- Never bypass CASCADE delete invariant
- Never use depth limit for cycle detection (use DFS)
- **Falsy-0 bug**: `if (value)` fails for valid 0 - use `if (value !== undefined)` when passing optional numbers to CLI

## DESIGN INVARIANTS

1. Cycle detection via DFS (not depth limit)
2. CASCADE delete on tasks removes children + learnings
3. CLI spawn timeout: 30s in Node executor
4. Timestamps: ISO 8601 / RFC 3339 (chrono)
5. "Milestone" = depth-0 task (no parent)
6. Learnings bubble to immediate parent on completion (preserves source_task_id)
7. VCS required for workflow ops (start/complete) - fails with NotARepository or DirtyWorkingCopy
8. VCS cleanup on delete is best-effort (logs warning, doesn't fail)
9. VCS bookmark/branch lifecycle (unified stacking semantics):
   - `start`: Create bookmark/branch at HEAD, checkout
   - `complete`: Commit changes → checkout start_commit → delete bookmark/branch
   - Both jj and git get identical behavior
10. Milestone completion cleans ALL descendant bookmarks/branches (depth-1 and depth-2) PLUS milestone's own bookmark
11. Blocker edges preserved on completion (not removed) - readiness computed from blocker's completed state

## CODEMODE PATTERN

Agents write JS -> server executes -> only results return.

- Pattern source: [opensrc-mcp](https://github.com/dmmulroy/opensrc-mcp)
- Why: LLMs handle TypeScript APIs better than raw tool calls
- Key: `executor.ts` (VM sandbox), `server.ts` (tool registration)

## COMMANDS

```bash
# Rust CLI
cd overseer && cargo build --release    # Build CLI
cd overseer && cargo test               # Run tests

# Node MCP
cd mcp && npm install             # Install deps
cd mcp && npm run build           # Compile TS
cd mcp && npm test                # Run tests (node --test)

# UI
cd ui && npm run dev              # Start Hono API + Vite HMR
cd ui && npm run test:ui          # Run UI tests (agent-browser)
```

## FEEDBACK LOOPS (v2)

- Build: `cargo check -p os-core -p os-serve -p os-mcp -p os`
- Serve smoke: `cargo run -p os -- serve` then curl `POST /api/repos`, `POST /api/tasks`, `POST /api/tasks/:id/start`, `POST /api/tasks/:id/submit`
- SSE: `curl -N http://127.0.0.1:4820/api/events/subscribe`
- Gates: create `.overseer/gates.toml`, submit task, check `GET /api/gates/results/:review_id`
- Relay WS: connect `/api/relay/ws`, send `auth/register_harness/session_start/session_complete`
- MCP: `echo '{"id":"1","method":"execute","params":{"code":"return 1"}}' | os mcp`

## DOCS

| Document | Purpose |
|----------|---------|
| `docs/ARCHITECTURE.md` | System design |
| `docs/CLI.md` | CLI command reference |
| `docs/MCP.md` | MCP tool/API reference |
| `docs/task-orchestrator-plan.md` | Original design spec |
| `docs/codemode-*.md` | Codemode pattern research |
| `ui/docs/UI-TESTING.md` | UI testing with agent-browser |
| `ui/AGENTS.md` | UI package knowledge base |
