#!/bin/bash
# Build ai-dash (modified dash shell) from source.
# Requires: gcc (or cc), make, autotools (autoconf, automake)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Running autogen..."
./autogen.sh

echo "==> Running configure (static)..."
CFLAGS="-static" LDFLAGS="-static" ./configure

echo "==> Building..."
make -j"$(nproc)"

echo "==> Copying binary to bin/..."
mkdir -p bin
cp -f src/dash bin/ai-dash
chmod +x bin/ai-dash

echo "==> Done: bin/ai-dash"
ls -lh bin/ai-dash
