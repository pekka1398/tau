# Quickstart

This page gets you from install to a useful first Tau session.

## Install

Tau is distributed as an npm package:

```bash
npm install -g --ignore-scripts @earendil-works/tau-coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Tau does not require install scripts for normal npm installs.

### Uninstall

Use the package manager that installed Tau:

```bash
npm uninstall -g @earendil-works/tau-coding-agent
pnpm remove -g @earendil-works/tau-coding-agent
yarn global remove @earendil-works/tau-coding-agent
bun uninstall -g @earendil-works/tau-coding-agent
```

Uninstalling Tau leaves settings, credentials, sessions, and local resources in `~/.tau/agent/`.

Then start Tau in the project directory you want it to work on:

```bash
cd /path/to/project
tau
```

## Authenticate

Tau uses OpenRouter only. Set an OpenRouter API key before launching:

```bash
export OPENROUTER_API_KEY=sk-or-...
tau
```

You can also store the key in `~/.tau/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "$OPENROUTER_API_KEY" }
}
```

See [Providers](providers.md) for model selection and OpenRouter routing settings.

## First Session

Once Tau starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

Tau gives the model four core tools:

- `bash` - run shell commands
- `subagent` - delegate work to specialized agents
- `transcribe` - convert files to readable text
- `vision` - inspect image files

Tau runs in your current working directory and can modify files there. Use git or another checkpointing workflow if you want easy rollback.

## Project Instructions

Tau loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Tau loads:

- `~/.tau/agent/AGENTS.md` for global instructions
- `AGENTS.md` from parent directories and the current directory

Restart Tau, or run `/reload`, after changing context files.

## Common Things To Try

### Reference Files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
tau @README.md "Summarize this"
tau @src/app.ts @src/app.test.ts "Review these together"
```

Images can be pasted with Ctrl+V or dragged into supported terminals.

### Run Shell Commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch Models

Use `/model` or Ctrl+L to choose an OpenRouter model. Use Shift+Tab to cycle thinking level. Use Ctrl+P / Shift+Ctrl+P to cycle through scoped models.

### Continue Later

Sessions are saved automatically:

```bash
tau -c                  # Continue most recent session
tau -r                  # Browse previous sessions
tau --name "my task"    # Set session display name at startup
tau --session <path|id> # Open a specific session
```

Inside Tau, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-Interactive Mode

For one-shot prompts:

```bash
tau -p "Summarize this codebase"
cat README.md | tau -p "Summarize this text"
tau -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next Steps

- [Using Tau](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - OpenRouter authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Extensions](extensions.md) - add local tools, commands, events, and custom UI.

Platform notes: [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
