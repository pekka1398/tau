# Custom Models

Tau uses OpenRouter as its only built-in provider. `models.json` is for controlling which OpenRouter models Tau exposes, adding local display metadata, or narrowing model cycling scopes. It is not a way to add direct provider SDKs.

The user-level file is `~/.tau/agent/models.json`.

## Minimal Example

```json
{
  "providers": {
    "openrouter": {
      "models": [
        { "id": "xiaomi/mimo-v2.5-pro" },
        { "id": "anthropic/claude-sonnet-4.5" },
        { "id": "openai/gpt-5.1" }
      ]
    }
  }
}
```

Tau fetches OpenRouter's model list during the AI package build. Entries in `models.json` can override or supplement local metadata for those OpenRouter model IDs.

## Full Example

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        {
          "id": "xiaomi/mimo-v2.5-pro",
          "name": "MiMo V2.5 Pro",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 262144,
          "maxTokens": 32768,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

The file reloads each time you open `/model`. Edit during a session; no restart is needed.

## Provider Configuration

Only the `openrouter` provider is supported.

| Field | Description |
|-------|-------------|
| `apiKey` | Optional key value or environment reference. Defaults to `OPENROUTER_API_KEY` through normal auth resolution |
| `headers` | Optional custom request headers |
| `models` | Array of OpenRouter model metadata overrides |
| `modelOverrides` | Per-model metadata overrides for generated OpenRouter models |

### Value Resolution

The `apiKey` and `headers` fields support command execution, environment interpolation, and literals:

- Shell command: `"!command"` executes the command and uses stdout.
- Environment interpolation: `"$ENV_VAR"` or `"${ENV_VAR}"` uses the named environment variable.
- Escapes: `"$$"` emits a literal `$`; `"$!"` emits a literal `!`.
- Literal value: any other string is used directly.

For `models.json`, shell commands are resolved at request time. Tau does not add TTL, stale reuse, or recovery behavior for arbitrary commands.

## Model Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | - | OpenRouter model identifier |
| `name` | No | `id` | Human-readable model label |
| `reasoning` | No | generated metadata or `false` | Supports extended thinking |
| `thinkingLevelMap` | No | omitted | Maps Tau thinking levels to provider values and marks unsupported levels |
| `input` | No | generated metadata or `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | generated metadata or `128000` | Context window size in tokens |
| `maxTokens` | No | generated metadata or `16384` | Maximum output tokens |
| `cost` | No | generated metadata or zeros | Cost per million tokens |
| `compat` | No | generated metadata | OpenRouter Chat Completions compatibility flags |

## Thinking Level Map

Use `thinkingLevelMap` on a model to describe model-specific thinking controls. Keys are Tau thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

Values are tristate:

- string: provider value to send for that level.
- null: level is unsupported and will not be offered.
- omitted: use Tau's default mapping.

```json
{
  "providers": {
    "openrouter": {
      "models": [
        {
          "id": "example/reasoning-model",
          "reasoning": true,
          "thinkingLevelMap": {
            "off": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": null
          }
        }
      ]
    }
  }
}
```

## Scoped Models

Use `enabledModels` in settings to limit Ctrl+P model cycling:

```json
{
  "enabledModels": ["xiaomi/*", "openai/*"]
}
```

Patterns match OpenRouter model IDs and display names.
