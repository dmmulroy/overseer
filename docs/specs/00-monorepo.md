# Monorepo Structure

**Status:** Draft v1  
**Date:** 2026-02-05  
**Depends on:** None (foundational)  
**Blocks:** 01-core-domain, 02-vcs, 03-review, 03a-gates, 04-events, 05-relay, 07-agent-primitives, 08-web-ui, 09-mcp-rquickjs, 10-system-integration

## Overview

This spec defines Overseer v2's repository structure, crate boundaries, build system, CI/CD, release process, and dev workflow. Overseer v2 is a **greenfield rebuild** — no code carries over from v1.

**Design principles:**
- **Single Rust binary** — All modes (CLI, serve, MCP) in one artifact
- **Crate boundaries for DX** — Agents and humans can reason about scope
- **OpenAPI-first** — Generate clients, don't hand-write them
- **Minimal TypeScript** — Only webapp + generated API client
- **Justfile orchestration** — One command to rule them all
- **Embedded webapp** — `rust-embed` bakes assets into the binary for distribution

---

## Repository Layout

```
overseer/
├── Cargo.toml                 # Workspace root
├── justfile                   # Build orchestration
├── rust-toolchain.toml        # Pin Rust version
├── .github/
│   └── workflows/
│       ├── ci.yml             # Test + lint on PR
│       └── release.yml        # Build + publish on tag
│
├── crates/
│   ├── os-core/               # Domain types + SDK-style API
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── types/         # Task, Review, Gate, HelpRequest, etc.
│   │       ├── tasks.rs       # overseer::tasks::*
│   │       ├── reviews.rs     # overseer::reviews::*
│   │       ├── learnings.rs   # overseer::learnings::*
│   │       ├── gates.rs       # overseer::gates::*
│   │       ├── repos.rs       # overseer::repos::*
│   │       ├── help.rs        # overseer::help::*
│   │       └── error.rs       # OverseerError
│   │
│   ├── os-db/                 # SQLite persistence
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── schema.rs      # DDL, migrations
│   │       ├── task_repo.rs
│   │       ├── review_repo.rs
│   │       ├── gate_repo.rs
│   │       ├── learning_repo.rs
│   │       ├── help_repo.rs
│   │       └── repo_repo.rs
│   │
│   ├── os-vcs/                # VCS backends (jj-lib + gix)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── backend.rs     # VcsBackend trait
│   │       ├── detection.rs   # Detect .jj/ vs .git/
│   │       ├── jj.rs          # jj-lib implementation
│   │       └── git.rs         # gix implementation
│   │
│   ├── os-events/             # Event system
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── types.rs       # Event, EventBody
│   │       ├── bus.rs         # In-memory pub/sub
│   │       └── store.rs       # SQLite event log
│   │
│   ├── os-serve/              # Axum server (REST, SSE, Relay, static)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── routes/        # API route handlers
│   │       ├── openapi.rs     # utoipa spec generation
│   │       ├── sse.rs         # Event streaming
│   │       ├── relay.rs       # WebSocket harness broker
│   │       └── static_files.rs # rust-embed webapp serving
│   │
│   ├── os-mcp/                # MCP server (rquickjs executor)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── executor.rs    # rquickjs runtime
│   │       ├── protocol.rs    # MCP message types
│   │       └── api.rs         # JS API bindings (tasks, reviews, etc.)
│   │
│   └── os/                    # CLI binary
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs        # Entry, mode dispatch
│           ├── cli/           # Clap commands
│           ├── output.rs      # JSON/human formatting
│           └── config.rs      # Config file loading
│
├── openapi/
│   ├── overseer.yaml          # OpenAPI 3.1 spec (generated from Rust)
│   └── README.md
│
├── webapp/                    # React SPA (minimal, uses generated client)
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/               # Generated OpenAPI client
│       └── components/
│
├── npm/                       # npm publishing (platform binaries)
│   ├── overseer/              # Main package (binary routing)
│   │   ├── package.json
│   │   └── index.js
│   └── scripts/
│       └── build-npm.sh
│
├── docs/
│   ├── ARCHITECTURE-V2.md     # System architecture overview
│   ├── specs/                 # Design specs
│   │   ├── 00-monorepo.md     # (this file)
│   │   ├── 01-core-domain.md
│   │   ├── 03a-gates.md
│   │   └── ...
│   ├── CLI.md
│   ├── API.md                 # REST API reference (generated)
│   └── MCP.md
│
├── skills/                    # Agent skills (see 07-agent-primitives.md)
│   ├── overseer/
│   └── overseer-plan/
│
└── tests/
    ├── integration/           # Cross-crate integration tests
    └── fixtures/              # Test data, sample repos
```

