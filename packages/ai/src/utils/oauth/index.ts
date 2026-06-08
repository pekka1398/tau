/**
 * OAuth credential management - stub (only OpenRouter API key auth is supported).
 */

export * from "./types.ts";

import type { OAuthCredentials, OAuthProviderId, OAuthProviderInfo, OAuthProviderInterface } from "./types.ts";

const oauthProviderRegistry = new Map<string, OAuthProviderInterface>();

export function getOAuthProvider(_id: OAuthProviderId): OAuthProviderInterface | undefined {
	return undefined;
}

export function registerOAuthProvider(_provider: OAuthProviderInterface): void {}

export function unregisterOAuthProvider(_id: string): void {}

export function resetOAuthProviders(): void {
	oauthProviderRegistry.clear();
}

export function getOAuthProviders(): OAuthProviderInterface[] {
	return [];
}

export function getOAuthProviderInfoList(): OAuthProviderInfo[] {
	return [];
}

export async function refreshOAuthToken(
	_providerId: OAuthProviderId,
	_credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	throw new Error("OAuth is not supported. Use OPENROUTER_API_KEY environment variable.");
}

export async function getOAuthApiKey(
	_providerId: OAuthProviderId,
	_credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	return null;
}
