# @earendil-works/tau-ai

OpenRouter-focused LLM and image APIs for Tau.

This package intentionally supports OpenRouter only. Direct provider integrations such as Anthropic, Google, Mistral, OpenAI Responses, Azure OpenAI, Amazon Bedrock, GitHub Copilot, and OAuth login flows are not part of Tau's AI package.

## Install

```bash
bun add @earendil-works/tau-ai
```

## Credentials

Set one API key:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

You can also pass `apiKey` per request.

## Chat

```ts
import { completeSimple, getModel } from "@earendil-works/tau-ai";

const model = getModel("openrouter", "openai/gpt-4o-mini");

const response = await completeSimple(
	model,
	{
		messages: [{ role: "user", content: "Write a concise haiku.", timestamp: Date.now() }],
	},
	{ apiKey: process.env.OPENROUTER_API_KEY },
);

console.log(response.content);
```

## Streaming

```ts
import { getModel, streamSimple } from "@earendil-works/tau-ai";

const model = getModel("openrouter", "anthropic/claude-sonnet-4.5");
const stream = streamSimple(
	model,
	{
		messages: [{ role: "user", content: "Summarize the current task.", timestamp: Date.now() }],
	},
	{ apiKey: process.env.OPENROUTER_API_KEY },
);

for await (const event of stream) {
	if (event.type === "text_delta") {
		process.stdout.write(event.delta);
	}
}
```

## Tools

```ts
import { Type, completeSimple, getModel } from "@earendil-works/tau-ai";

const model = getModel("openrouter", "openai/gpt-4o-mini");

const response = await completeSimple(
	model,
	{
		messages: [{ role: "user", content: "Call ping with ok=true.", timestamp: Date.now() }],
		tools: [
			{
				name: "ping",
				description: "Ping a test endpoint.",
				parameters: Type.Object({ ok: Type.Boolean() }),
			},
		],
	},
	{ apiKey: process.env.OPENROUTER_API_KEY, toolChoice: "required" },
);

console.log(response.stopReason, response.content);
```

## Images

```ts
import { generateImages, getImageModel } from "@earendil-works/tau-ai";

const model = getImageModel("openrouter", "google/gemini-2.5-flash-image");

const result = await generateImages(
	model,
	{
		input: [{ type: "text", text: "Generate a red circle on a white background." }],
	},
	{ apiKey: process.env.OPENROUTER_API_KEY },
);

console.log(result.output);
```

## Testing

The package keeps deterministic unit coverage for the OpenRouter chat-completions path, OpenRouter image request shaping, validation, proxy handling, and the faux test provider.

```bash
bun run --cwd packages/ai test
bun run --cwd packages/ai build
```
