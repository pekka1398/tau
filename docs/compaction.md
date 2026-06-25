# Compaction & Branch Summarization

LLMs have limited context windows. When conversations grow too long, tau uses compaction to summarize older content while preserving recent work. This page covers both auto-compaction and branch summarization.

**Source files** ([tau](https://github.com/pekka1398/tau)):
- [`src/core/compaction/compaction.ts`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/compaction.ts) - Auto-compaction logic
- [`src/core/compaction/branch-summarization.ts`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/branch-summarization.ts) - Branch summarization
- [`src/core/compaction/utils.ts`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/utils.ts) - Shared utilities (file tracking, serialization)
- [`src/core/session-manager.ts`](https://github.com/pekka1398/tau/blob/main/src/core/session-manager.ts) - Entry types (`CompactionEntry`, `BranchSummaryEntry`)
- [`src/core/extensions/types.ts`](https://github.com/pekka1398/tau/blob/main/src/core/extensions/types.ts) - Extension event types

For TypeScript definitions in your project, inspect `node_modules/@earendil-works/tau-coding-agent/dist/`.

## Overview

Tau has two summarization mechanisms:

| Mechanism | Trigger | Purpose |
|-----------|---------|---------|
| Compaction | Context exceeds threshold, or `/compact` | Summarize old messages to free up context |
| Branch summarization | `/tree` navigation | Preserve context when switching branches |

Both use the same structured summary format and track file operations cumulatively.

## Compaction

### When It Triggers

Compaction is manual. Trigger it with `/compact [instructions]`, where optional instructions focus the summary.

### How It Works

1. **Preserve original**: The current session JSONL is left unchanged.
2. **Generate summary**: Tau calls the model with executable tools disabled at runtime. The prompt still says `Do NOT use tools. Only output the summary text.`
3. **Find recent tail**: Tau walks backward from the newest message until `keepRecentChars` is reached.
4. **Create derived session**: Tau writes a new session file with compaction metadata in the header.
5. **Switch session**: The active session becomes the derived compacted session.

```
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new derived session):

  entry:  0       1           2     3      4      5     6
        ┌─────┬─────────┬─────┬─────┬──────┬──────┬─────┐
        │ hdr │ summary │ usr │ ass │ tool │ tool │ ass │
        └─────┴─────────┴─────┴─────┴──────┴──────┴─────┘
                 ↑          └──────── recent exact tail ────────┘
         synthetic user message

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt  synthetic          recent retained messages
```

The synthetic user message has this shape:

```text
The conversation before this point was compacted.

Full original transcript:
/absolute/path/to/original-session.jsonl

Summary:
<model-generated summary>
```

### Recent Tail

Tau chooses the retained tail by walking backward through messages and accumulating effective characters until `keepRecentChars` is reached. This is a character-budget split, not a semantic turn split, so the retained tail can start mid-turn.

```
Retained tail:

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                                                      ↑
                                             keepFromIndex = 7
                                                      └── retained tail
```

Before writing the derived session, retained messages are stripped to effective content: user text, assistant text and tool-call arguments, custom text, and bash commands. Bash output is truncated to `bashOutputChars`; tool result messages and thinking blocks are dropped.

### Derived Session Metadata

Compaction metadata is stored in the new session header:

```typescript
interface SessionHeader {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
  compactedFrom?: string;
  compactedAt?: string;
  compactInstructions?: string;
}
```

`compactedFrom` and `parentSession` point to the original session JSONL.

## Branch Summarization

### When It Triggers

When you use `/tree` to navigate to a different branch, tau offers to summarize the work you're leaving. This injects context from the left branch into the new branch.

### How It Works

1. **Find common ancestor**: Deepest node shared by old and new positions
2. **Collect entries**: Walk from old leaf back to common ancestor
3. **Prepare with budget**: Include messages up to token budget (newest first)
4. **Generate summary**: Call LLM with structured format
5. **Append entry**: Save `BranchSummaryEntry` at navigation point

```
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### Cumulative File Tracking

Both compaction and branch summarization track files cumulatively. When generating a summary, tau extracts file operations from:
- Tool calls in the messages being summarized
- Previous compaction or branch summary `details` (if any)

This means file tracking accumulates across multiple compactions or nested branch summaries, preserving the full history of read and modified files.

### BranchSummaryEntry Structure

Defined in [`session-manager.ts`](https://github.com/pekka1398/tau/blob/main/src/core/session-manager.ts):

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;      // Entry we navigated from
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default branch summarization uses this for details (from branch-summarization.ts):
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Same as compaction, extensions can store custom data in `details`.

See [`collectEntriesForBranchSummary()`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/branch-summarization.ts), [`prepareBranchEntries()`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/branch-summarization.ts), and [`generateBranchSummary()`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/branch-summarization.ts) for the implementation.

## Summary Format

Both compaction and branch summarization use the same structured format:

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### Message Serialization

Before summarization, messages are serialized to text via [`serializeConversation()`](https://github.com/pekka1398/tau/blob/main/src/core/compaction/utils.ts):

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

This prevents the model from treating it as a conversation to continue.

Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated. This keeps summarization requests within reasonable token budgets, since tool results (especially from `read` and `bash`) are typically the largest contributors to context size.

## Custom Summarization via Extensions

Extensions can intercept and customize both compaction and branch summarization. See [`extensions/types.ts`](https://github.com/pekka1398/tau/blob/main/src/core/extensions/types.ts) for event type definitions.

### session_before_compact

Fired before auto-compaction or `/compact`. Can cancel or provide custom summary. See `SessionBeforeCompactEvent` and `CompactionPreparation` in the types file.

```typescript
tau.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;

  // preparation.messagesToSummarize - messages to summarize
  // preparation.turnPrefixMessages - split turn prefix (if isSplitTurn)
  // preparation.previousSummary - previous compaction summary
  // preparation.fileOps - extracted file operations
  // preparation.tokensBefore - context tokens before compaction
  // preparation.firstKeptEntryId - where kept messages start
  // preparation.settings - compaction settings

  // branchEntries - all entries on current branch (for custom state)
  // signal - AbortSignal (pass to LLM calls)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { /* custom data */ },
    }
  };
});
```

#### Converting Messages to Text

To generate a summary with your own model, convert messages to text using `serializeConversation`:

```typescript
import { convertToLlm, serializeConversation } from "@earendil-works/tau-coding-agent";

