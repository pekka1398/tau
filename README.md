# Tau

AI coding agent. Fork of [pi](https://github.com/earendil-works/pi), evolved into its own thing.

## What is Tau?

Tau is a terminal-based AI coding agent that uses bash as its primary tool. It runs in your terminal, reads and writes files, executes shell commands, and delegates tasks to sub-agents.

**Key features:**
- **Bash-only architecture** — all file operations through a sandboxed shell (ai-dash)
- **Sub-agent system** — fork mode, worktree isolation, tool inheritance, transcript persistence
- **OpenRouter-only LLM access** — one provider surface for chat, images, and model routing
- **Bun runtime** — compiled to a single 96MB binary, no Node.js required
- **TUI** — interactive terminal UI with themes, keybindings, streaming output
- **Project management** — built-in todo system and auto-generated roadmap

## Quick Start

```bash
# Install
npm install -g

# Or use the compiled binary
tau --version

# Run interactively
tau

# Run a single command
tau -p "Read package.json and tell me the version"

# Project management
tau todo list
tau todo add "Fix the bug" --priority high --tag bug
```

## Architecture

```
packages/coding-agent    Main Tau CLI/app, including AI access and agent runtime
packages/tui             Terminal UI components (Ink-based)
packages/ai-dash         Sandboxed shell (C, modified dash)
```

## Tools

Tau has 4 core tools:
- **bash** — Execute shell commands via ai-dash (sandboxed)
- **subagent** — Delegate tasks to specialized agents (fork/parallel/chain)
- **transcribe** — Convert files to readable text (PDF, images, audio, etc.)
- **vision** — Read and see image files directly

## Building

```bash
# Build all packages
bun run build

# Build standalone binary
cd packages/coding-agent && bun run build:binary

# Lint + type check
bun run check
```

## License

MIT
