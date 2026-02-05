# Quality Gates

**Status:** Draft v1  
**Date:** 2026-02-05  
**Depends on:** 01-core-domain (Gate types), 03-review (review workflow)  
**Blocks:** None

## Overview

Gates are automated quality checks that run before review phases proceed. They enforce standards (type checking, linting, tests) and support async workflows (deployment approval, manual QA).

**Core principle:** Gates are pass/fail checkpoints. If a gate fails, work returns to the agent. If retries exhaust, work escalates to human.

---

## Execution Model

### Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Pass | Proceed to next phase |
| 75 | Pending (EX_TEMPFAIL) | Poll again after `poll_interval_secs` |
| Any other | Fail | Retry up to `max_retries`, then escalate |
| None (killed) | Timeout | Treat as failure, retry |

### Execution Flow

```
                         submit()
                            |
                            v
                    +---------------+
                    | Run All Gates |  <-- parallel execution
                    +-------+-------+
                            |
            +---------------+---------------+
            |               |               |
            v               v               v
        All Pass      Some Pending      Some Failed
            |               |               |
            v               |               v
      Agent Review     Schedule Poll   Capture Output
                            |               |
                            v               v
                    +---------------+   Retry < Max?
                    | Poll Pending  |       |
                    +-------+-------+   +---+---+
                            |           |       |
                    Pass/Fail/Pending   Yes     No
                            |           |       |
                            v           v       v
                        (loop)      Re-run   Escalate
                                    Gate     to Human
```

### Algorithm: Run Gates

```
function run_gates_for_review(review_id) -> GateRunOutcome:
    review = review_repo.get(review_id)
    task = task_repo.get(review.task_id)
    gates = gate_repo.get_effective(task.id)
    
    if gates.empty():
        return AllPassed
    
    // Run all gates in parallel
    handles = []
    for gate in gates:
        handles.push(spawn(execute_single_gate, gate, task, review_id))
    
    results = await_all(handles)
    
    // Analyze results
    passed = results.filter(|r| r.status == Passed)
    pending = results.filter(|r| r.status == Pending)
    failed = results.filter(|r| r.status in [Failed, Timeout])
    escalated = results.filter(|r| r.status == Escalated)
    
    // Priority: escalated > failed > pending > passed
    if escalated.any():
        return Escalated { 
            gates: escalated,
            context: format_failure_context(escalated)
        }
    
    if failed.any():
        retryable = failed.filter(|r| r.attempt < r.gate.max_retries)
        if retryable.any():
            return Failed {
                gates: failed,
                can_retry: true,
                context: format_failure_context(failed)
            }
        else:
            // All failed gates exhausted retries
            return Escalated {
                gates: failed,
                context: format_failure_context(failed)
            }
    
    if pending.any():
        next_poll = now() + min(pending.map(|p| p.gate.poll_interval_secs))
        return Pending {
            gates: pending,
            poll_at: next_poll
        }
    
    return AllPassed


function execute_single_gate(gate, task, review_id) -> GateResult:
    env = {
        "OVERSEER_TASK_ID": task.id,
        "OVERSEER_REPO_ID": task.repo_id,
        "OVERSEER_REPO_PATH": repo_repo.get(task.repo_id).path,
        "OVERSEER_REVIEW_ID": review_id,
        "OVERSEER_GATE_NAME": gate.name,
        "OVERSEER_ATTEMPT": "1",  // Updated on retry
    }
    
    result = spawn_process(
        command: gate.command,
        cwd: repo_path,
        env: env,
        timeout: gate.timeout_secs,
        capture_output: true,
        max_output: 65536,  // 64KB per stream
    )
    
    gate_result = GateResult {
        gate_id: gate.id,
        task_id: task.id,
        review_id: review_id,
        status: match result.exit_code {
            Some(0) => Passed,
            Some(75) => Pending,
            Some(_) => Failed,
            None => Timeout,
        },
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        attempt: 1,
        started_at: result.started_at,
        completed_at: result.completed_at,
    }
    
    gate_repo.record_result(gate_result)
    return gate_result


function retry_gate(gate_id, task_id, review_id, attempt) -> GateResult:
    gate = gate_repo.get(gate_id)
    
    if attempt > gate.max_retries:
        return GateResult { status: Escalated, ... }
    
    env = { ..., "OVERSEER_ATTEMPT": attempt.to_string() }
    
    // Same execution as above, but with updated attempt number
    ...
```

