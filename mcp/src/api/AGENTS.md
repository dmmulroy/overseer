# MCP API LAYER

VM sandbox APIs wrapping CLI with --json (tasks/learnings namespaces).

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | API exports |
| `tasks.ts` | Task CRUD + lifecycle: {list,get,create,update,start,complete,reopen,delete,block,unblock,nextReady,tree,search} |
| `learnings.ts` | Learning queries: {list} only (add/delete removed - learnings added via tasks.complete) |

**Note:** VCS ops integrated into task start/complete. Learnings added via `tasks.complete(id, { learnings })` and bubble to immediate parent.

## CLI BRIDGE PATTERN

All APIs use `callCli(args)` from `../cli.ts`:

```ts
const result = await callCli(["task", "get", id]);
return result as Task;
```

**Key mechanics:**
- Spawn timeout: 30s
- Auto-appends `--json` to all commands
- Parses stdout as JSON
- stderr -> CliError on non-zero exit
- Branded IDs passed as strings

## TYPE SAFETY

- Input types: `CreateTaskInput`, `UpdateTaskInput`, `TaskFilter`
- Return types: `Task`, `Learning`, `VcsStatus`, etc. (from `../types.ts`)
- Never `any` - all CLI responses cast to domain types
- Filters map to CLI flags: `filter.ready` -> `--ready`

## VCS INTEGRATION (Required for Workflow)

- `tasks.start()` -> **VCS required** - creates bookmark, records start commit
- `tasks.complete()` -> **VCS required** - commits changes (NothingToCommit = success), captures SHA
- VCS type auto-detected (jj-first, git fallback)
- Fails with `NotARepository` if no jj/git, `DirtyWorkingCopy` if uncommitted changes
- CRUD operations (create, get, list, update, delete, block, unblock) work without VCS

## CONVENTIONS

- All async (CLI spawn overhead)
- Optional args -> optional CLI flags
- Arrays serialized: `--blocked-by id1,id2`
- Void returns -> discard CLI output
- Null returns -> `null` literal in JSON (not undefined)
