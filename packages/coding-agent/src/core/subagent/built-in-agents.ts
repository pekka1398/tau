/**
 * Built-in agent definitions.
 *
 * These are always available and provide default agent types:
 * - general-purpose: All tools, default model, for most tasks
 * - explore: Read-only search, for codebase exploration
 * - plan: Read-only, for architecture planning
 */

import type { AgentConfig } from "./agents.ts";

const GENERAL_PURPOSE: AgentConfig = {
	name: "general-purpose",
	description: "General-purpose agent for complex tasks, multi-step work, and code generation.",
	tools: ["*"],
	systemPrompt: `You are a capable coding agent. Use your tools to complete the task thoroughly.
- Read files before editing them
- Run tests after making changes
- Be thorough but concise in your final report`,
	source: "built-in",
};

const EXPLORE: AgentConfig = {
	name: "explore",
	description: "Fast read-only agent for searching and exploring the codebase. No edits.",
	tools: ["bash"],
	model: "inherit",
	maxTurns: 30,
	systemPrompt: `You are a read-only exploration agent. Search the codebase to answer the question.
- Use bash with grep, find, cat, head, tail, ls to explore
- Do NOT edit, write, or modify any files
- Report your findings concisely with file paths and line numbers
- If you need to read multiple files, do it efficiently in parallel where possible`,
	source: "built-in",
};

const PLAN: AgentConfig = {
	name: "plan",
	description: "Read-only agent for architecture planning and implementation design.",
	tools: ["bash"],
	model: "inherit",
	maxTurns: 30,
	systemPrompt: `You are a planning agent. Analyze the codebase and produce a detailed implementation plan.
- Use bash with grep, find, cat, head, tail, ls to explore the codebase
- Do NOT edit, write, or modify any files
- Produce a structured plan with: overview, file changes needed, implementation steps, risks
- Be specific about file paths, function names, and code patterns`,
	source: "built-in",
};

const ALL_BUILT_IN_AGENTS: AgentConfig[] = [GENERAL_PURPOSE, EXPLORE, PLAN];

/**
 * Get all built-in agent definitions.
 */
export function getBuiltInAgents(): AgentConfig[] {
	return ALL_BUILT_IN_AGENTS;
}

/**
 * Check if an agent is a built-in agent.
 */
export function isBuiltInAgent(agent: AgentConfig): boolean {
	return agent.source === "built-in";
}
