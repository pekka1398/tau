# Providers

Tau uses OpenRouter as its only built-in LLM provider.

## Authentication

Set `OPENROUTER_API_KEY` before starting Tau:

```bash
export OPENROUTER_API_KEY=sk-or-...
tau
```

Tau also supports storing the key in `~/.tau/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "$OPENROUTER_API_KEY" }
}
```

The auth file is created with user-only permissions when Tau writes it. Environment interpolation is supported, so storing `$OPENROUTER_API_KEY` keeps the secret outside the file.

## Model Selection

Use OpenRouter model IDs directly:

```bash
tau --provider openrouter --model xiaomi/mimo-v2.5-pro
tau --provider openrouter --model anthropic/claude-sonnet-4.5
tau --provider openrouter --model openai/gpt-5.1
```

In interactive mode, use `/model` or Ctrl+L to choose from configured OpenRouter models.

## Settings

Set defaults in `~/.tau/agent/settings.json`:

```json
{
  "defaultProvider": "openrouter",
  "defaultModel": "xiaomi/mimo-v2.5-pro",
  "serviceTier": "flex"
}
```

`serviceTier` maps to OpenRouter routing tiers. Use `"flex"` for lower cost and higher latency, `"priority"` for lower latency and higher cost, or omit it for OpenRouter's default.

## Custom Models

Tau keeps one provider implementation, but you can add or narrow model entries with `models.json` when you need local aliases, scoped model lists, or custom metadata. See [Custom Models](models.md).
