# Settings

Tau uses JSON settings files with project settings overriding global settings.

| Location | Scope |
|----------|-------|
| `~/.tau/agent/settings.json` | Global |
| `.tau/settings.json` | Project |

Edit settings directly or use `/settings` for common interactive options.

## Project Trust

On interactive startup, Tau asks before trusting a project folder that contains project-local inputs and has no saved decision in `~/.tau/agent/trust.json`. Trusting a project allows Tau to read `AGENTS.md`, load `.tau/settings.json` and `.tau` resources, install missing project packages, and execute project extensions.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without a saved trust decision, they ignore project-local inputs unless `--approve`/`-a` is passed. Use `--no-approve`/`-na` to ignore project-local inputs for one run even when the project is trusted.

`tau config` assumes project trust for that command so you can view and change project resource settings before starting a session. It does not save a trust decision.

## Model And Thinking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | `"openrouter"` | Default provider. Tau supports OpenRouter only |
| `defaultModel` | string | first configured model | Default OpenRouter model ID |
| `defaultThinkingLevel` | string | `"off"` | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output |
| `thinkingBudgets` | object | - | Custom token budgets per thinking level |
| `serviceTier` | string | OpenRouter default | `"flex"` or `"priority"` |

```json
{
  "defaultProvider": "openrouter",
  "defaultModel": "xiaomi/mimo-v2.5-pro",
  "defaultThinkingLevel": "medium",
  "serviceTier": "flex"
}
```

## UI And Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | Theme name |
| `quietStartup` | boolean | `false` | Hide startup header |
| `collapseChangelog` | boolean | `false` | Show condensed changelog after updates |
| `doubleEscapeAction` | string | `"tree"` | `"tree"`, `"fork"`, or `"none"` |
| `treeFilterMode` | string | `"default"` | Default filter for `/tree` |
| `editorPaddingX` | number | `0` | Horizontal input editor padding |
| `autocompleteMaxVisible` | number | `5` | Max visible autocomplete items |
| `showHardwareCursor` | boolean | `false` | Show the terminal cursor while positioning it for IME support |

## Network And Updates

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableInstallTelemetry` | boolean | `true` | Send anonymous install/update version pings |
| `httpIdleTimeoutMs` | number | default dispatcher timeout | HTTP idle timeout |
| `websocketConnectTimeoutMs` | number | default dispatcher timeout | WebSocket connect timeout |

Set `TAU_SKIP_VERSION_CHECK=1` to disable version update checks. Use `--offline` or `TAU_OFFLINE=1` to disable startup network operations, including update checks, package update checks, and install/update telemetry.

## Retry

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | Enable automatic agent-level retry on transient errors |
| `retry.maxRetries` | number | `3` | Maximum agent-level retry attempts |
| `retry.baseDelayMs` | number | `2000` | Base delay for agent-level exponential backoff |
| `retry.provider.timeoutMs` | number | SDK default | Provider request timeout |
| `retry.provider.maxRetries` | number | `0` | Provider request retry attempts |
| `retry.provider.maxRetryDelayMs` | number | `60000` | Max server-requested retry delay before failing |

## Sessions

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sessionDir` | string | `~/.tau/agent/sessions` | Directory where session files are stored |

When multiple sources specify a session directory, precedence is `--session-dir`, `TAU_CODING_AGENT_SESSION_DIR`, then `sessionDir`.

## Model Cycling

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabledModels` | string[] | - | OpenRouter model patterns for Ctrl+P cycling |

```json
{
  "enabledModels": ["xiaomi/*", "anthropic/*"]
}
```

## Resources

These settings define where to load extensions, skills, prompts, and themes from. Paths in `~/.tau/agent/settings.json` resolve relative to `~/.tau/agent`; paths in `.tau/settings.json` resolve relative to `.tau`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `packages` | array | `[]` | npm/git packages to load resources from |
| `extensions` | string[] | `[]` | Local extension file paths or directories |
| `skills` | string[] | `[]` | Local skill file paths or directories |
| `prompts` | string[] | `[]` | Local prompt template paths or directories |
| `themes` | string[] | `[]` | Local theme file paths or directories |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands |

Arrays support glob patterns and exclusions. Use `!pattern` to exclude. Use `+path` to force-include an exact path and `-path` to force-exclude an exact path.

## Terminal

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | Show inline images when supported |
| `terminal.imageWidthCells` | number | `60` | Preferred inline image width |
| `terminal.clearOnShrink` | boolean | `false` | Clear rows when content shrinks |
| `terminal.showTerminalProgress` | boolean | `false` | Emit terminal progress indicators |
| `terminal.showSemanticZones` | boolean | `false` | Emit OSC 133 semantic zones |

## Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `images.autoResize` | boolean | `true` | Resize images before sending to the model |
| `images.blockImages` | boolean | `false` | Prevent images from being sent to the model |

## Project Overrides

Project settings merge over global settings:

```json
// ~/.tau/agent/settings.json
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}
```

```json
// .tau/settings.json
{
  "compaction": { "reserveTokens": 8192 }
}
```
