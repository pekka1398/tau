import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	COMPACT_PROMPT,
	KEEP_RECENT_CHARS,
	effectiveChars,
	extractAssistantText,
	findSplitPoint,
	hasEffectiveContent,
	rebuildMessages,
	totalMessageChars,
} from "../src/core/compaction/index.ts";

// ============================================================================
// Helpers
// ============================================================================

function userMsg(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantMsg(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "end_turn",
		api: "openai",
		provider: "openrouter",
		model: "test",
		timestamp: Date.now(),
	};
}

function assistantWithToolCall(toolName: string, args: Record<string, unknown>): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", name: toolName, arguments: args, id: "tc1" }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "tool_use",
		api: "openai",
		provider: "openrouter",
		model: "test",
		timestamp: Date.now(),
	};
}

function toolResultMsg(text: string): AgentMessage {
	return { role: "toolResult", content: [{ type: "text", text }], toolCallId: "tc1", toolName: "bash", isError: false, timestamp: Date.now() };
}

function thinkingMsg(thinking: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "thinking", thinking }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "end_turn",
		api: "openai",
		provider: "openrouter",
		model: "test",
		timestamp: Date.now(),
	};
}

// ============================================================================
// effectiveChars
// ============================================================================

describe("effectiveChars", () => {
	it("counts user message text", () => {
		expect(effectiveChars(userMsg("hello"))).toBe(5);
	});

	it("counts assistant text output", () => {
		expect(effectiveChars(assistantMsg("world"))).toBe(5);
	});

	it("excludes thinking content", () => {
		const msg: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "a very long thinking block" },
				{ type: "text", text: "short" },
			],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "end_turn",
			api: "openai",
			provider: "openrouter",
			model: "test",
			timestamp: Date.now(),
		};
		expect(effectiveChars(msg)).toBe(5); // only "short"
	});

	it("counts tool call name + args", () => {
		const msg = assistantWithToolCall("bash", { command: "ls" });
		expect(effectiveChars(msg)).toBeGreaterThan(0);
	});

	it("excludes tool results", () => {
		expect(effectiveChars(toolResultMsg("large output"))).toBe(0);
	});

	it("counts bashExecution command", () => {
		const msg: AgentMessage = {
			role: "bashExecution",
			command: "ls -la",
			output: "very long output...",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		expect(effectiveChars(msg)).toBe(6); // "ls -la" only
	});
});

// ============================================================================
// totalMessageChars
// ============================================================================

describe("totalMessageChars", () => {
	it("includes tool result content", () => {
		expect(totalMessageChars(toolResultMsg("hello world"))).toBe(11);
	});

	it("includes thinking content", () => {
		expect(totalMessageChars(thinkingMsg("deep thoughts"))).toBe(13);
	});

	it("includes bashExecution output", () => {
		const msg: AgentMessage = {
			role: "bashExecution",
			command: "ls",
			output: "file1 file2",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		expect(totalMessageChars(msg)).toBe(2 + 11); // command + output
	});
});

// ============================================================================
// extractAssistantText
// ============================================================================

describe("extractAssistantText", () => {
	it("extracts text from assistant message", () => {
		expect(extractAssistantText(assistantMsg("hello"))).toBe("hello");
	});

	it("concatenates multiple text blocks", () => {
		const msg: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "end_turn",
			api: "openai",
			provider: "openrouter",
			model: "test",
			timestamp: Date.now(),
		};
		expect(extractAssistantText(msg)).toBe("hello\nworld");
	});

	it("skips thinking and tool calls", () => {
		const msg: AgentMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "answer" },
				{ type: "toolCall", name: "bash", arguments: { command: "ls" }, id: "tc1" },
			],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "tool_use",
			api: "openai",
			provider: "openrouter",
			model: "test",
			timestamp: Date.now(),
		};
		expect(extractAssistantText(msg)).toBe("answer");
	});

	it("returns empty string for non-assistant messages", () => {
		expect(extractAssistantText(userMsg("hello"))).toBe("");
	});
});

// ============================================================================
// findSplitPoint
// ============================================================================

describe("findSplitPoint", () => {
	it("keeps all messages when total is within budget", () => {
		const messages = [userMsg("hello"), assistantMsg("world")];
		const result = findSplitPoint(messages, 50_000);
		expect(result.keepFromIndex).toBe(0);
	});

	it("finds split point based on effective chars", () => {
		const messages = [
			userMsg("a".repeat(10_000)),
			assistantMsg("b".repeat(10_000)),
			userMsg("c".repeat(10_000)),
			assistantMsg("d".repeat(10_000)),
			userMsg("e".repeat(10_000)),
			assistantMsg("f".repeat(10_000)),
		];
		// Total effective chars = 60_000. Keep 50_000.
		const result = findSplitPoint(messages, 50_000);
		expect(result.keepFromIndex).toBeGreaterThan(0);
		// The kept portion should have approximately 50_000 chars
		let keptChars = 0;
		for (let i = result.keepFromIndex; i < messages.length; i++) {
			keptChars += effectiveChars(messages[i]);
		}
		expect(keptChars).toBeGreaterThanOrEqual(50_000);
	});

	it("handles empty messages", () => {
		expect(findSplitPoint([], 50_000)).toEqual({ keepFromIndex: 0 });
	});

	it("skips tool results in char counting but includes them in kept portion", () => {
		const messages = [
			userMsg("a".repeat(30_000)),
			assistantMsg("b".repeat(30_000)),
			toolResultMsg("c".repeat(30_000)), // not counted
			userMsg("d".repeat(10_000)),
		];
		// Effective: 30000 + 30000 + 0 + 10000 = 70000. Keep 50000.
		const result = findSplitPoint(messages, 50_000);
		// Should include the tool result since it's after the split point
		expect(result.keepFromIndex).toBeLessThanOrEqual(2);
	});
});

// ============================================================================
// rebuildMessages
// ============================================================================

describe("rebuildMessages", () => {
	it("creates summary user message + kept messages", () => {
		const kept = [userMsg("recent question"), assistantMsg("recent answer")];
		const result = rebuildMessages("This is the summary", kept);
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[0].content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text",
					text: expect.stringContaining("This is the summary"),
				}),
			]),
		);
		expect(result[1]).toBe(kept[0]);
		expect(result[2]).toBe(kept[1]);
	});

	it("summary message contains compaction marker", () => {
		const result = rebuildMessages("summary text", []);
		const text = (result[0].content as Array<{ type: string; text: string }>)[0].text;
		expect(text).toContain("compacted into the following summary");
		expect(text).toContain("summary text");
	});
});

// ============================================================================
// Constants
// ============================================================================

describe("constants", () => {
	it("KEEP_RECENT_CHARS is 50000", () => {
		expect(KEEP_RECENT_CHARS).toBe(50_000);
	});

	it("COMPACT_PROMPT tells model not to use tools", () => {
		expect(COMPACT_PROMPT).toContain("Do NOT use any tools");
	});
});

// ============================================================================
// hasEffectiveContent
// ============================================================================

describe("hasEffectiveContent", () => {
	it("returns true for user messages", () => {
		expect(hasEffectiveContent(userMsg("hello"))).toBe(true);
	});

	it("returns false for tool results", () => {
		expect(hasEffectiveContent(toolResultMsg("output"))).toBe(false);
	});

	it("returns false for empty messages", () => {
		expect(hasEffectiveContent(toolResultMsg(""))).toBe(false);
	});
});
