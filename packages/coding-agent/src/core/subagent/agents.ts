/**
 * Agent discovery and configuration for the subagent system.
 *
 * Discovers agent definitions from markdown files in:
 * - Built-in: hardcoded agent definitions
 * - User directory: ~/.pi/agent/agents/*.md
 * - Project directory: <project>/.pi/agents/*.md
 *
 * Each agent is a markdown file with YAML frontmatter:
 * ---
 * name: reviewer
 * description: Code review agent
 * tools: read,grep,ls
 * model: gpt-4
 * maxTurns: 50
 * background: false
 * isolation: worktree
 * ---
 * You are a code reviewer...
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { getBuiltInAgents } from "./built-in-agents.ts";

export type AgentScope = "user" | "project" | "both";

export type AgentIsolation = "worktree";

export interface AgentConfig {
	name: string;
	description: string;
	/** Tool names this agent can use. '*' means all tools. undefined means all tools. */
	tools?: string[];
	/** Model override. 'inherit' means use parent's model. undefined means default. */
	model?: string;
	systemPrompt: string;
	source: "user" | "project" | "built-in";
	filePath?: string;
	/** Max turns before the agent loop stops. */
	maxTurns?: number;
	/** Force this agent to run in background (async). */
	background?: boolean;
	/** Default isolation mode for this agent. */
	isolation?: AgentIsolation;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

type AgentFrontmatter = Record<string, unknown> & {
	name?: string;
	description?: string;
	tools?: string;
	model?: string;
	maxTurns?: number | string;
	background?: boolean | string;
	isolation?: string;
};

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!existsSync(dir)) {
		return agents;
	}

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;

		const filePath = join(dir, entry);
		try {
			const stat = statSync(filePath);
			if (!stat.isFile() && !stat.isSymbolicLink()) continue;
		} catch {
			continue;
		}

		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools =
			frontmatter.tools === "*"
				? ["*"]
				: frontmatter.tools
						?.split(",")
						.map((t) => t.trim())
						.filter(Boolean);

		const maxTurns =
			typeof frontmatter.maxTurns === "number"
				? frontmatter.maxTurns
				: typeof frontmatter.maxTurns === "string"
					? parseInt(frontmatter.maxTurns, 10) || undefined
					: undefined;

		const background =
			typeof frontmatter.background === "boolean" ? frontmatter.background : frontmatter.background === "true";

		const isolation = frontmatter.isolation === "worktree" ? "worktree" : undefined;

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
			maxTurns,
			background: background || undefined,
			isolation,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Discover all available agents based on scope.
 *
 * Priority: built-in < user < project (later overrides earlier by name).
 *
 * @param cwd - Current working directory (used to find project-local agents)
 * @param scope - Which agent directories to scan
 * @returns Discovery result with agents list and project agents directory path
 */
export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const builtInAgents = getBuiltInAgents();
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	// Priority: built-in < user < project (later overrides earlier by name)
	const agentMap = new Map<string, AgentConfig>();

	for (const agent of builtInAgents) agentMap.set(agent.name, agent);

	if (scope === "both" || scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	}
	if (scope === "both" || scope === "project") {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
