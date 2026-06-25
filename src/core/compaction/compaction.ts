/**
 * Context compaction for long sessions.
 *
 * When the user runs /compact, Tau creates a new derived session. The original
 * JSONL stays unchanged; the new session starts with a synthetic summary
 * message and keeps a recent exact tail from the original conversation.
 *
 * Compaction is manual only — no auto-trigger.
 */

import type { AgentMessage } from "../agent/index.ts";

// ============================================================================
// Constants
// ============================================================================

/** How many chars of effective content to keep after compaction by default. */
export const KEEP_RECENT_CHARS = 100_000;

/** How many bash output chars to keep in compacted tail messages by default. */
export const BASH_OUTPUT_CHARS = 1_000;

/** The prompt injected into the conversation to trigger summarization. */
export const COMPACT_PROMPT =
	"Please summarize the entire conversation above into a structured summary. " +
	"Use this format:\n\n" +
	"## 🎯 Core Objective\n[1-2 sentences: what is being developed, refactored, or fixed]\n\n" +
	"## 🏗 Tech Stack & Constraints\n[Key languages, frameworks, core libraries, design patterns, coding conventions]\n\n" +
	"## 📂 Affected Files\n" +
	"- `path/to/file.ext`: [what changed or why it matters]\n" +
	"- `path/to/file2.ext`: [same]\n\n" +
	"## ✅ Done\n" +
	"- [completed items]\n\n" +
	"## 🚀 Next Steps\n" +
	"1. [immediate next task]\n" +
	"2. [following task]\n\n" +
	"## ⚠️ Known Issues & Gotchas\n" +
	'- [bugs, unresolved errors, special logic constraints, or "None"]\n\n' +
	"## Key Decisions\n" +
	"- **[Decision]**: [Rationale]\n\n" +
	"Do NOT use any tools. Only output the summary as text.";

export function buildCompactPrompt(instructions?: string): string {
	const trimmedInstructions = instructions?.trim();
	if (!trimmedInstructions) return COMPACT_PROMPT;
	return `${COMPACT_PROMPT}\n\nAdditional user instructions for this compaction:\n${trimmedInstructions}`;
}

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
/**
 * Strip a message to only include content counted by effectiveChars.
 * - user: keep text only
 * - assistant: keep text + toolCall name/args, drop thinking
 * - toolResult: drop entirely
 * - bashExecution: keep command and a bounded output prefix
 * - custom: keep text only
 * - branchSummary, compactionSummary: drop entirely
 */
export function truncateBashOutput(output: string, limit: number): { output: string; truncated: boolean } {
	if (limit < 0) limit = 0;
	if (output.length <= limit) {
		return { output, truncated: false };
	}
	const prefix = output.slice(0, limit);
	const marker = "\n\n[output truncated during compaction; full output available in archived session]";
	return { output: `${prefix}${marker}`, truncated: true };
}

function stripToEffective(message: AgentMessage, bashOutputChars: number): AgentMessage | null {
	switch (message.role) {
		case "user": {
			const content = message.content;
			if (typeof content === "string") return message;
			const stripped = content.filter((b) => b.type === "text" && b.text);
			return stripped.length > 0 ? { ...message, content: stripped } : null;
		}
		case "assistant": {
			const stripped = message.content.filter((b) => (b.type === "text" && b.text) || b.type === "toolCall");
			return stripped.length > 0 ? { ...message, content: stripped } : null;
		}
		case "bashExecution": {
			const { output, truncated } = truncateBashOutput(message.output, bashOutputChars);
			return { ...message, output, truncated: message.truncated || truncated };
		}
		case "custom": {
			const content = message.content;
			if (typeof content === "string") return message;
			const stripped = content.filter((b) => b.type === "text" && b.text);
			return stripped.length > 0 ? { ...message, content: stripped } : null;
		}
		// branchSummary, compactionSummary — keep as-is (context from previous compactions)
		case "branchSummary":
		case "compactionSummary":
			return message;
		// toolResult — drop entirely
		default:
			return null;
	}
}

export function createCompactionSummaryUserMessage(
	summaryText: string,
	originalSessionPath: string | undefined,
): AgentMessage {
	const transcriptPath = originalSessionPath ?? "(in-memory session)";
	return {
		role: "user",
		content: [
			{
				type: "text",
				text:
					"The conversation before this point was compacted.\n\n" +
					`Full original transcript:\n${transcriptPath}\n\n` +
					`Summary:\n${summaryText}`,
			},
		],
		timestamp: Date.now(),
	};
}

export function rebuildMessages(
	summaryText: string,
	keptMessages: AgentMessage[],
	options: { originalSessionPath?: string; bashOutputChars?: number } = {},
): AgentMessage[] {
	const summaryMessage: AgentMessage = {
		...createCompactionSummaryUserMessage(summaryText, options.originalSessionPath),
	};
	const bashOutputChars = options.bashOutputChars ?? BASH_OUTPUT_CHARS;

	const stripped = keptMessages
		.map((message) => stripToEffective(message, bashOutputChars))
		.filter((m): m is AgentMessage => m !== null);

	return [summaryMessage, ...stripped];
}

// ============================================================================
// Result type
// ============================================================================

export interface CompactionResult {
	summary: string;
	keptMessageCount: number;
	sessionFile?: string;
	compactedFrom?: string;
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
