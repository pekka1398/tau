#!/bin/bash
# Build ai-dash (modified dash shell) from source.
# Requires: musl-gcc (from musl-tools/musl-dev), make, autotools (autoconf, automake)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CC="${CC:-musl-gcc}"

echo "==> Using CC=$CC"
echo "==> Running autogen..."
./autogen.sh

echo "==> Running configure (static)..."
CC="$CC" CFLAGS="-static" LDFLAGS="-static" ./configure --quiet

echo "==> Building..."
make -j"$(nproc)"

echo "==> Copying binary to bin/..."
mkdir -p bin
cp -f src/dash bin/ai-dash
chmod +x bin/ai-dash

echo "==> Done: bin/ai-dash"
file bin/ai-dash
ls -lh bin/ai-dash