### Algorithm: Poll Pending Gates

```
function poll_pending_gates(review_id) -> GateRunOutcome:
    results = gate_repo.get_results(review_id)
    pending = results.filter(|r| r.status == Pending)
    
    for result in pending:
        gate = gate_repo.get(result.gate_id)
        elapsed = now() - result.started_at
        
        if elapsed > gate.max_pending_secs:
            // Async gate timed out
            new_result = result.clone()
            new_result.status = Timeout
            gate_repo.record_result(new_result)
            continue
        
        // Re-run the gate to check status
        new_result = execute_single_gate(gate, task, review_id)
        new_result.attempt = result.attempt  // Preserve attempt count
        gate_repo.record_result(new_result)
    
    // Re-analyze all results
    return analyze_results(gate_repo.get_results(review_id))
```

---

## Integration with Review Workflow

### Trigger Points

Gates run at these points in the review lifecycle:

1. **On submit** - `InProgress` -> `InReview`
   - Gates run immediately after commit
   - Review created with status `GatesPending`

2. **After agent changes implemented** - Agent fixes issues from agent review
   - Gates must pass again before agent re-reviews
   - Same Review, status returns to `GatesPending`

3. **After human changes implemented** - Agent fixes issues from human review
   - Gates must pass again before human re-reviews
   - Same Review, status returns to `GatesPending`

### Review Status Transitions

```
submit()
    |
    v
GatesPending ----[all pass]----> AgentPending
    |                                |
    |--[retry available]--+          |
    |                     |          |
    |<--------------------+          |
    |                                |
    +--[max retries]---> GatesEscalated
                              |
                              |--[human resolves]--> AgentPending
                              |
                              +--[human force_complete]--> Approved
```

### State Machine Detail

```rust
impl Review {
    fn on_gates_result(&mut self, outcome: GateRunOutcome) -> Result<(), ReviewError> {
        match (self.status, outcome) {
            // Happy path
            (GatesPending, AllPassed) => {
                self.status = AgentPending;
                self.gates_completed_at = Some(now());
            }
            
            // Async gates need more time
            (GatesPending, Pending { poll_at, .. }) => {
                // Status stays GatesPending
                // Scheduler will poll at poll_at
            }
            
            // Failures with retries remaining
            (GatesPending, Failed { can_retry: true, context, .. }) => {
                // Status stays GatesPending
                // Agent receives context, makes fixes
                // On next submit, gates re-run
            }
            
            // All retries exhausted
            (GatesPending, Failed { can_retry: false, .. } | Escalated { .. }) => {
                self.status = GatesEscalated;
                self.gates_completed_at = Some(now());
                // Human must intervene
            }
            
            _ => return Err(InvalidTransition),
        }
        Ok(())
    }
}
```

---

## Configuration

### File-based Configuration

`.overseer/gates.toml` in repository root:

```toml
# All gates in this file apply to all tasks in the repository

[[gate]]
name = "typecheck"
command = "npm run typecheck"
# Optional fields with defaults:
# timeout_secs = 300
# max_retries = 3
# poll_interval_secs = 30
# max_pending_secs = 86400

[[gate]]
name = "lint"
command = "npm run lint"
timeout_secs = 120
max_retries = 2

[[gate]]
name = "test"
command = "npm test -- --coverage"
timeout_secs = 600
max_retries = 1

# Async gate example: waits for external approval
[[gate]]
name = "staging-deploy-approval"
command = "./scripts/check-deploy-approval.sh"
timeout_secs = 30           # Script itself runs fast
max_retries = 1             # Don't retry the check
poll_interval_secs = 300    # Check every 5 minutes
max_pending_secs = 172800   # Wait up to 48 hours
```

