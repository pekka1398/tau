import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	registerApiProvider,
	type SimpleStreamOptions,
	unregisterApiProviders,
} from "../src/core/ai/index.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("createAgentSession provider attribution headers", () => {
	const CAPTURE_API = "capture-openrouter-attribution";

	let tempDir: string;
	let cwd: string;
	let agentDir: string;
	let originalTauTelemetryEnv: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `tau-sdk-attribution-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		originalTauTelemetryEnv = process.env.TAU_TELEMETRY;
		delete process.env.TAU_TELEMETRY;
	});

	afterEach(() => {
		if (originalTauTelemetryEnv === undefined) {
			delete process.env.TAU_TELEMETRY;
		} else {
			process.env.TAU_TELEMETRY = originalTauTelemetryEnv;
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(provider: string, baseUrl: string, id = `${provider}-test-model`): Model<Api> {
		return {
			id,
			name: `${provider} Test Model`,
			api: CAPTURE_API,
			provider,
			baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
	}

	function createDoneStream() {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: CAPTURE_API,
			provider: "capture-provider",
			model: "capture-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.end(message);
		return stream;
	}

	async function captureHeaders(
		model: Model<Api>,
		options: {
			telemetryEnabled?: boolean;
			providerHeaders?: Record<string, string>;
			requestHeaders?: Record<string, string>;
			sessionId?: string;
		} = {},
	): Promise<Record<string, string> | undefined> {
		const settingsManager = SettingsManager.create(cwd, agentDir);
		if (options.telemetryEnabled === false) {
			settingsManager.setEnableInstallTelemetry(false);
		}

		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey(model.provider, "test-api-key");
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const sourceId = `test:${CAPTURE_API}`;
		let capturedOptions: SimpleStreamOptions | undefined;

		registerApiProvider(
			{
				api: CAPTURE_API,
				stream: (_model, _context, providerOptions) => {
					capturedOptions = providerOptions as SimpleStreamOptions;
					return createDoneStream();
				},
				streamSimple: (_model, _context, providerOptions) => {
					capturedOptions = providerOptions;
					return createDoneStream();
				},
			},
			sourceId,
		);

		if (options.providerHeaders) {
			modelRegistry.registerProvider(model.provider, { headers: options.providerHeaders });
		}

		const sessionManager = SessionManager.inMemory(cwd);
		if (options.sessionId) {
			sessionManager.newSession({ id: options.sessionId });
		}

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			authStorage,
			modelRegistry,
			settingsManager,
			sessionManager,
		});

		try {
			await session.agent.streamFn(
				model,
				{ messages: [] },
				{
					sessionId: session.sessionId,
					...(options.requestHeaders ? { headers: options.requestHeaders } : {}),
				},
			);
			return capturedOptions?.headers;
		} finally {
			session.dispose();
			unregisterApiProviders(sourceId);
			if (options.providerHeaders) {
				modelRegistry.unregisterProvider(model.provider);
			}
		}
	}

	it("adds default attribution headers for OpenRouter models", async () => {
		const headers = await captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"));

		expect(headers?.["HTTP-Referer"]).toBe("https://tau.dev");
		expect(headers?.["X-OpenRouter-Title"]).toBe("tau");
		expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
	});

	it("does not add attribution headers when telemetry is disabled", async () => {
		const headers = await captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
			telemetryEnabled: false,
		});

		expect(headers?.["HTTP-Referer"]).toBe("https://tau.dev");
		expect(headers?.["X-OpenRouter-Title"]).toBe("tau");
		expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
	});

	it("lets provider and request headers override the defaults", async () => {
		const headers = await captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
			providerHeaders: {
				"HTTP-Referer": "https://provider.example",
				"X-OpenRouter-Categories": "provider-category",
			},
			requestHeaders: {
				"X-OpenRouter-Title": "request-title",
			},
		});

		expect(headers?.["HTTP-Referer"]).toBe("https://provider.example");
		expect(headers?.["X-OpenRouter-Title"]).toBe("request-title");
		expect(headers?.["X-OpenRouter-Categories"]).toBe("provider-category");
	});

	it("does not add NVIDIA NIM attribution headers for NVIDIA models routed through OpenRouter", async () => {
		const headers = await captureHeaders(
			createModel("openrouter", "https://openrouter.ai/api/v1", "nvidia/nemotron-3-super-120b-a12b"),
		);

		expect(headers?.["HTTP-Referer"]).toBe("https://tau.dev");
		expect(headers?.["X-BILLING-INVOKE-ORIGIN"]).toBeUndefined();
	});
});