---

## Crate Dependency Graph

```
                    ┌─────────────┐
                    │     os      │  (binary)
                    │   (clap)    │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │  os-serve   │ │   os-mcp    │ │  (direct    │
     │   (axum)    │ │ (rquickjs)  │ │   SDK use)  │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   os-core   │  (SDK: tasks, reviews, etc.)
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │    os-db    │ │   os-vcs    │ │  os-events  │
    │  (rusqlite) │ │ (jj, gix)  │ │  (tokio)    │
    └─────────────┘ └─────────────┘ └─────────────┘
```

**Dependency rules:**
- `os-core` depends on `os-db`, `os-vcs`, `os-events`
- `os-serve` and `os-mcp` depend only on `os-core`
- `os` (binary) depends on all of the above
- No circular dependencies
- Leaf crates (`os-db`, `os-vcs`, `os-events`) have minimal external deps
- Shared types live in `os-core/src/types/` — leaf crates do not define domain types

---

## Crate Responsibilities

| Crate | Responsibility | Key Dependencies |
|-------|----------------|------------------|
| `os-core` | Domain types, SDK API (`overseer::tasks::*`), business logic, validation | os-db, os-vcs, os-events, thiserror, chrono |
| `os-db` | SQLite persistence, schema migrations, repository impls | rusqlite, ulid |
| `os-vcs` | VCS backend trait, jj-lib + gix impls, detection | jj-lib, gix, pollster |
| `os-events` | Event types, in-memory pub/sub bus, SQLite event log | tokio (channels) |
| `os-serve` | REST API (axum), OpenAPI (utoipa), SSE, Relay WS, static files | axum, tower, utoipa, rust-embed |
| `os-mcp` | MCP protocol, rquickjs executor, codemode API bindings | rquickjs |
| `os` | CLI (clap), mode dispatch (`serve`/`mcp`/subcommands), output formatting | clap, all above |

---

## Workspace Cargo.toml

```toml
[workspace]
resolver = "2"
members = [
    "crates/os",
    "crates/os-core",
    "crates/os-db",
    "crates/os-vcs",
    "crates/os-events",
    "crates/os-serve",
    "crates/os-mcp",
]

[workspace.package]
version = "0.1.0"
edition = "2024"
license = "MIT"
repository = "https://github.com/your-org/overseer"

[workspace.dependencies]
# Internal crates
os-core = { path = "crates/os-core" }
os-db = { path = "crates/os-db" }
os-vcs = { path = "crates/os-vcs" }
os-events = { path = "crates/os-events" }
os-serve = { path = "crates/os-serve" }
os-mcp = { path = "crates/os-mcp" }

# Async runtime
tokio = { version = "1.49", features = ["full"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Error handling
thiserror = "2.0"

# Date/time
chrono = { version = "0.4", features = ["serde"] }

# IDs
ulid = "1.2"

# CLI
clap = { version = "4.5", features = ["derive"] }

# Storage
rusqlite = { version = "0.38", features = ["bundled"] }

# VCS - pinned for API stability
jj-lib = "=0.37"
gix = { version = "0.77", default-features = false, features = [
    "index",
    "worktree-mutation",
    "status",
    "revision",
    "dirwalk",
] }
pollster = "0.4"

# HTTP server
axum = "0.8"
tower = "0.5"
tower-http = { version = "0.6", features = ["fs", "cors", "trace"] }

# MCP / JS engine
rquickjs = { version = "0.9", features = ["chrono"] }

# OpenAPI
utoipa = { version = "5.4", features = ["axum_extras"] }
utoipa-swagger-ui = { version = "8", features = ["axum"] }

# Static file embedding
rust-embed = "8.11"
mime_guess = "2.0"

# Display
owo-colors = { version = "4", features = ["supports-colors"] }

[workspace.lints.rust]
unsafe_code = "forbid"

[workspace.lints.clippy]
all = "warn"
pedantic = "warn"

[profile.release]
lto = true
codegen-units = 1
strip = true
panic = "abort"

[profile.dev.package.jj-lib]
opt-level = 1

[profile.dev.package.gix]
opt-level = 1

[profile.dev.package.rquickjs]
opt-level = 1
```

