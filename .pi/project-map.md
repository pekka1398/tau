# PI Monorepo - Project Map

## Overview

**PI** is an AI coding agent monorepo (`pi-monorepo` v0.0.3) built as an npm workspace. It provides a CLI-based coding assistant powered by LLMs with a rich TUI (Terminal UI), multi-provider AI support, and an extensible agent framework. Requires Node.js >= 22.19.0.

## Packages

| Package | Name | Version | Description |
|---------|------|---------|-------------|
| `packages/tui` | `@earendil-works/pi-tui` | 0.78.1 | Terminal UI library with differential rendering |
| `packages/ai` | `@earendil-works/pi-ai` | 0.78.1 | Unified LLM API with multi-provider support |
| `packages/agent` | `@earendil-works/pi-agent-core` | 0.78.1 | General-purpose agent framework with transport abstraction |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | 0.78.1 | Main coding agent CLI (`pi` command) |
| `packages/ai-dash` | `ai-dash` | 0.1.0 | Enhanced POSIX shell (bash replacement for safety) |

## Dependency Graph

```
coding-agent ──> agent-core ──> ai
     │              │
     ├──> tui       │
     └──> ai-dash   └──> ai
```

## Package Details

### `packages/tui` — Terminal UI Library
- **Purpose**: Low-level terminal rendering with differential updates
- **Key files**: `src/tui.ts` (52KB, main TUI engine), `src/terminal.ts`, `src/keys.ts`
- **Components**: `editor`, `input`, `markdown`, `text`, `image`, `loader`, `box`, `select-list`, `settings-list`, `spacer`, `truncated-text`, `cancellable-loader`
- **Utilities**: `autocomplete.ts`, `fuzzy.ts`, `keybindings.ts`, `stdin-buffer.ts`, `terminal-image.ts`, `word-navigation.ts`, `kill-ring.ts`, `undo-stack.ts`
- **Dependencies**: `get-east-asian-width`, `marked`

### `packages/ai` — Unified LLM API
- **Purpose**: Abstracted LLM provider layer with streaming, model discovery, and auto-configuration
- **Key files**: `src/types.ts` (core types), `src/stream.ts`, `src/models.ts`, `src/api-registry.ts`
- **Providers** (lazy-loaded via `register-builtins.ts`):
  - `openai-completions` — OpenAI-compatible completions API (base for many providers)
  - Separate npm exports for: `anthropic`, `google`, `google-vertex`, `mistral`, `openai-responses`, `openai-codex-responses`, `azure-openai-responses`, `bedrock-provider`
- **Features**: Image generation (`images.ts`, `image-models.ts`), OAuth support, session resources, env-based API key resolution
- **Generated**: `models.generated.ts` (110KB), `image-models.generated.ts`
- **Dependencies**: `@anthropic-ai/sdk`, `@google/genai`, `@mistralai/mistralai`, `openai`, `@aws-sdk/client-bedrock-runtime`, `typebox`

### `packages/agent` — Agent Core Framework
- **Purpose**: General-purpose agent loop with tool execution, state management, and sub-agent support
- **Key files**: `src/agent.ts` (main agent), `src/agent-loop.ts` (execution loop), `src/types.ts`, `src/subagent.ts`, `src/proxy.ts`
- **Exports**: `index.ts` (main), `node.ts` (Node.js-specific)
- **Sub-systems**: `harness/` (test harness for agent testing)
- **Dependencies**: `pi-ai`, `ignore`, `typebox`, `yaml`

### `packages/coding-agent` — Main CLI Application
- **Purpose**: The `pi` command — a full coding agent with file editing, bash execution, session management
- **Entry**: `src/cli.ts` → `src/main.ts`
- **Core** (`src/core/`):
  - `agent-session.ts` — Main session orchestration
  - `agent-session-runtime.ts` / `agent-session-services.ts` — Runtime DI
  - `tools/` — Tool implementations: `bash.ts` (shell execution), `index.ts`, `truncate.ts`, `path-utils.ts`, `render-utils.ts`
  - `extensions/` — Plugin system: `types.ts`, `loader.ts`, `runner.ts`, `wrapper.ts`
  - `compaction/` — Context window management: `compaction.ts`, `branch-summarization.ts`
  - `session-manager.ts` — Session persistence
  - `model-registry.ts` / `model-resolver.ts` — Model selection
  - `system-prompt.ts` / `prompt-templates.ts` — Prompt engineering
  - `settings-manager.ts` — User settings
  - `trust-manager.ts` — Project trust/security
  - `skills.ts` — Skill file loading
  - `slash-commands.ts` — `/command` handling
  - `bash-executor.ts` — Bash tool implementation
  - `discord-bridge.ts` — Discord integration
- **Modes** (`src/modes/`):
  - `interactive/` — Full TUI mode with rich components (assistant messages, bash execution, diffs, model selector, footer, theme, etc.)
  - `print-mode.ts` — Non-interactive output
  - `rpc/` — RPC mode for programmatic access
- **CLI** (`src/cli/`): `args.ts`, `config-selector.ts`, `session-picker.ts`, `list-models.ts`, `file-processor.ts`
- **Utils**: `git.ts`, `shell.ts`, `image-resize.ts`, `clipboard.ts`, `syntax-highlight.ts`, `html.ts`, `paths.ts`, etc.
- **Dependencies**: `pi-agent-core`, `pi-ai`, `pi-tui`, `ai-dash`, `chalk`, `diff`, `discord.js`, `glob`, `highlight.js`, `jiti`, `yaml`

### `packages/ai-dash` — Safe Shell
- **Purpose**: Enhanced POSIX shell that wraps bash with safety features
- **Features**: Blocks dangerous commands (vim, reboot, mkfs, dd), intercepts `rm` to trash, blocks `rm -rf` on system paths, suggests missing flags, built-in `edit` command
- **Implementation**: C source (`src/`), compiled binary (`bin/ai-dash`)

## Build Order

```
tui → ai → agent → coding-agent
```

## Other Directories

- `note/` — Design docs and notes (roadmap, security, agents, ollama, ai-dash design)
- `reference-repo/` — Reference implementation
- `scripts/` — Build/release/CI scripts
- `test/` — Root-level tests
- `.pi/` — PI configuration directory
- `.husky/` — Git hooks

## Key Technologies

- TypeScript (tsgo compiler), ESM modules
- Vitest for testing
- Biome for linting/formatting
- esbuild for bundling
- Husky for git hooks
- npm workspaces for monorepo management
