/**
 * Subagent execution engine.
 *
 * Runs an isolated agent loop in-process with its own context, tools, and system prompt.
 * Replaces the spawn-based approach from the subagent extension.
 */

import type { EventStream, Model } from "@earendil-works/pi-ai";
import { agentLoop } from "./agent-loop.ts";
import type { AgentContext, AgentEvent, AgentMessage, AgentTool, StreamFn } from "./types.ts";

/**
 * Configuration for running a subagent.
 */
export interface SubagentConfig {
	/** Model to use for the subagent. */
	model: Model<any>;
	/** System prompt for the subagent (isolated from parent). */
	systemPrompt: string;
	/** Initial messages (typically a single user message with the task). */
	messages: AgentMessage[];
	/** Tools available to the subagent. */
	tools: AgentTool<any>[];
	/** Resolve API key for the model provider. */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** Stream function override (defaults to streamSimple). */
	streamFn?: StreamFn;
	/** Abort signal for the subagent run. */
	signal?: AbortSignal;
	/** Optional afterToolCall hook. */
	afterToolCall?: import("./types.ts").AgentLoopConfig["afterToolCall"];
}

/**
 * Run a subagent with an isolated context.
 *
 * Creates a fresh AgentContext and runs the agent loop independently from the parent.
 * Returns an EventStream the caller can iterate to track progress.
 *
 * @example
 * ```typescript
 * const stream = runSubagent({
 *   model: myModel,
 *   systemPrompt: "You are a code reviewer...",
 *   messages: [{ role: "user", content: [{ type: "text", text: "Review this code" }], timestamp: Date.now() }],
 *   tools: [readTool, grepTool],
 *   getApiKey,
 * });
 *
 * for await (const event of stream) {
 *   if (event.type === "message_end" && event.message.role === "assistant") {
 *     console.log(getTextOutput(event.message));
 *   }
 * }
 * const finalMessages = await stream.result();
 * ```
 */
export function runSubagent(config: SubagentConfig): EventStream<AgentEvent, AgentMessage[]> {
	const context: AgentContext = {
		systemPrompt: config.systemPrompt,
		messages: [],
		tools: config.tools,
	};

	return agentLoop(
		config.messages,
		context,
		{
			model: config.model,
			convertToLlm: defaultConvertToLlm,
			getApiKey: config.getApiKey,
			afterToolCall: config.afterToolCall,
		},
		config.signal,
		config.streamFn,
	);
}

/**
 * Default conversion from AgentMessage[] to LLM-compatible messages.
 * Filters out custom message types that the LLM can't handle.
 */
function defaultConvertToLlm(messages: AgentMessage[]): import("@earendil-works/pi-ai").Message[] {
	return messages.filter(
		(m): m is import("@earendil-works/pi-ai").Message =>
			m.role === "user" || m.role === "assistant" || m.role === "toolResult",
	);
}

/**
 * Extract the final text output from an array of agent messages.
 * Returns the text from the last assistant message, or empty string.
 */
export function getSubagentOutput(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const parts = msg.content;
			if (Array.isArray(parts)) {
				for (const part of parts) {
					if (part.type === "text") return part.text;
				}
			}
		}
	}
	return "";
}

/**
 * Collect usage stats from all assistant messages in a subagent run.
 */
export function getSubagentUsage(messages: AgentMessage[]): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
} {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	let turns = 0;

	for (const msg of messages) {
		if (msg.role === "assistant") {
			turns++;
			input += msg.usage.input;
			output += msg.usage.output;
			cacheRead += msg.usage.cacheRead;
			cacheWrite += msg.usage.cacheWrite;
			cost += msg.usage.cost.total;
		}
	}

	return { input, output, cacheRead, cacheWrite, cost, turns };
}
