/**
 * Compaction module — manual-only context compaction via Approach A.
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
	COMPACT_PROMPT,
	type CompactionResult,
	effectiveChars,
	estimateTokens,
	extractAssistantText,
	findSplitPoint,
	hasEffectiveContent,
	KEEP_RECENT_CHARS,
	rebuildMessages,
	type SplitPoint,
	totalMessageChars,
} from "./compaction.ts";
