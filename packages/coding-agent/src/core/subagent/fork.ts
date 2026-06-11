/**
 * Fork subagent system.
 *
 * Fork mode: when only `task` is provided (no `agent`), the child inherits
 * the parent's full conversation context. Multiple fork children share
 * byte-identical API prefixes for prompt cache hits.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Tag used to identify fork children and prevent recursive forking. */
export const FORK_BOILERPLATE_TAG = "fork_worker_directive";

/**
 * Build the forked conversation messages for the child agent.
 *
 * For prompt cache sharing, all fork children should produce byte-identical
 * API request prefixes. This function:
 * 1. Takes the parent's full conversation history
 * 2. Appends a per-child directive message (the only difference)
 *
 * @param parentMessages - The parent's full conversation history
 * @param directive - The task directive for this specific fork child
 * @returns Messages array to pass to runSubagent
 */
export function buildForkedMessages(parentMessages: AgentMessage[], directive: string): AgentMessage[] {
	// Clone parent messages to avoid mutation, only those with content
	const cloned: AgentMessage[] = parentMessages
		.filter((m) => "content" in m)
		.map((m) => ({
			...m,
			content: Array.isArray((m as any).content) ? [...(m as any).content] : (m as any).content,
		}));

	// Append the directive as the final user message
	cloned.push({
		role: "user",
		content: [{ type: "text", text: buildChildDirective(directive) }],
		timestamp: Date.now(),
	});

	return cloned;
}

/**
 * Build the child directive message with strict rules for fork workers.
 */
export function buildChildDirective(directive: string): string {
	return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents. Execute directly with your tools.
2. Do NOT converse, ask questions, or suggest next steps.
3. Do NOT editorialize or add meta-commentary.
4. USE your tools directly: Bash, etc.
5. If you modify files, commit your changes before reporting. Include the commit hash.
6. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
7. Stay strictly within your directive's scope.
8. Keep your report under 500 words unless the directive specifies otherwise.
9. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.
10. REPORT structured facts, then stop.

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings>
  Key files: <relevant file paths — include for research tasks>
  Files changed: <list with commit hash — include only if you modified files>
  Issues: <list — include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

Directive: ${directive}`;
}

/**
 * Check if a message array indicates we're inside a fork child.
 * Used to prevent recursive forking.
 */
export function isInForkChild(messages: AgentMessage[]): boolean {
	return messages.some((m) => {
		if (!("role" in m) || m.role !== "user") return false;
		const content = (m as any).content;
		if (!Array.isArray(content)) return false;
		return content.some(
			(block: any) =>
				block.type === "text" && typeof block.text === "string" && block.text.includes(`<${FORK_BOILERPLATE_TAG}>`),
		);
	});
}
