# Feedback Loops for Coding Agents

**Status:** Draft v1  
**Date:** 2026-02-07  
**Depends on:** 03a-gates, 04-events, 05-relay, 10-system-integration  
**Blocks:** None

## Overview

Goal: design feedback loops that keep agents on-track, converge faster, and prevent wrong builds. This spec combines 2023-2025 research + agent scaffolding lessons with an implementation playbook for Overseer v2.

---

## Research Summary (2026 snapshot)

- **Reflexion**: language agents improve via explicit self-reflection stored as memory; feedback in language form improves coding success. Source: https://arxiv.org/abs/2303.11366
- **Self-Refine**: iterative feedback + refinement improves outputs without training. Source: https://arxiv.org/abs/2303.17651
- **SWE-bench Verified**: evaluation quality depends on well-specified tasks + reliable tests; verified datasets reduce false negatives. Source: https://openai.com/index/introducing-swe-bench-verified
- **OpenAI Evals**: formal eval harness improves reliability; custom evals + registries support regression tracking. Source: https://github.com/openai/evals
- **SWE-agent**: tool-using agent scaffolding + reproducible trajectories; shows importance of logs, environment control, and benchmarks. Source: https://github.com/SWE-agent/SWE-agent

Implications:
- Feedback loops must be explicit, structured, and persisted.
- Tests must be trusted; bad tests corrupt the loop.
- Iteration + reflection beats one-shot generation.

---

## Feedback Loop Taxonomy

### L0: Self-Feedback (intra-step)

- Self-critique + refine before applying edits (Self-Refine).
- Persist critique in `learnings` for next iteration (Reflexion).

### L1: Fast Local Gates (seconds)

- Format, lint, typecheck, unit tests, schema validation.
- Run before any submit/review.

### L2: Integration Gates (minutes)

- Multi-module tests, DB migrations, VCS integration, MCP runtime tests.

### L3: Scenario / E2E (minutes)

- Golden task scenarios, relay session flows, UI snapshot flows.

### L4: Human Feedback (hours)

- Spec review + PR review; capture reasons in learnings.

### L5: Runtime Feedback (post-merge)

- Metrics, logs, regressions, real-user flows.

---

## Overseer v2 Feedback Loop Design

### Core Loop (Agent)

1. Read spec + constraints.
2. Implement minimal diff.
3. Run L1 gates.
4. If fail: summarize failure + reflect + fix.
5. If pass: run L2/L3 as required.
6. Submit -> review pipeline -> capture review feedback as learnings.

### System Loops (Platform)

- **Gates**: encode L1/L2/L3 checks with explicit pass/fail.
- **Events**: stream every gate + state transition for audit.
- **Help Requests**: model escalates to human when blocked.
- **Learnings**: persistent memory for future tasks.

---

## Tooling to Build

### Eval Harness (Local)

- Use an Evals-style runner to execute scenario suites.
- Store eval definitions in repo (YAML + fixtures).
- Run on CI; regressions block merge.

### Verified Task Set

- Create a SWE-bench-style internal dataset:
  - Task spec + expected tests + `PASS_TO_PASS` tests.
  - Human review of each task before adding.

### Automated Spec Checks

- OpenAPI drift: code vs spec.
- Event list alignment: `ARCHITECTURE-V2.md` vs `04-events.md`.
- Type sync: Rust <-> TS.

### Agent Logs + Replay

- Persist agent decisions, diffs, test outputs.
- Allow replay to reproduce failures.

---

## Agent Implementation Playbook

### Required Steps per Task

- Read target spec doc.
- Draft minimal change plan.
- Implement; run L1 gates.
- If gate fail: capture failure, reflect, retry.
- Record learning after completion.

### Review Expectations

- Diff must map to spec sections.
- Each new API must include schema + event mapping.
- Each state transition must emit event.

---

## Metrics

- `gate_pass_rate` per gate type.
- `time_to_green` per task.
- `retry_count` per task.
- `eval_pass_rate` per scenario suite.
- `review_changes_requested_rate`.

---

## Invariants

- No submit without passing L1 gates.
- Any human review feedback becomes learnings.
- E2E failures block merge.
- Agent must record reflection for any failed attempt.

---

**Phase: DRAFT v1 | Status: Ready for review**