---

## Key Design Decisions

### OpenAPI-First (No ts-rs)

**Decision:** Use `utoipa` for OpenAPI spec generation, `openapi-typescript` for TS client codegen.

| Factor | OpenAPI (utoipa) | ts-rs |
|--------|-----------------|-------|
| Industry standard | Yes | No |
| Multi-language clients | Yes (any lang) | TypeScript only |
| Free documentation | Swagger UI | None |
| API contract | Explicit | Implicit |
| Maintenance | One system | Two systems |
| Type coverage | API surface | All types |

**Trade-off accepted:** Internal domain types not auto-exported to TS. If later needed, add ts-rs for specific crates. For MVP the webapp only needs API-surface types.

**Implementation:**

```rust
// All API types get utoipa derives
#[derive(Serialize, utoipa::ToSchema)]
pub struct Task { ... }

// openapi-typescript generates from spec:
// export interface Task { ... }
```

### No Turborepo

**Decision:** Just + Cargo + pnpm. No additional build orchestration.

| Factor | With Turborepo | Without |
|--------|---------------|---------|
| TS footprint | Minimal (1 webapp) | Same |
| Rust caching | Cargo handles well | Same |
| Learning curve | Another tool | Simpler |
| CI complexity | Higher | Lower |

**Reconsider if:** Multiple TS packages, CI >10 min, or need cross-lang caching.

### Embedded Webapp (rust-embed)

**Decision:** Embed webapp assets into the binary for release. Serve from filesystem in dev.

**Rationale:**
- npm is primary distribution — single binary must just work
- No file path resolution issues
- `npx overseer serve` starts UI with zero config

```rust
// os-serve/src/static_files.rs
#[derive(rust_embed::Embed)]
#[folder = "webapp/dist/"]
struct WebappAssets;

// Dev mode: serve from filesystem (Vite HMR compatible)
// Release mode: serve from embedded assets with SPA fallback
```

---

## OpenAPI Strategy

### Generation Flow

```
Rust types + utoipa annotations
           │
           ▼ (just openapi)
    openapi/overseer.yaml
           │
           ▼ (openapi-typescript)
    webapp/src/api/
           │
           ▼ (imported by)
     webapp components
```

### Rust Side

```rust
// os-serve/src/routes/tasks.rs
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    paths(list_tasks, get_task, create_task),
    components(schemas(Task, CreateTaskInput, TaskFilter))
)]
pub struct TasksApi;

#[utoipa::path(
    get,
    path = "/api/tasks",
    params(TaskFilter),
    responses(
        (status = 200, description = "List tasks", body = Vec<Task>)
    )
)]
async fn list_tasks(...) -> impl IntoResponse { ... }
```

### CLI Spec Export

```rust
// os/src/main.rs
// `os openapi` subcommand dumps spec to stdout
fn handle_openapi(overseer: &Overseer) {
    let spec = os_serve::openapi::generate_spec();
    println!("{}", spec.to_yaml().unwrap());
}
```

---

## Justfile

```justfile
default: check

# === Development ===

# Run all checks
check: fmt-check lint test

# Format
fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all -- --check

# Lint
lint:
    cargo clippy --workspace --all-targets -- -D warnings

# Tests
test:
    cargo test --workspace

test-crate crate:
    cargo test -p {{crate}}

# === Build ===

build:
    cargo build --workspace

build-release: webapp-build
    cargo build --release

# === Server ===

# Dev server with auto-reload
dev:
    cargo watch -x 'run -- serve'

# MCP mode
mcp:
    cargo run -- mcp

# === OpenAPI ===

# Generate OpenAPI spec from Rust
openapi:
    cargo run --release -- openapi > openapi/overseer.yaml

# Generate TypeScript client from OpenAPI spec
openapi-ts: openapi
    cd webapp && pnpm exec openapi-typescript ../openapi/overseer.yaml -o src/api/schema.ts

# === Webapp ===

webapp-install:
    cd webapp && pnpm install

webapp-dev:
    cd webapp && pnpm run dev

webapp-build:
    cd webapp && pnpm run build

# === Full Stack Dev ===

# Server + webapp concurrently
dev-full:
    just dev &
    just webapp-dev

# === Release ===

release: webapp-build
    cargo build --release

release-npm:
    ./npm/scripts/build-npm.sh

# === Utilities ===

clean:
    cargo clean
    rm -rf webapp/dist
    rm -rf webapp/src/api/schema.ts

update:
    cargo update

completions shell:
    cargo run -- completions {{shell}}
```

