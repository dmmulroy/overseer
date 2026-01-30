# MCP Wrapper

Node MCP server implementing codemode pattern. Single `execute` tool - agents write JS, VM runs it, results return.

## STRUCTURE

```
src/
├── index.ts          # Entry: startServer()
├── server.ts         # Tool registration, TOOL_DESCRIPTION, error handling
├── executor.ts       # VM sandbox, async IIFE wrap, output truncation
├── cli.ts            # spawn(os), 30s timeout, JSON parse
├── types.ts          # Domain types, branded IDs, error classes
└── api/
    ├── index.ts      # Re-exports
    ├── tasks.ts      # tasks.* -> os task * (complete accepts { result?, learnings? })
    └── learnings.ts  # learnings.list only
```

**Note:** VCS not exposed in sandbox - integrated into task start/complete automatically.

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add sandbox API | `api/*.ts` | Export in `api/index.ts`, add to `executor.ts` sandbox |
| Modify tool schema | `server.ts:136-153` | ListToolsRequestSchema handler |
| Change timeout | `cli.ts:7`, `executor.ts:45` | CLI_TIMEOUT_MS, vm timeout |
| Add error type | `types.ts` | CliError, CliTimeoutError patterns |
| Modify output limit | `executor.ts:9` | MAX_OUTPUT_SIZE (50k chars) |

## CONVENTIONS

- **Branded IDs**: `TaskId`, `LearningId` with runtime validators (`isTaskId`, `parseTaskId`)
- **Error classes**: `CliError` (exit code + stderr), `CliTimeoutError`, `ExecutionError` (stack trace)
- **CLI bridge**: Always append `--json`, parse stdout, stderr on failure
- **Sandbox globals**: Only `tasks`, `learnings`, `console`, timers, `Promise`
- **Async wrap**: All agent code wrapped in `(async () => { ... })()`
- **ES Modules**: `.js` extensions in imports required

## ANTI-PATTERNS

- Never expose `require`, `process`, `fs`, `child_process` to sandbox
- Never skip output truncation - 50k char limit prevents response overflow
- Never use `as Type` casts on CLI output - CLI types are source of truth
- Never add env vars without `OVERSEER_` prefix (`OVERSEER_CLI_PATH`, `OVERSEER_CLI_CWD`)
- Never modify TOOL_DESCRIPTION without updating actual API signatures

## COMMANDS

```bash
npm run build          # Compile TS -> build/
npm test               # node --test build/tests/**/*.test.js
npm run watch          # tsc --watch for dev
```

## FLOW

```
Agent code -> execute(code) -> vm.Script -> sandbox context
                                              |-- tasks.list() -> callCli(["task","list"]) -> spawn os -> JSON
                                              |-- tasks.start() -> callCli(["task","start"]) -> VCS required, creates bookmark
                                              |-- tasks.complete({result,learnings}) -> VCS required, commits + bubbles learnings
                                              +-- learnings.list() -> callCli(["learning","list"]) -> spawn os -> JSON
                            <- truncateOutput(result) <- Promise resolves
```

**VCS Notes:**
- `start` and `complete` require VCS (jj or git) - fail with NotARepository error if none
- CRUD operations (create, get, list, update, delete, block, unblock) work without VCS
- Complete uses `commit()` (not squash); NothingToCommit treated as success

## TYPE SYNC

Types in `types.ts` must match Rust `overseer/src/types.rs`:
- `TaskId`: Branded, `task_` prefix + 26-char ULID
- `Task`, `Learning`, `TaskContext`, `InheritedLearnings`: Identical shapes
- Runtime validators: `isTaskId()`, `parseTaskId()`, `isLearningId()`
