import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalUnknownApiKey = process.env.UNKNOWN_PROVIDER_API_KEY;

afterEach(() => {
	if (originalOpenRouterApiKey === undefined) {
		delete process.env.OPENROUTER_API_KEY;
	} else {
		process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
	}
	if (originalUnknownApiKey === undefined) {
		delete process.env.UNKNOWN_PROVIDER_API_KEY;
	} else {
		process.env.UNKNOWN_PROVIDER_API_KEY = originalUnknownApiKey;
	}
});

describe("environment API keys", () => {
	it("resolves OpenRouter credentials from OPENROUTER_API_KEY", () => {
		process.env.OPENROUTER_API_KEY = "openrouter-token";

		expect(findEnvKeys("openrouter")).toEqual(["OPENROUTER_API_KEY"]);
		expect(getEnvApiKey("openrouter")).toBe("openrouter-token");
	});

	it("does not resolve API keys for removed direct providers", () => {
		process.env.UNKNOWN_PROVIDER_API_KEY = "unknown-token";

		expect(findEnvKeys("unknown-provider")).toBeUndefined();
		expect(getEnvApiKey("unknown-provider")).toBeUndefined();
	});
});
