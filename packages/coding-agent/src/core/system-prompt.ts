/**
 * System prompt construction and project context loading
 */

import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { spawnProcessSync } from "../utils/child-process.ts";
import { STATIC_SYSTEM_PROMPT } from "./prompts/static-prompt.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

const STATIC_PROMPT = STATIC_SYSTEM_PROMPT;

export interface BuildSystemPromptOptions {
	/** Working directory. */
	cwd: string;
	/** Model display name (e.g. "anthropic/claude-sonnet-4-20250514"). */
	model?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

// ============================================================================
// Git info helpers (sync, best-effort — failures produce empty strings)
// ============================================================================

function git(args: string[], cwd: string): string {
	try {
		const result = spawnProcessSync("git", args, {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		});
		return result.status === 0 ? result.stdout.trim() : "";
	} catch {
		return "";
	}
}

function gatherGitInfo(cwd: string) {
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	const isGit = branch ? "Yes" : "No";

	// Detect main branch: try main, then master
	let mainBranch = "";
	if (isGit === "Yes") {
		const hasMain = git(["rev-parse", "--verify", "refs/heads/main"], cwd);
		mainBranch = hasMain ? "main" : "master";
	}

	const gitUser = git(["config", "user.name"], cwd);
	const gitStatus = git(["status", "--short"], cwd);
	const gitCommits = git(["log", "--oneline", "-5"], cwd);

	return { isGit, branch, mainBranch, gitUser, gitStatus, gitCommits };
}

// ============================================================================
// Environment info
// ============================================================================

interface EnvironmentInfo {
	dir: string;
	isGit: string;
	platform: string;
	osVersion: string;
	model: string;
	branch: string;
	mainBranch: string;
	gitUser: string;
	gitStatus: string;
	gitCommits: string;
}

function gatherEnvironmentInfo(cwd: string, model?: string): EnvironmentInfo {
	const gitInfo = gatherGitInfo(cwd);

	return {
		dir: cwd,
		isGit: gitInfo.isGit,
		platform: process.platform,
		osVersion: `${os.type()} ${os.release()}`,
		model: model ?? "unknown",
		branch: gitInfo.branch,
		mainBranch: gitInfo.mainBranch,
		gitUser: gitInfo.gitUser,
		gitStatus: gitInfo.gitStatus || "(clean)",
		gitCommits: gitInfo.gitCommits || "(no commits)",
	};
}

function applyEnvironment(prompt: string, env: EnvironmentInfo): string {
	return prompt
		.replaceAll("{DIR}", env.dir)
		.replaceAll("{IS_GIT}", env.isGit)
		.replaceAll("{PLATFORM}", env.platform)
		.replaceAll("{OS_VERSION}", env.osVersion)
		.replaceAll("{MODEL}", env.model)
		.replaceAll("{BRANCH}", env.branch)
		.replaceAll("{MAIN_BRANCH}", env.mainBranch)
		.replaceAll("{GIT_USER}", env.gitUser)
		.replaceAll("{GIT_STATUS}", env.gitStatus)
		.replaceAll("{GIT_STATUS_COMMITS}", env.gitCommits);
}

// ============================================================================
// Public API
// ============================================================================

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const { contextFiles: providedContextFiles, skills: providedSkills } = options;

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	// Start with the static prompt and fill in environment placeholders
	const env = gatherEnvironmentInfo(options.cwd, options.model);
	let prompt = applyEnvironment(STATIC_PROMPT, env);

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Append skills section
	if (skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Append roadmap reference
	const roadmapPath = join(options.cwd, ".pi", "ROADMAP.md");
	if (existsSync(roadmapPath)) {
		prompt += `\n\n## Project Roadmap\n\nA project roadmap is available at: ${roadmapPath}\n\nThis file contains:\n- The project's file structure\n- A table of all important files with their paths, line counts, keywords, and descriptions\n\nTo understand the project layout or find where a feature is implemented, read this file first.`;
	}

	// Pi documentation paths (resolved at runtime)
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();
	prompt += `\n\nPi documentation (read only when the user asks about pi itself):`;
	prompt += `\n- Main documentation: ${readmePath}`;
	prompt += `\n- Additional docs: ${docsPath}`;
	prompt += `\n- Examples: ${examplesPath}`;

	// Add date and working directory last
	prompt += `\nCurrent date: $date`;
	prompt += `\nCurrent working directory: $promptCwd`;

	return prompt;
}
