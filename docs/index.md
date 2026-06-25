# Tau Documentation

Tau is a terminal coding harness built around a single OpenRouter provider surface. It stays small at the core while being extended through local TypeScript extensions, skills, prompt templates, and themes.

## Quick Start

Install Tau with npm:

```bash
npm install -g --ignore-scripts @earendil-works/tau-coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Tau does not require install scripts for normal npm installs.

Then set an OpenRouter API key and run it in a project directory:

```bash
export OPENROUTER_API_KEY=sk-or-...
cd /path/to/project
tau
```

For the full first-run flow, see [Quickstart](quickstart.md).

## Start Here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Using Tau](usage.md) - interactive mode, slash commands, context files, and CLI reference.
- [Providers](providers.md) - OpenRouter authentication and model setup.
- [Containerization](containerization.md) - sandbox Tau with OpenShell, Gondolin, or Docker.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](skills.md) - Agent Skills for reusable on-demand capabilities.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Custom models](models.md) - add or scope OpenRouter model entries.

## Programmatic Usage

- [SDK](sdk.md) - embed Tau in Node.js applications.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.

## Platform Setup

- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, project structure, and debugging.
