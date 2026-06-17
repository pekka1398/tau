#!/usr/bin/env bash
#
# Package tau into a portable, self-contained directory.
#
# Usage:
#   ./scripts/package-portable.sh [--skip-build] [--out <dir>]

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

OUT_DIR="dist"
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build) SKIP_BUILD=true; shift ;;
        --out) OUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ "$SKIP_BUILD" == "false" ]]; then
    echo "==> Building tau binary..."
    npm --prefix packages/coding-agent run build:binary
fi

echo ""
echo "==> Packaging portable directory: $OUT_DIR/"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── Core binaries ──────────────────────────────────────────────
cp packages/coding-agent/dist/tau "$OUT_DIR/tau"
chmod +x "$OUT_DIR/tau"

cp packages/coding-agent/dist/ai-dash "$OUT_DIR/ai-dash"
chmod +x "$OUT_DIR/ai-dash"

# ── Assets ─────────────────────────────────────────────────────
cp -r packages/coding-agent/dist/theme "$OUT_DIR/" 2>/dev/null || true
cp -r packages/coding-agent/dist/assets "$OUT_DIR/" 2>/dev/null || true
cp -r packages/coding-agent/dist/core "$OUT_DIR/" 2>/dev/null || true
cp packages/coding-agent/dist/*.wasm "$OUT_DIR/" 2>/dev/null || true

# ── Config directory ───────────────────────────────────────────
AGENT_DIR="$OUT_DIR/agent"
mkdir -p "$AGENT_DIR"

TAU_AGENT="$HOME/.tau/agent"
[[ -f "$TAU_AGENT/settings.json" ]] && cp "$TAU_AGENT/settings.json" "$AGENT_DIR/" && echo "  Copied settings.json"
[[ -f "$TAU_AGENT/auth.json" ]] && cp "$TAU_AGENT/auth.json" "$AGENT_DIR/" && echo "  Copied auth.json"
[[ -f "$TAU_AGENT/trust.json" ]] && cp "$TAU_AGENT/trust.json" "$AGENT_DIR/" && echo "  Copied trust.json"

if [[ -f "$HOME/.tau/models.json" ]]; then
    cp "$HOME/.tau/models.json" "$AGENT_DIR/"
    echo "  Copied models.json"
elif [[ -f "$HOME/.pi/models.json" ]]; then
    cp "$HOME/.pi/models.json" "$AGENT_DIR/"
    echo "  Copied models.json (from ~/.pi)"
fi

# ── .env ───────────────────────────────────────────────────────
if [[ -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env" "$OUT_DIR/.env"
    echo "  Copied .env"
else
    cat << 'ENV' > "$OUT_DIR/.env"
# Required: OpenRouter API key
OPENROUTER_API_KEY=

# Optional: Discord bridge (leave empty to disable)
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
ENV
    echo "  Created .env template"
fi

# ── Wrapper ────────────────────────────────────────────────────
cat << 'WRAPPER' > "$OUT_DIR/tau.sh"
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi
export TAU_CODING_AGENT_DIR="$SCRIPT_DIR/agent"
cd "$SCRIPT_DIR"
exec "$SCRIPT_DIR/tau" "$@"
WRAPPER
chmod +x "$OUT_DIR/tau.sh"

echo ""
echo "==> Done! $OUT_DIR/"
ls -lh "$OUT_DIR/"
echo ""
echo "Usage:  cd $OUT_DIR && ./tau.sh"