tau.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // Convert AgentMessage[] to Message[], then serialize to text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // Returns:
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // Now send to your model for summarization
  const summary = await myModel.summarize(conversationText);
  
  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    }
  };
});
```

Extensions can implement `session_before_compact` when a project needs a custom summary strategy or model.

### session_before_tree

Fired before `/tree` navigation. Always fires regardless of whether user chose to summarize. Can cancel navigation or provide custom summary.

```typescript
tau.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId - where we're navigating to
  // preparation.oldLeafId - current position (being abandoned)
  // preparation.commonAncestorId - shared ancestor
  // preparation.entriesToSummarize - entries that would be summarized
  // preparation.userWantsSummary - whether user chose to summarize

  // Cancel navigation entirely:
  return { cancel: true };

  // Provide custom summary (only used if userWantsSummary is true):
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "Your summary...",
        details: { /* custom data */ },
      }
    };
  }
});
```

See `SessionBeforeTreeEvent` and `TreePreparation` in the types file.

## Settings

Configure compaction in `~/.tau/agent/settings.json` or `<project-dir>/.tau/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "keepRecentChars": 100000,
    "bashOutputChars": 1000
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Compatibility flag for compaction settings |
| `keepRecentChars` | `100000` | Recent effective context characters to keep |
| `bashOutputChars` | `1000` | Bash output characters to keep per retained bash message |

For retained bash messages, Tau keeps the command and the first `bashOutputChars` characters of output. If output was longer, Tau appends:

```text
[output truncated during compaction; full output available in archived session]
```
