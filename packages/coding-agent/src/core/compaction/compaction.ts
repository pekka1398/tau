/**
 * Context compaction for long sessions.
 *
 * When the user runs /compact, a summarization prompt is injected as a user
 * message into the ongoing conversation (Approach A) so the existing cache
 * prefix is preserved. After the model responds with a summary, the session
 * is rebuilt: summary (as user message) + the most recent ~50 000 chars of
 * "effective content" (user msg + assistant text + tool calls, no thinking /
 * tool results).
 *
 * Compaction is manual only — no auto-trigger.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

// ============================================================================
// Constants
// ============================================================================

/** How many chars of effective content to keep after compaction. */
export const KEEP_RECENT_CHARS = 50_000;

/** The prompt injected into the conversation to trigger summarization. */
export const COMPACT_PROMPT =
	"Please summarize the entire conversation above into a structured summary. " +
	"Use this format:\n\n" +
	"## Goal\n[What is the user trying to accomplish?]\n\n" +
	"## Progress\n### Done\n- [x] [Completed items]\n### In Progress\n- [ ] [Current work]\n\n" +
	"## Key Decisions\n- **[Decision]**: [Rationale]\n\n" +
	"## Next Steps\n1. [What should happen next]\n\n" +
	"## Critical Context\n- [File paths, function names, error messages, etc.]\n\n" +
	"Do NOT use any tools. Only output the summary as text.";

// ============================================================================
// Effective content helpers
// ============================================================================

/**
 * Compute the "effective" char count of a message for compaction purposes.
 * Only counts: user msg text, assistant text output, tool call names+args,
 * bashExecution command text.
 * Excludes: thinking content, tool results, images.
 */
export function effectiveChars(message: AgentMessage): number {
	switch (message.role) {
		case "user": {
			const content = message.content;
			if (typeof content === "string") return content.length;
			let chars = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) chars += block.text.length;
			}
			return chars;
		}
		case "assistant": {
			let chars = 0;
			for (const block of message.content) {
				if (block.type === "text") {
					chars += block.text.length;
				} else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
				// Skip thinking blocks
			}
			return chars;
		}
		case "bashExecution": {
			return message.command.length;
		}
		case "custom": {
			const content = message.content;
			if (typeof content === "string") return content.length;
			let chars = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) chars += block.text.length;
			}
			return chars;
		}
		// toolResult, branchSummary, compactionSummary — not counted for compaction
		default:
			return 0;
	}
}

/**
 * Compute total char count of a message (all content, including tool results).
 * Used by branch-summarization for budget tracking.
 */
export function totalMessageChars(message: AgentMessage): number {
	switch (message.role) {
		case "user": {
			const content = message.content;
			if (typeof content === "string") return content.length;
			let chars = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) chars += block.text.length;
			}
			return chars;
		}
		case "assistant": {
			let chars = 0;
			for (const block of message.content) {
				if (block.type === "text") {
					chars += block.text.length;
				} else if (block.type === "thinking") {
					chars += block.thinking.length;
				} else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
			}
			return chars;
		}
		case "toolResult": {
			const content = message.content;
			let chars = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) chars += block.text.length;
			}
			return chars;
		}
		case "bashExecution": {
			return message.command.length + message.output.length;
		}
		case "custom": {
			const content = message.content;
			if (typeof content === "string") return content.length;
			let chars = 0;
			for (const block of content) {
				if (block.type === "text" && block.text) chars += block.text.length;
			}
			return chars;
		}
		case "branchSummary":
		case "compactionSummary": {
			return message.summary.length;
		}
		default:
			return 0;
	}
}

/**
 * Whether a message contributes "effective content" that should be kept
 * during compaction.
 */
export function hasEffectiveContent(message: AgentMessage): boolean {
	return effectiveChars(message) > 0;
}

/**
 * Extract the text of an assistant message (for use as the compaction summary).
 * Concatenates all text blocks, ignoring thinking and tool calls.
 */
export function extractAssistantText(message: AgentMessage): string {
	if (message.role !== "assistant") return "";
	return message.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

// ============================================================================
// Find the split point
// ============================================================================

export interface SplitPoint {
	/** Index in the messages array: messages[0..splitIndex-1] are summarized, messages[splitIndex..] are kept. */
	keepFromIndex: number;
}

/**
 * Walk backwards from the end of the messages array, accumulating effective
 * chars, until we exceed keepRecentChars. The split point is the earliest
 * message included in the "kept" portion.
 *
 * Only considers "effective" messages for accumulation (skips toolResult,
 * thinking-only assistant messages, etc.) but includes ALL messages from the
 * split point onward (so toolResult messages that follow their tool calls
 * are included in the kept portion).
 */
export function findSplitPoint(messages: AgentMessage[], keepRecentChars: number): SplitPoint {
	if (messages.length === 0) return { keepFromIndex: 0 };

	let accumulated = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		accumulated += effectiveChars(messages[i]);
		if (accumulated >= keepRecentChars) {
			return { keepFromIndex: i };
		}
	}

	// Everything fits within the budget — keep all
	return { keepFromIndex: 0 };
}

// ============================================================================
// Rebuild messages after compaction
// ============================================================================

/**
 * Build the post-compaction message list.
 *
 * @param summaryText - The summary text from the model's response
 * @param keptMessages - The recent messages to keep
 * @returns New messages array: [summary as user message, ...keptMessages]
 */
export function rebuildMessages(summaryText: string, keptMessages: AgentMessage[]): AgentMessage[] {
	const summaryMessage: AgentMessage = {
		role: "user",
		content: [
			{
				type: "text",
				text: `The conversation history before this point was compacted into the following summary:\n\n${summaryText}`,
			},
		],
		timestamp: Date.now(),
	};

	return [summaryMessage, ...keptMessages];
}

// ============================================================================
// Result type
// ============================================================================

export interface CompactionResult {
	summary: string;
	keptMessageCount: number;
}

/**
 * Estimate char count for a message (used by branch-summarization for budget tracking).
 * This counts chars, not tokens — we don't pretend to know token counts.
 */
export function estimateMessageChars(message: AgentMessage): number {
	return effectiveChars(message);
}

/**
 * @deprecated Use totalMessageChars instead. Kept for branch-summarization compat.
 * Returns chars/4 for legacy compat — prefer totalMessageChars for new code.
 */
export function estimateTokens(message: AgentMessage): number {
	return Math.ceil(totalMessageChars(message) / 4);
}
