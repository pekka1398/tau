# Using Tau

This page collects day-to-day usage details that do not fit on the quickstart page.

## Interactive Mode

The interface has four main areas:

- Startup header: shortcuts, loaded context files, prompt templates, skills, and extensions
- Messages: user messages, assistant responses, tool calls, tool results, notifications, and errors
- Editor: where you type; border color indicates the current thinking level
- Footer: working directory, session name, token/cache usage, cost, context usage, and current model

## Editor Features

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Press Tab to complete paths |
| Multi-line input | Shift+Enter |
| Images | Paste with Ctrl+V or drag into the terminal |
| Shell command | `!command` runs and sends output to the model |
| Hidden shell command | `!!command` runs without sending output to the model |
| External editor | Ctrl+G opens `$VISUAL` or `$EDITOR` |

See [Keybindings](keybindings.md) for all shortcuts and customization.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch OpenRouter models |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session file, ID, messages, tokens, and cost |
| `/tree` | Jump to any point in the session and continue from there |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, and context files |
| `/hotkeys` | Show keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit Tau |

## Project Trust

On interactive startup, Tau asks before trusting a project folder that contains project-local inputs and has no saved decision in `~/.tau/agent/trust.json`. Trusting a project allows Tau to read `AGENTS.md`, load `.tau/settings.json` and `.tau` resources, install missing project packages, and execute project extensions.

Use `/trust` in interactive mode to save a trust decision for future sessions. The current session is not reloaded, so restart Tau for changes to take effect.

## Sessions

Sessions are saved automatically to `~/.tau/agent/sessions/`, organized by working directory.

```bash
tau -c                  # Continue most recent session
tau -r                  # Browse and select a session
tau --no-session        # Ephemeral mode; do not save
tau --name "my task"    # Set session display name at startup
tau --session <path|id> # Use a specific session file or partial UUID
tau --fork <path|id>    # Fork a session file or partial UUID into a new session
```

## Context Files

Tau loads `AGENTS.md` at startup from:

- `~/.tau/agent/AGENTS.md` for global instructions
- parent directories, walking up from the current working directory when the project is trusted
- the current directory when the project is trusted

Disable loading with `--no-context-files` or `-nc`.

## CLI Reference

```bash
tau [options] [@files...] [messages...]
```

## Package Commands

```bash
tau install <source> [-l]       # Install package, -l for project-local
tau remove <source> [-l]        # Remove package
tau uninstall <source> [-l]     # Alias for remove
tau update [source|self|tau]    # Update Tau and packages
tau update --extensions         # Update packages only
tau update --self               # Update Tau only
tau update --extension <src>    # Update one package
tau list                        # List installed packages
tau config                      # Enable/disable package resources
```

## Modes

| Flag | Description |
|------|-------------|
| default | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines |
| `--mode rpc` | RPC mode over stdin/stdout |
| `--export <in> [out]` | Export a session to HTML |

In print mode, Tau also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | tau -p "Summarize this text"
```

## Model Options

| Option | Description |
|--------|-------------|
| `--provider openrouter` | Provider selection; OpenRouter is the only built-in provider |
| `--model <pattern>` | OpenRouter model pattern or ID, with optional `:<thinking>` |
| `--api-key <key>` | OpenRouter API key override |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `--models <patterns>` | Comma-separated OpenRouter model patterns for Ctrl+P cycling |
| `--list-models [search]` | List available OpenRouter models |

## Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools |

Core tools: `bash`, `subagent`, `transcribe`, and `vision`.

## Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load an extension from path, npm, or git; repeatable |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load a skill; repeatable |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load a prompt template; repeatable |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load a theme; repeatable |
| `--no-themes` | Disable theme discovery |
| `--no-context-files`, `-nc` | Disable `AGENTS.md` discovery |

## File Arguments

Prefix files with `@` to include them in the message:

```bash
tau @prompt.md "Answer this"
tau -p @screenshot.png "What's in this image?"
tau @code.ts @test.ts "Review these files"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `TAU_CODING_AGENT_DIR` | Override config directory; default is `~/.tau/agent` |
| `TAU_CODING_AGENT_SESSION_DIR` | Override session storage directory; overridden by `--session-dir` |
| `TAU_PACKAGE_DIR` | Override package directory, useful for Nix/Guix store paths |
| `TAU_OFFLINE` | Disable startup network operations |
| `TAU_SKIP_VERSION_CHECK` | Skip the Tau version update check at startup |
| `TAU_TELEMETRY` | Override install/update telemetry |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |
