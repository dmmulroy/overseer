default: check

check: fmt-check lint test

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all -- --check

lint:
    cargo clippy --workspace --all-targets -- -D warnings

test:
    cargo test --workspace

test-crate crate:
    cargo test -p {{crate}}

build:
    cargo build --workspace

build-release: webapp-build
    cargo build --release

dev:
    cargo watch -x 'run -- serve'

mcp:
    cargo run -- mcp

openapi:
    cargo run --release -- openapi > openapi/overseer.yaml

openapi-ts: openapi
    cd webapp && pnpm exec openapi-typescript ../openapi/overseer.yaml -o src/api/schema.ts

webapp-install:
    cd webapp && pnpm install

webapp-dev:
    cd webapp && pnpm run dev

webapp-build:
    cd webapp && pnpm run build

dev-full:
    just dev &
    just webapp-dev

release: webapp-build
    cargo build --release

release-npm:
    ./npm/scripts/build-npm.sh

clean:
    cargo clean
    rm -rf webapp/dist
    rm -rf webapp/src/api/schema.ts

update:
    cargo update

completions shell:
    cargo run -- completions {{shell}}