---

## CI/CD

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  CARGO_TERM_COLOR: always
  RUST_BACKTRACE: 1

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2

      - name: Format
        run: cargo fmt --all -- --check

      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings

      - name: Test
        run: cargo test --workspace

      - name: Build
        run: cargo build --workspace

  openapi-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2

      - name: Generate OpenAPI
        run: cargo run --release -- openapi > openapi/overseer.yaml.new

      - name: Check for drift
        run: diff openapi/overseer.yaml openapi/overseer.yaml.new
```

### `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: os
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            artifact: os
          - os: macos-latest
            target: x86_64-apple-darwin
            artifact: os
          - os: macos-latest
            target: aarch64-apple-darwin
            artifact: os
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact: os.exe

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - uses: Swatinem/rust-cache@v2
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
          cache-dependency-path: webapp/pnpm-lock.yaml

      - name: Build webapp
        run: cd webapp && pnpm install --frozen-lockfile && pnpm build

      - name: Build binary
        run: cargo build --release --target ${{ matrix.target }}

      - name: Package
        run: |
          mkdir -p dist
          cp target/${{ matrix.target }}/release/${{ matrix.artifact }} dist/
          cd dist && tar czf os-${{ matrix.target }}.tar.gz ${{ matrix.artifact }}

      - uses: actions/upload-artifact@v4
        with:
          name: os-${{ matrix.target }}
          path: dist/os-${{ matrix.target }}.tar.gz

  github-release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*.tar.gz
          generate_release_notes: true

  npm-publish:
    needs: github-release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Build npm packages
        run: ./npm/scripts/build-npm.sh

      - name: Publish
        run: cd npm/overseer && npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## npm Package Structure

```
npm/
├── overseer/
│   ├── package.json
│   ├── index.js           # Binary routing (detect platform, exec)
│   └── bin/               # Populated by build-npm.sh
│       ├── os-linux-x64
│       ├── os-linux-arm64
│       ├── os-darwin-x64
│       ├── os-darwin-arm64
│       └── os-win32-x64.exe
│
└── scripts/
    └── build-npm.sh       # Downloads release artifacts, packages
```

### `npm/overseer/package.json`

```json
{
  "name": "overseer",
  "version": "0.1.0",
  "description": "Local code review and agent orchestration platform",
  "bin": {
    "os": "index.js",
    "overseer": "index.js"
  },
  "os": ["darwin", "linux", "win32"],
  "cpu": ["x64", "arm64"],
  "engines": {
    "node": ">=18"
  },
  "license": "MIT"
}
```

---

## Dev Workflow

### First-time Setup

```bash
git clone https://github.com/your-org/overseer && cd overseer

# Install tooling
cargo install just cargo-watch

# Build
just build

# Run tests
just test
```

### Daily Development

```bash
# Server with auto-reload
just dev

# Webapp (separate terminal)
just webapp-dev

# Or both together
just dev-full

# Before committing
just check
```

### Adding a New API Endpoint

1. Add SDK method in `crates/os-core/src/{module}.rs`
2. Add route handler in `crates/os-serve/src/routes/`
3. Add utoipa annotations for OpenAPI
4. Run `just openapi` to regenerate spec
5. Run `just openapi-ts` to regenerate TS client
6. Use in webapp

### Adding a New Domain Type

1. Add type in `crates/os-core/src/types/`
2. Add utoipa `ToSchema` derive for API-facing types
3. Add repository trait impl in `crates/os-db/`
4. Add SDK methods in `crates/os-core/src/`
5. Add CLI subcommand in `crates/os/src/cli/`

---

## File Size Guidelines

Agent-friendly codebase targets:

