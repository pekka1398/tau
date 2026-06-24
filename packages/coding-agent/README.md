# Tau Coding Agent

The main coding agent package. Provides a terminal-based AI coding agent with bash, sub-agent, transcribe, and vision tools.

## Install

```bash
npm install -g
```

Or use the compiled binary (no Node.js required):

```bash
tau --version
```

## Usage

```bash
# Interactive mode
tau

# Single command
tau -p "What does this project do?"

# Pipe input
cat error.log | tau -p "Explain this error"

# JSON output
tau --mode json "List all TypeScript files"
```

## Tools

| Tool | Description |
|------|-------------|
| **bash** | Execute shell commands via ai-dash (sandboxed) |
| **subagent** | Delegate tasks to specialized agents |
| **transcribe** | Convert files to readable text |
| **vision** | Read and see image files |

## Sub-agent System

```bash
# Fork mode — inherits parent context
{ task: "review this code" }

# Named agent
{ agent: "explore", task: "find all API endpoints" }

# Parallel
{ tasks: [{ agent: "explore", task: "..." }, ...] }

# Chain
{ chain: [{ agent: "...", task: "... {previous} ..." }] }
```

## Configuration

Settings stored in `~/.tau/agent/settings.json`:

```json
{
  "defaultProvider": "openrouter",
  "defaultModel": "xiaomi/mimo-v2.5-pro",
  "serviceTier": "flex"
}
```

## Development

```bash
bun run build          # Build all packages
bun run build:binary   # Build standalone binary
bun run check          # Lint + type check
bun run test           # Run tests
```

## License

MIT
