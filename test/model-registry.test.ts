import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OpenRouterChatCompat } from "../src/core/ai/index.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache, ModelRegistry, type ProviderConfigInput } from "../src/core/model-registry.ts";
import { clearDeprecationWarningsForTests } from "../src/utils/deprecation.ts";

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

describe("ModelRegistry", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `tau-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		delete process.env.OPENROUTER_API_KEY;
		clearDeprecationWarningsForTests();
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearApiKeyCache();
		clearDeprecationWarningsForTests();
		vi.restoreAllMocks();
		if (originalOpenRouterApiKey === undefined) {
			delete process.env.OPENROUTER_API_KEY;
		} else {
			process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
		}
	});

	function writeRawModelsJson(providers: Record<string, unknown>) {
		writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	function getModelsForProvider(registry: ModelRegistry, provider: string) {
		return registry.getAll().filter((model) => model.provider === provider);
	}

	function toShPath(value: string): string {
		return value.replace(/\\/g, "/").replace(/"/g, '\\"');
	}

	function modelConfig(id: string, overrides: Partial<ProviderConfigInput["models"][number]> = {}) {
		return {
			id,
			name: overrides.name ?? id,
			reasoning: overrides.reasoning ?? false,
			input: overrides.input ?? ["text"],
			cost: overrides.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: overrides.contextWindow ?? 128000,
			maxTokens: overrides.maxTokens ?? 8192,
			...overrides,
		} satisfies ProviderConfigInput["models"][number];
	}

	function providerWithApiKey(apiKey: string) {
		return {
			baseUrl: "https://example.com/v1",
			apiKey,
			api: "openrouter-chat",
			models: [modelConfig("test-model")],
		};
	}

	describe("OpenRouter built-ins", () => {
		test("loads only OpenRouter built-in models", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const providers = new Set(registry.getAll().map((model) => model.provider));

			expect(providers).toEqual(new Set(["openrouter"]));
			expect(registry.find("openrouter", "anthropic/claude-sonnet-4.5")).toBeDefined();
			expect(registry.find("openrouter", "openai/gpt-4o-mini")).toBeDefined();
			expect(registry.find("anthropic", "claude-sonnet-4.5")).toBeUndefined();
		});

		test("baseUrl override applies to every OpenRouter built-in model", () => {
			writeRawModelsJson({
				openrouter: { baseUrl: "https://proxy.example.com/v1" },
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const models = getModelsForProvider(registry, "openrouter");

			expect(models.length).toBeGreaterThan(1);
			expect(models.every((model) => model.baseUrl === "https://proxy.example.com/v1")).toBe(true);
		});

		test("headers-only override resolves at request time", async () => {
			writeRawModelsJson({
				openrouter: {
					headers: {
						"X-OpenRouter-Test": "enabled",
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");

			expect(model).toBeDefined();
			const auth = await registry.getApiKeyAndHeaders(model!);
			expect(auth).toEqual({
				ok: true,
				headers: { "X-OpenRouter-Test": "enabled" },
			});
		});

		test("refresh picks up OpenRouter baseUrl override changes", () => {
			writeRawModelsJson({
				openrouter: { baseUrl: "https://first.example.com/v1" },
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.find("openrouter", "anthropic/claude-sonnet-4.5")?.baseUrl).toBe(
				"https://first.example.com/v1",
			);

			writeRawModelsJson({
				openrouter: { baseUrl: "https://second.example.com/v1" },
			});
			registry.refresh();

			expect(registry.find("openrouter", "anthropic/claude-sonnet-4.5")?.baseUrl).toBe(
				"https://second.example.com/v1",
			);
		});
	});

	describe("models.json custom models", () => {
		test("OpenRouter custom models inherit built-in api and baseUrl", () => {
			writeRawModelsJson({
				openrouter: {
					models: [
						{
							id: "local/custom-model",
							name: "Custom OpenRouter Model",
							reasoning: true,
							input: ["text"],
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "local/custom-model");

			expect(registry.getError()).toBeUndefined();
			expect(model).toMatchObject({
				api: "openrouter-chat",
				baseUrl: "https://openrouter.ai/api/v1",
				provider: "openrouter",
				reasoning: true,
			});
		});

		test("custom model with same id replaces the built-in OpenRouter model", () => {
			writeRawModelsJson({
				openrouter: {
					baseUrl: "https://proxy.example.com/v1",
					models: [
						modelConfig("anthropic/claude-sonnet-4.5", {
							name: "Overridden Sonnet",
							api: "openrouter-chat",
							baseUrl: "https://model.example.com/v1",
						}),
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const matches = getModelsForProvider(registry, "openrouter").filter(
				(model) => model.id === "anthropic/claude-sonnet-4.5",
			);

			expect(matches).toHaveLength(1);
			expect(matches[0]).toMatchObject({
				name: "Overridden Sonnet",
				baseUrl: "https://model.example.com/v1",
			});
		});

		test("non-OpenRouter providers are rejected in models.json", () => {
			writeRawModelsJson({
				"local-proxy": {
					api: "openrouter-chat",
					models: [{ id: "local-model", input: ["text"] }],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getError()).toContain('only supports the "openrouter" provider');
			expect(registry.find("local-proxy", "local-model")).toBeUndefined();
		});

		test("non-OpenRouter providers are rejected even when fully configured", () => {
			writeRawModelsJson({
				"local-proxy": {
					baseUrl: "http://localhost:11434/v1",
					apiKey: "local-key",
					api: "openrouter-chat",
					models: [modelConfig("local-model", { name: "Local Model" })],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getError()).toContain('only supports the "openrouter" provider');
			expect(registry.find("local-proxy", "local-model")).toBeUndefined();
		});
	});

	describe("modelOverrides", () => {
		test("model override applies to a single OpenRouter model", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4.5": {
							name: "Preferred Sonnet",
							cost: { input: 1 },
							compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const sonnet = registry.find("openrouter", "anthropic/claude-sonnet-4.5");
			const gpt = registry.find("openrouter", "openai/gpt-4o-mini");

			expect(sonnet?.name).toBe("Preferred Sonnet");
			expect(sonnet?.cost.input).toBe(1);
			expect((sonnet?.compat as OpenRouterChatCompat | undefined)?.openRouterRouting).toEqual({
				only: ["amazon-bedrock"],
			});
			expect(gpt?.name).not.toBe("Preferred Sonnet");
		});

		test("model override deep merges OpenRouter routing compat", () => {
			writeRawModelsJson({
				openrouter: {
					compat: {
						openRouterRouting: { allow_fallbacks: false, order: ["anthropic"] },
					},
					modelOverrides: {
						"anthropic/claude-sonnet-4.5": {
							compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const compat = registry.find("openrouter", "anthropic/claude-sonnet-4.5")?.compat as
				| OpenRouterChatCompat
				| undefined;

			expect(compat?.openRouterRouting).toEqual({
				allow_fallbacks: false,
				order: ["anthropic"],
				only: ["amazon-bedrock"],
			});
		});

		test("model override headers are resolved with provider headers at request time", async () => {
			writeRawModelsJson({
				openrouter: {
					headers: { "X-Provider": "provider" },
					modelOverrides: {
						"anthropic/claude-sonnet-4.5": {
							headers: { "X-Model": "model" },
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");
			const auth = await registry.getApiKeyAndHeaders(model!);

			expect(auth).toEqual({
				ok: true,
				headers: {
					"X-Provider": "provider",
					"X-Model": "model",
				},
			});
		});
	});

	describe("dynamic provider lifecycle", () => {
		test("getProviderDisplayName resolves OpenRouter and fallback names", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getProviderDisplayName("openrouter")).toBe("OpenRouter");
			expect(registry.getProviderDisplayName("unknown-provider")).toBe("unknown-provider");
		});

		test("registerProvider rejects non-OpenRouter providers", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(() =>
				registry.registerProvider("local-proxy", {
					name: "Local Proxy",
					baseUrl: "http://localhost:11434/v1",
					apiKey: "local-key",
					api: "openrouter-chat",
					models: [modelConfig("local-model")],
				}),
			).toThrow('only supports runtime registration for "openrouter"');
		});

		test("registerTestProvider supports isolated faux providers", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerTestProvider("local-proxy", {
				name: "Local Proxy",
				baseUrl: "http://localhost:11434/v1",
				apiKey: "local-key",
				api: "openrouter-chat",
				models: [modelConfig("local-model")],
			});

			expect(registry.getProviderDisplayName("local-proxy")).toBe("Local Proxy");
			expect(registry.find("local-proxy", "local-model")).toBeDefined();
		});

		test("baseUrl-only registerProvider override updates OpenRouter models and refresh preserves it", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerProvider("openrouter", { baseUrl: "https://dynamic.example.com/v1" });
			registry.refresh();

			const models = getModelsForProvider(registry, "openrouter");
			expect(models.length).toBeGreaterThan(1);
			expect(models.every((model) => model.baseUrl === "https://dynamic.example.com/v1")).toBe(true);
		});

		test("registerProvider with models replaces a provider until unregister", () => {
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			registry.registerProvider("openrouter", {
				baseUrl: "https://dynamic.example.com/v1",
				apiKey: "dynamic-key",
				api: "openrouter-chat",
				models: [modelConfig("dynamic-model")],
			});

			expect(getModelsForProvider(registry, "openrouter").map((model) => model.id)).toEqual(["dynamic-model"]);

			registry.unregisterProvider("openrouter");

			expect(registry.find("openrouter", "dynamic-model")).toBeUndefined();
			expect(registry.find("openrouter", "anthropic/claude-sonnet-4.5")).toBeDefined();
		});
	});

	describe("API key resolution", () => {
		test("auth storage keys take precedence over models.json keys", async () => {
			writeRawModelsJson({
				openrouter: { apiKey: "models-json-key" },
			});
			authStorage.set("openrouter", { type: "api_key", key: "stored-key" });

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");

			expect(await registry.getApiKeyForProvider("openrouter")).toBe("stored-key");
			expect(await registry.getApiKeyAndHeaders(model!)).toEqual({
				ok: true,
				apiKey: "stored-key",
			});
		});

		test("models.json apiKey literal is resolved for provider requests", async () => {
			writeRawModelsJson({
				openrouter: { baseUrl: "https://openrouter.example.com/v1", apiKey: "models-json-key" },
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");

			expect(await registry.getApiKeyForProvider("openrouter")).toBe("models-json-key");
			expect(await registry.getApiKeyAndHeaders(model!)).toEqual({
				ok: true,
				apiKey: "models-json-key",
			});
			expect(registry.getProviderAuthStatus("openrouter")).toEqual({
				configured: true,
				source: "models_json_key",
			});
		});

		test("models.json env apiKey reports environment auth status", async () => {
			const originalEnv = process.env.TEST_OPENROUTER_KEY_12345;
			process.env.TEST_OPENROUTER_KEY_12345 = "env-key";
			try {
				writeRawModelsJson({
					openrouter: { baseUrl: "https://openrouter.example.com/v1", apiKey: "$TEST_OPENROUTER_KEY_12345" },
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);

				expect(await registry.getApiKeyForProvider("openrouter")).toBe("env-key");
				expect(registry.getProviderAuthStatus("openrouter")).toEqual({
					configured: true,
					source: "environment",
					label: "TEST_OPENROUTER_KEY_12345",
				});
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_OPENROUTER_KEY_12345;
				} else {
					process.env.TEST_OPENROUTER_KEY_12345 = originalEnv;
				}
			}
		});

		test("models.json command apiKey is not executed by getAvailable", async () => {
			const markerPath = join(tempDir, "marker");
			const marker = toShPath(markerPath);
			writeRawModelsJson({
				openrouter: {
					baseUrl: "https://openrouter.example.com/v1",
					apiKey: `!sh -c 'echo ran > "${marker}"; echo command-key'`,
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getProviderAuthStatus("openrouter")).toEqual({
				configured: true,
				source: "models_json_command",
			});
			expect(registry.getAvailable().length).toBeGreaterThan(0);
			expect(existsSync(markerPath)).toBe(false);
			expect(await registry.getApiKeyForProvider("openrouter")).toBe("command-key");
			expect(readFileSync(markerPath, "utf-8").trim()).toBe("ran");
		});

		test("authHeader adds Authorization for OpenRouter request auth", async () => {
			writeRawModelsJson({
				openrouter: {
					baseUrl: "https://openrouter.example.com/v1",
					apiKey: "openrouter-key",
					authHeader: true,
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(
				await registry.getApiKeyAndHeaders(registry.find("openrouter", "anthropic/claude-sonnet-4.5")!),
			).toEqual({
				ok: true,
				apiKey: "openrouter-key",
				headers: { Authorization: "Bearer openrouter-key" },
			});
		});
	});

	describe("validation", () => {
		test("invalid models.json keeps OpenRouter built-ins and exposes the error", () => {
			writeFileSync(modelsJsonPath, "{ invalid json");

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getError()).toContain("Failed to parse models.json");
			expect(registry.find("openrouter", "anthropic/claude-sonnet-4.5")).toBeDefined();
		});

		test("schema errors include the failing path", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4.5": {
							contextWindow: "large",
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(registry.getError()).toContain("modelOverrides.anthropic.claude-sonnet-4.5.contextWindow");
		});
	});

	describe("request-time config value resolution", () => {
		test("provider headers support env interpolation", async () => {
			const originalEnv = process.env.TEST_OPENROUTER_HEADER_12345;
			process.env.TEST_OPENROUTER_HEADER_12345 = "header-value";
			try {
				writeRawModelsJson({
					openrouter: {
						headers: {
							"X-Test": "$TEST_OPENROUTER_HEADER_12345",
						},
					},
				});

				const registry = ModelRegistry.create(authStorage, modelsJsonPath);
				const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");

				expect(await registry.getApiKeyAndHeaders(model!)).toEqual({
					ok: true,
					headers: { "X-Test": "header-value" },
				});
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_OPENROUTER_HEADER_12345;
				} else {
					process.env.TEST_OPENROUTER_HEADER_12345 = originalEnv;
				}
			}
		});

		test("header command failures return request auth errors", async () => {
			writeRawModelsJson({
				openrouter: {
					headers: {
						"X-Test": "!exit 1",
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const model = registry.find("openrouter", "anthropic/claude-sonnet-4.5");
			const auth = await registry.getApiKeyAndHeaders(model!);

			expect(auth.ok).toBe(false);
			if (!auth.ok) {
				expect(auth.error).toContain('provider "openrouter" header "X-Test"');
			}
		});

		test("request-time command api keys are resolved uncached", async () => {
			const counterFile = join(tempDir, "counter");
			writeFileSync(counterFile, "0");
			const counterPath = toShPath(counterFile);
			const command = `!sh -c 'count=$(cat "${counterPath}"); next=$((count + 1)); echo "$next" > "${counterPath}"; echo "key-$next"'`;
			writeRawModelsJson({
				openrouter: { ...providerWithApiKey(command), baseUrl: "https://openrouter.example.com/v1" },
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(await registry.getApiKeyForProvider("openrouter")).toBe("key-1");
			expect(await registry.getApiKeyForProvider("openrouter")).toBe("key-2");
			expect(readFileSync(counterFile, "utf-8").trim()).toBe("2");
		});
	});
});
