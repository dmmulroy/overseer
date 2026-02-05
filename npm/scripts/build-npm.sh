#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
DIST_DIR="$ROOT_DIR/npm/overseer/bin"

mkdir -p "$DIST_DIR"

echo "Place release binaries into $DIST_DIR before publish."
