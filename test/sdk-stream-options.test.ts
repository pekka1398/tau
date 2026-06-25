import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

describe("createAgentSession stream options", () => {
	const CAPTURE_API = "capture-stream-options";

	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "tau-sdk-stream-options-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(): Model<Api> {
		return {
			id: "capture-model",
			name: "Capture Model",
			api: CAPTURE_API,
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
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
			provider: "openrouter",
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

	async function captureStreamOptions(
		settings: { httpIdleTimeoutMs?: number; websocketConnectTimeoutMs?: number },
		requestOptions: SimpleStreamOptions = {},
	): Promise<SimpleStreamOptions | undefined> {
		const model = createModel();
		const settingsManager = SettingsManager.inMemory(settings);

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

		const sessionManager = SessionManager.inMemory(cwd);
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
			await session.agent.streamFn(model, { messages: [] }, requestOptions);
			return capturedOptions;
		} finally {
			session.dispose();
			unregisterApiProviders(sourceId);
		}
	}

	it("forwards httpIdleTimeoutMs as timeoutMs", async () => {
		const options = await captureStreamOptions({ httpIdleTimeoutMs: 1234 });

		expect(options?.timeoutMs).toBe(1234);
	});

	it("defaults timeoutMs from httpIdleTimeoutMs for all providers", async () => {
		const options = await captureStreamOptions({ httpIdleTimeoutMs: 1234 });

		expect(options?.timeoutMs).toBe(1234);
	});

	it("lets request timeoutMs override httpIdleTimeoutMs", async () => {
		const options = await captureStreamOptions({ httpIdleTimeoutMs: 1234 }, { timeoutMs: 0 });

		expect(options?.timeoutMs).toBe(0);
	});

	it("forwards websocketConnectTimeoutMs from settings", async () => {
		const options = await captureStreamOptions({ websocketConnectTimeoutMs: 1234 });

		expect(options?.websocketConnectTimeoutMs).toBe(1234);
	});

	it("lets request websocketConnectTimeoutMs override settings", async () => {
		const options = await captureStreamOptions({ websocketConnectTimeoutMs: 1234 }, { websocketConnectTimeoutMs: 0 });

		expect(options?.websocketConnectTimeoutMs).toBe(0);
	});
});
