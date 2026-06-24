import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalGoogleApiKey = process.env.GOOGLE_API_KEY;

afterEach(() => {
	if (originalOpenRouterApiKey === undefined) {
		delete process.env.OPENROUTER_API_KEY;
	} else {
		process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
	}
	if (originalAnthropicApiKey === undefined) {
		delete process.env.ANTHROPIC_API_KEY;
	} else {
		process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
	}
	if (originalGoogleApiKey === undefined) {
		delete process.env.GOOGLE_API_KEY;
	} else {
		process.env.GOOGLE_API_KEY = originalGoogleApiKey;
	}
});

describe("environment API keys", () => {
	it("resolves OpenRouter credentials from OPENROUTER_API_KEY", () => {
		process.env.OPENROUTER_API_KEY = "openrouter-token";

		expect(findEnvKeys("openrouter")).toEqual(["OPENROUTER_API_KEY"]);
		expect(getEnvApiKey("openrouter")).toBe("openrouter-token");
	});

	it("does not resolve API keys for removed direct providers", () => {
		process.env.ANTHROPIC_API_KEY = "anthropic-token";
		process.env.GOOGLE_API_KEY = "google-token";

		expect(findEnvKeys("anthropic")).toBeUndefined();
		expect(getEnvApiKey("google")).toBeUndefined();
	});
});
