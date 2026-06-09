import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { getSubagentOutput, getSubagentUsage, runSubagent } from "../src/subagent.ts";
import type { AgentEvent, AgentMessage } from "../src/types.ts";

// Mock stream that mimics AssistantMessageEventStream
class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, usage?: Partial<AssistantMessage["usage"]>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: usage?.input ?? 100,
			output: usage?.output ?? 50,
			cacheRead: usage?.cacheRead ?? 0,
			cacheWrite: usage?.cacheWrite ?? 0,
			totalTokens: usage?.totalTokens ?? 150,
			cost: usage?.cost ?? { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("runSubagent", () => {
	it("should run a simple subagent and return events", async () => {
		const stream = runSubagent({
			model: getModel("openrouter", "openai/gpt-4o-mini"),
			systemPrompt: "You are a test agent.",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Say hello" }],
					timestamp: Date.now(),
				},
			],
			tools: [],
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage("Hello from subagent!"),
					});
				});
				return stream;
			},
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("agent_start");
		expect(eventTypes).toContain("agent_end");

		// Should have message events for the user prompt + assistant response
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBeGreaterThanOrEqual(2); // user + assistant

		// Final messages should include both user prompt and assistant response
		const finalMessages = await stream.result();
		expect(finalMessages.length).toBeGreaterThanOrEqual(2);
	});

	it("should extract final output from messages", async () => {
		const stream = runSubagent({
			model: getModel("openrouter", "openai/gpt-4o-mini"),
			systemPrompt: "You are a test agent.",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "What is 2+2?" }],
					timestamp: Date.now(),
				},
			],
			tools: [],
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage("The answer is 4."),
					});
				});
				return stream;
			},
		});

		const messages: AgentMessage[] = [];
		for await (const event of stream) {
			if (event.type === "message_end") {
				messages.push(event.message);
			}
		}

		const output = getSubagentOutput(messages);
		expect(output).toBe("The answer is 4.");
	});

	it("should collect usage stats", async () => {
		const stream = runSubagent({
			model: getModel("openrouter", "openai/gpt-4o-mini"),
			systemPrompt: "You are a test agent.",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Test" }],
					timestamp: Date.now(),
				},
			],
			tools: [],
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage("Response", {
							input: 200,
							output: 100,
							cacheRead: 50,
							cost: { input: 0.005, output: 0.01, cacheRead: 0.001, cacheWrite: 0, total: 0.016 },
						}),
					});
				});
				return stream;
			},
		});

		const messages: AgentMessage[] = [];
		for await (const event of stream) {
			if (event.type === "message_end") {
				messages.push(event.message);
			}
		}

		const usage = getSubagentUsage(messages);
		expect(usage.turns).toBe(1);
		expect(usage.input).toBe(200);
		expect(usage.output).toBe(100);
		expect(usage.cacheRead).toBe(50);
		expect(usage.cost).toBe(0.016);
	});

	it("should handle abort signal", async () => {
		const controller = new AbortController();
		// Abort immediately
		controller.abort();

		const stream = runSubagent({
			model: getModel("openrouter", "openai/gpt-4o-mini"),
			systemPrompt: "You are a test agent.",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Test" }],
					timestamp: Date.now(),
				},
			],
			tools: [],
			signal: controller.signal,
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage("Should not reach here"),
					});
				});
				return stream;
			},
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		// Should have agent_end event
		const endEvent = events.find((e) => e.type === "agent_end");
		expect(endEvent).toBeDefined();
	});

	it("should run with tools", async () => {
		let toolExecuted = false;
		const testTool = {
			name: "echo",
			label: "Echo",
			description: "Echo back the input",
			parameters: {
				type: "object" as const,
				properties: {
					text: { type: "string" as const },
				},
				required: ["text"],
			},
			execute: async (_id: string, params: { text: string }) => {
				toolExecuted = true;
				return {
					content: [{ type: "text" as const, text: `Echo: ${params.text}` }],
					details: {},
				};
			},
		};

		// First call: agent requests tool call
		// Second call: agent sees result and responds
		let callCount = 0;
		const stream = runSubagent({
			model: getModel("openrouter", "openai/gpt-4o-mini"),
			systemPrompt: "You are a test agent.",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Echo hello" }],
					timestamp: Date.now(),
				},
			],
			tools: [testTool as any],
			streamFn: () => {
				const stream = new MockAssistantStream();
				callCount++;
				queueMicrotask(() => {
					if (callCount === 1) {
						// First response: tool call
						stream.push({
							type: "done",
							reason: "toolUse",
							message: {
								role: "assistant",
								content: [
									{
										type: "toolCall",
										id: "tc_1",
										name: "echo",
										arguments: { text: "hello" },
									},
								],
								api: "openai-responses",
								provider: "openai",
								model: "mock",
								usage: {
									input: 100,
									output: 50,
									cacheRead: 0,
									cacheWrite: 0,
									totalTokens: 150,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								},
								stopReason: "toolUse",
								timestamp: Date.now(),
							},
						});
					} else {
						// Second response: final text
						stream.push({
							type: "done",
							reason: "stop",
							message: createAssistantMessage("Tool was executed!"),
						});
					}
				});
				return stream;
			},
		});

		const messages: AgentMessage[] = [];
		for await (const event of stream) {
			if (event.type === "message_end") {
				messages.push(event.message);
			}
		}

		expect(toolExecuted).toBe(true);

		const output = getSubagentOutput(messages);
		expect(output).toBe("Tool was executed!");

		// Should have: user + assistant(toolCall) + toolResult + assistant(text)
		expect(messages.length).toBe(4);
	});
});