### CLI Commands

```bash
# List gates for current repo
os gate list

# List effective gates for a task (including inherited)
os gate list --task <task_id>

# Add repo-level gate
os gate add --name "typecheck" --command "npm run typecheck"

# Add task-level gate
os gate add --task <task_id> --name "e2e-tests" --command "npm run test:e2e"

# Remove gate
os gate remove <gate_id>

# Update gate configuration
os gate update <gate_id> --timeout 600 --max-retries 5

# Show gate results for a review
os gate results <review_id>

# Manually re-run gates (human trigger)
os gate rerun <review_id>
```

### Task-level Gates in Context

Gates can be defined in task context field using YAML front matter:

```yaml
---
gates:
  - name: integration-tests
    command: npm run test:integration
    timeout_secs: 900
  - name: performance-check
    command: ./scripts/perf-baseline.sh
---

Implement the new caching layer for API responses.

This task requires passing integration tests and a performance baseline check.
```

**Parsing rules:**
- If context starts with `---`, parse YAML front matter
- Extract `gates` array if present
- Remainder is the actual context text

---

## Agent Feedback

When gates fail, agents receive structured feedback:

```json
{
  "gate_failures": [
    {
      "name": "typecheck",
      "exit_code": 1,
      "attempt": 3,
      "max_retries": 3,
      "stdout": "...",
      "stderr": "src/api/handler.ts(45,12): error TS2345: Argument of type...",
      "escalated": true
    },
    {
      "name": "lint",
      "exit_code": 1,
      "attempt": 1,
      "max_retries": 3,
      "stdout": "",
      "stderr": "src/utils.ts:12:5 - error: 'foo' is never used",
      "escalated": false
    }
  ],
  "action_required": "fix_and_resubmit",
  "escalated_to_human": true
}
```

Agent should:
1. Parse failure output to understand issues
2. Fix the code
3. Re-run `submit()` to trigger gates again
4. If escalated, STOP and wait for human

---

## Async Gate Patterns

### Deployment Approval Script

```bash
#!/bin/bash
# check-deploy-approval.sh
# Returns 0 if approved, 75 if pending, 1 if rejected

TASK_ID=$OVERSEER_TASK_ID
APPROVAL_FILE="/var/approvals/${TASK_ID}.status"

if [ ! -f "$APPROVAL_FILE" ]; then
    echo "Approval pending for task $TASK_ID"
    exit 75  # Pending
fi

STATUS=$(cat "$APPROVAL_FILE")

case "$STATUS" in
    "approved")
        echo "Deployment approved"
        exit 0
        ;;
    "rejected")
        echo "Deployment rejected"
        exit 1
        ;;
    *)
        echo "Unknown status: $STATUS"
        exit 1
        ;;
esac
```

### External CI Integration

```bash
#!/bin/bash
# check-ci-status.sh
# Polls external CI for build status

BUILD_ID=$(curl -s "https://ci.example.com/api/builds?task=$OVERSEER_TASK_ID" | jq -r '.id')

if [ -z "$BUILD_ID" ]; then
    # Trigger build
    curl -X POST "https://ci.example.com/api/builds" \
        -d "task=$OVERSEER_TASK_ID" \
        -d "repo=$OVERSEER_REPO_PATH"
    exit 75  # Pending - build just started
fi

STATUS=$(curl -s "https://ci.example.com/api/builds/$BUILD_ID" | jq -r '.status')

case "$STATUS" in
    "success")
        exit 0
        ;;
    "pending"|"running")
        exit 75
        ;;
    *)
        echo "Build failed: $STATUS"
        curl -s "https://ci.example.com/api/builds/$BUILD_ID/logs"
        exit 1
        ;;
esac
```

