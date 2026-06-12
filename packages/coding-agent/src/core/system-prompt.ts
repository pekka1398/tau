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
	tools: string;
}

/** Detect available tools by checking which ones exist in $PATH. */
function detectInstalledTools(): string {
	// Languages & runtimes
	const langs = [
		"python",
		"python3",
		"node",
		"bun",
		"deno",
		"java",
		"javac",
		"cargo",
		"rustc",
		"go",
		"ruby",
		"perl",
		"php",
		"lua",
		"R",
		"tsc",
		"tsx",
		"npx",
	];
	// Package managers
	const pkg = [
		"pip",
		"pip3",
		"pipx",
		"uv",
		"conda",
		"poetry",
		"npm",
		"pnpm",
		"yarn",
		"bun",
		"gem",
		"composer",
		"cargo",
		"apt",
		"apt-get",
		"dpkg",
		"snap",
		"flatpak",
		"brew",
		"pacman",
		"yum",
		"dnf",
	];
	// Build & compile
	const build = [
		"make",
		"cmake",
		"ninja",
		"meson",
		"gcc",
		"g++",
		"clang",
		"clang++",
		"autoconf",
		"automake",
		"libtool",
		"pkg-config",
	];
	// Version control
	const vcs = ["git", "gh", "svn", "hg", "jj"];
	// Containers & orchestration
	const containers = ["docker", "docker-compose", "podman", "nerdctl", "kubectl", "helm", "k9s", "minikube", "kind"];
	// Databases
	const db = ["sqlite3", "psql", "mysql", "mongosh", "redis-cli", "litecli", "mycli", "pgcli"];
	// Text & data processing
	const text = [
		"jq",
		"yq",
		"sed",
		"awk",
		"grep",
		"rg",
		"ag",
		"fzf",
		"fd",
		"bat",
		"exa",
		"lsd",
		"tree",
		"xargs",
		"parallel",
		"column",
		"csvtool",
		"mlr",
	];
	// Network & download
	const net = [
		"curl",
		"wget",
		"aria2c",
		"httpie",
		"ssh",
		"scp",
		"rsync",
		"mosh",
		"mutagen",
		"nmap",
		"netcat",
		"socat",
		"wireguard",
	];
	// Media & document
	const media = [
		"ffmpeg",
		"ffprobe",
		"sox",
		"imagemagick",
		"convert",
		"pandoc",
		"typst",
		"latex",
		"pdflatex",
		"tesseract",
	];
	// Cloud & infra
	const cloud = [
		"aws",
		"gcloud",
		"az",
		"terraform",
		"ansible",
		"puppet",
		"chef",
		"vagrant",
		"multipass",
		"cloudflared",
		"ngrok",
	];
	// Misc tools
	const misc = [
		"tmux",
		"screen",
		"zellij",
		"vim",
		"nvim",
		"nano",
		"code",
		"zip",
		"unzip",
		"7z",
		"tar",
		"gzip",
		"zstd",
		"bc",
		"dc",
		"units",
		"strace",
		"ltrace",
		"valgrind",
		"gdb",
		"btop",
		"htop",
		"glances",
	];

	const allCategories = [langs, pkg, build, vcs, containers, db, text, net, media, cloud, misc];
	const allTools = [...new Set(allCategories.flat())];

	const found: string[] = [];
	for (const tool of allTools) {
		try {
			spawnProcessSync("which", [tool], { encoding: "utf-8", stdio: "pipe" });
			found.push(tool);
		} catch {
			// not installed
		}
	}
	return found.join(", ") || "(none detected)";
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
		tools: detectInstalledTools(),
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
		.replaceAll("{GIT_STATUS_COMMITS}", env.gitCommits)
		.replaceAll("{TOOLS}", env.tools);
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
		prompt += `\n\n## Project Roadmap\n\nA project roadmap is available at: ${roadmapPath}\n\nThis file contains:\n- Architecture overview (package roles, internal structure)\n- Dependency graph\n- Entry points table ("want to do X → go to Y")\n- File structure (5 levels deep)\n- Important files table (paths, line counts, keywords, descriptions)\n- Tech stack and build commands\n- Coding conventions\n\nIMPORTANT: When reading ROADMAP.md, use \`cat\` to read the ENTIRE file. Do NOT use head/tail/sed to read partial content. The file is large but you must read all of it to understand the full project structure.`;
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