| Max Lines | File Type |
|-----------|-----------|
| 500 | Module file (e.g., `tasks.rs`) |
| 300 | Route handler file |
| 200 | Type definition file |
| 100 | Test file (per test module) |

**When exceeded:** Split into submodules, extract shared logic.

---

## Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Crate | `os-{name}` | `os-core`, `os-db` |
| Module | `snake_case` | `task_repo.rs` |
| Type | `PascalCase` | `CreateTaskInput` |
| Function | `snake_case` | `create_task` |
| Constant | `SCREAMING_SNAKE` | `DEFAULT_TIMEOUT` |
| Feature flag | `kebab-case` | `debug-embed` |
| CLI command | `noun verb` | `task create` |
| API route | `/api/{resource}` | `/api/tasks` |
| ID prefix | `{abbrev}_` | `ms_`, `task_`, `rev_` |

---

## Testing Strategy

| Level | Location | What |
|-------|----------|------|
| Unit | `crates/*/src/**/*.rs` | Inline `#[test]` modules |
| Integration | `tests/integration/` | Cross-crate, real SQLite |
| E2E | `tests/e2e/` | Full binary invocations |

**Test helpers:**
- `tests/fixtures/` — Sample repos (jj + git)
- `os-db` exposes `test_db()` for in-memory SQLite
- `os-vcs` exposes `TestRepo` for temp VCS repos

---

## Spec Index

| # | Spec | Status | Summary |
|---|------|--------|---------|
| 00 | `00-monorepo.md` | Draft v1 | Repo structure, build, CI/CD (this file) |
| 01 | `01-core-domain.md` | Draft v4 | Domain types, traits, invariants |
| 02 | `02-vcs.md` | Draft v1 | VCS backend, jj-lib + gix, stacking |
| 03 | `03-review.md` | Draft v1 | Review workflow, comments, phases |
| 03a | `03a-gates.md` | Draft v1 | Quality gates execution model |
| 04 | `04-events.md` | Draft v1 | Event bus, persistence, subscriptions |
| 05 | `05-relay.md` | Draft v1 | Agent harness broker, WebSocket |
| 06 | `06-git-ai.md` | Draft v1 | git-ai integration |
| 07 | `07-agent-primitives.md` | Draft v1 | Skills, commands, subagents for harnesses |
| 08 | `08-web-ui.md` | Draft v1 | Web UI local-first design and data layer |
| 09 | `09-mcp-rquickjs.md` | Draft v1 | MCP server + rquickjs execution |
| 10 | `10-system-integration.md` | Draft v1 | Cross-component integration, errors, tracing |
| 11 | `11-end-to-end-audit.md` | Draft v1 | Endpoint/entrypoint audit map |
| 12 | `12-feedback-loops.md` | Draft v1 | Agent feedback loop design + research |
| 13 | `13-implementation-guide.md` | Draft v1 | Build instructions for coding agents |

---

## Effort Estimates

| Component | Effort | Notes |
|-----------|--------|-------|
| Workspace + Cargo.toml scaffold | S | Structure, lints, profiles |
| os-core scaffold | M | Types + SDK API signatures |
| os-db scaffold | M | Schema + repo trait impls |
| os-vcs scaffold | M | Port existing, split crate |
| os-events scaffold | S | Types + simple bus |
| os-serve scaffold | M | Axum + routes + utoipa + rust-embed |
| os-mcp scaffold | M | rquickjs setup, API bindings |
| os binary | S | Clap, mode dispatch |
| Justfile | S | All recipes |
| CI/CD | M | GitHub Actions (ci + release) |
| OpenAPI pipeline | M | utoipa + openapi-typescript codegen |
| npm publishing | M | Scripts + package.json |
| Webapp scaffold | M | React + TanStack Query + generated client |

**Total: XL (3-5 days for full scaffold, ongoing refinement)**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| rquickjs perf for MCP | Medium | Benchmark early; fallback to native MCP if needed |
| jj-lib API breaks | High | Pin exact version, test on upgrade |
| rust-embed binary size | Low | Use compression feature; monitor size |
| OpenAPI codegen drift | Medium | CI job checks spec matches code |
| Cross-compilation | Medium | CI matrix covers all targets |

---

**Phase: DRAFT v1 | Status: Ready for implementation**
