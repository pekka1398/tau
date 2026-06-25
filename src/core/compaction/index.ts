/**
 * Compaction module — manual-only derived-session context compaction.
 */

// Branch summarization is still used by tree navigation
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CollectEntriesResult,
	collectEntriesForBranchSummary,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	prepareBranchEntries,
} from "./branch-summarization.ts";
export {
	BASH_OUTPUT_CHARS,
	buildCompactPrompt,
	COMPACT_PROMPT,
	type CompactionResult,
	createCompactionSummaryUserMessage,
	effectiveChars,
	estimateTokens,
	extractAssistantText,
	findSplitPoint,
	hasEffectiveContent,
	KEEP_RECENT_CHARS,
	rebuildMessages,
	type SplitPoint,
	totalMessageChars,
	truncateBashOutput,
} from "./compaction.ts";
