import { clearApiProviders, registerApiProvider } from "../api-registry.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import type { OpenRouterChatOptions } from "./openrouter-chat.ts";

interface LazyProviderModule<
	TApi extends Api,
	TOptions extends StreamOptions,
	TSimpleOptions extends SimpleStreamOptions,
> {
	stream: (model: Model<TApi>, context: Context, options?: TOptions) => AsyncIterable<AssistantMessageEvent>;
	streamSimple: (
		model: Model<TApi>,
		context: Context,
		options?: TSimpleOptions,
	) => AsyncIterable<AssistantMessageEvent>;
}

interface OpenRouterChatProviderModule {
	streamOpenRouterChat: StreamFunction<"openrouter-chat", OpenRouterChatOptions>;
	streamSimpleOpenRouterChat: StreamFunction<"openrouter-chat", SimpleStreamOptions>;
}

let openRouterChatProviderModulePromise:
	| Promise<LazyProviderModule<"openrouter-chat", OpenRouterChatOptions, SimpleStreamOptions>>
	| undefined;

function forwardStream(target: AssistantMessageEventStream, source: AsyncIterable<AssistantMessageEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

function createLazyLoadErrorMessage<TApi extends Api>(model: Model<TApi>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function createLazyStream<TApi extends Api, TOptions extends StreamOptions, TSimpleOptions extends SimpleStreamOptions>(
	loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>,
): StreamFunction<TApi, TOptions> {
	return (model, context, options) => {
		const outer = new AssistantMessageEventStream();

		loadModule()
			.then((module) => {
				const inner = module.stream(model, context, options);
				forwardStream(outer, inner);
			})
			.catch((error) => {
				const message = createLazyLoadErrorMessage(model, error);
				outer.push({ type: "error", reason: "error", error: message });
				outer.end(message);
			});

		return outer;
	};
}

function createLazySimpleStream<
	TApi extends Api,
	TOptions extends StreamOptions,
	TSimpleOptions extends SimpleStreamOptions,
>(loadModule: () => Promise<LazyProviderModule<TApi, TOptions, TSimpleOptions>>): StreamFunction<TApi, TSimpleOptions> {
	return (model, context, options) => {
		const outer = new AssistantMessageEventStream();

		loadModule()
			.then((module) => {
				const inner = module.streamSimple(model, context, options);
				forwardStream(outer, inner);
			})
			.catch((error) => {
				const message = createLazyLoadErrorMessage(model, error);
				outer.push({ type: "error", reason: "error", error: message });
				outer.end(message);
			});

		return outer;
	};
}

function loadOpenRouterChatProviderModule(): Promise<
	LazyProviderModule<"openrouter-chat", OpenRouterChatOptions, SimpleStreamOptions>
> {
	openRouterChatProviderModulePromise ||= import("./openrouter-chat.ts").then((module) => {
		const provider = module as OpenRouterChatProviderModule;
		return {
			stream: provider.streamOpenRouterChat,
			streamSimple: provider.streamSimpleOpenRouterChat,
		};
	});
	return openRouterChatProviderModulePromise;
}

export const streamOpenRouterChat = createLazyStream(loadOpenRouterChatProviderModule);
export const streamSimpleOpenRouterChat = createLazySimpleStream(loadOpenRouterChatProviderModule);

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "openrouter-chat",
		stream: streamOpenRouterChat,
		streamSimple: streamSimpleOpenRouterChat,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