---

## Security Considerations

### Command Execution

| Risk | Mitigation |
|------|------------|
| Command injection | Commands stored verbatim, no shell expansion on variables |
| Path traversal | CWD locked to repo root |
| Env pollution | Controlled env vars only, inherit minimal from parent |
| Resource exhaustion | timeout_secs enforced via SIGTERM/SIGKILL |
| Output flood | stdout/stderr capped at 64KB each |

### Sandboxing (Future)

Consider for v2:
- Run gates in container/VM
- Network isolation
- Filesystem read-only except temp
- Resource limits (CPU, memory)

---

## Error Handling

### Gate Execution Errors

```rust
pub enum GateExecutionError {
    /// Command not found or not executable
    CommandNotFound { command: String },
    
    /// Working directory doesn't exist
    WorkdirNotFound { path: PathBuf },
    
    /// Process spawn failed
    SpawnFailed { reason: String },
    
    /// Process killed by signal
    Signaled { signal: i32 },
    
    /// Output capture failed
    OutputCaptureFailed { reason: String },
}
```

All execution errors are recorded in `GateResult.stderr` and treated as failures.

### Recovery

| Scenario | Behavior |
|----------|----------|
| Gate command missing | Fail immediately, record error in stderr |
| Gate times out | Kill process, treat as failure, retry if attempts remain |
| Repo path invalid | Fail immediately, escalate (config error) |
| Database error | Retry gate execution, log error |

---

## Observability

### Metrics to Track

- `gates_executed_total{gate_name, status}` - Counter
- `gate_duration_seconds{gate_name}` - Histogram
- `gate_retries_total{gate_name}` - Counter
- `gates_escalated_total{gate_name}` - Counter
- `async_gate_wait_seconds{gate_name}` - Histogram

### Logging

```
[INFO] Gate started: name=typecheck task=task_01HX... review=rev_01HX... attempt=1
[DEBUG] Gate output: name=typecheck stdout_lines=0 stderr_lines=12
[WARN] Gate failed: name=typecheck exit_code=1 attempt=1 will_retry=true
[ERROR] Gate escalated: name=typecheck exit_code=1 attempt=3 max_retries=3
[INFO] Gate passed: name=typecheck duration_ms=4523
```

---

## Testing Strategy

### Unit Tests

- Gate creation with valid/invalid configs
- Exit code -> GateStatus mapping
- Retry logic (attempt counting, max_retries)
- Timeout handling
- Pending -> poll -> final state transitions

### Integration Tests

- End-to-end: submit -> gates -> agent review
- Async gate polling
- Gate inheritance (repo + task levels)
- Config file parsing

### Test Gates for CI

```toml
# .overseer/gates.toml for testing

[[gate]]
name = "always-pass"
command = "exit 0"

[[gate]]
name = "always-fail"
command = "exit 1"

[[gate]]
name = "always-pending"
command = "exit 75"

[[gate]]
name = "slow-gate"
command = "sleep 10 && exit 0"
timeout_secs = 5  # Will timeout

[[gate]]
name = "flaky-gate"
command = "test $((RANDOM % 2)) -eq 0"  # 50% chance
max_retries = 5
```

---

## Effort Estimates

| Component | Effort | Notes |
|-----------|--------|-------|
| Gate types + DB schema | S | Straightforward, uses existing patterns |
| Gate repository impl | M | CRUD + effective gates query |
| Process execution | M | spawn, timeout, capture, env |
| Polling scheduler | M | Background task, cron-like |
| Review integration | M | State machine updates |
| Config file parser | S | TOML with validation |
| CLI commands | M | add/list/remove/results/rerun |
| Agent feedback format | S | JSON structure |
| Tests | L | Many edge cases |

**Total: L (1-2 days)**

---

**Phase: DRAFT v1 | Status: Ready for review**
