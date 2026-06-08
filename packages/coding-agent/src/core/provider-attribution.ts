import type { Api, Model } from "@earendil-works/pi-ai";

const OPENROUTER_ATTRIBUTION_HEADERS = {
	"HTTP-Referer": "https://pi.dev",
	"X-OpenRouter-Title": "pi",
	"X-OpenRouter-Categories": "cli-agent",
};

export function mergeProviderAttributionHeaders(
	_model: Model<Api>,
	...headerSources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
	const merged: Record<string, string> = { ...OPENROUTER_ATTRIBUTION_HEADERS };

	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}

	return Object.keys(merged).length > 0 ? merged : undefined;
}
