/**
 * System prompt construction and project context loading
 */

import { existsSync, readdirSync } from "node:fs";
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

/** Scan $PATH once and check which tools exist (fast, no child processes). */
function detectInstalledTools(): string {
	const wanted = new Set([
		// Languages & runtimes
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
		"julia",
		"swift",
		"kotlin",
		// Package managers
		"pip",
		"pip3",
		"pipx",
		"uv",
		"conda",
		"poetry",
		"pdm",
		"npm",
		"pnpm",
		"yarn",
		"gem",
		"composer",
		"apt",
		"apt-get",
		"dpkg",
		"snap",
		"flatpak",
		"brew",
		"pacman",
		"yum",
		"dnf",
		"zypper",
		// Build & compile
		"make",
		"cmake",
		"ninja",
		"meson",
		"bazel",
		"gcc",
		"g++",
		"clang",
		"clang++",
		"cc",
		"autoconf",
		"automake",
		"libtool",
		"pkg-config",
		// Version control
		"git",
		"gh",
		"svn",
		"hg",
		"jj",
		"fossil",
		// Containers & orchestration
		"docker",
		"docker-compose",
		"podman",
		"nerdctl",
		"kubectl",
		"helm",
		"k9s",
		"minikube",
		"kind",
		"k3s",
		// Databases
		"sqlite3",
		"psql",
		"mysql",
		"mongosh",
		"redis-cli",
		"litecli",
		"mycli",
		"pgcli",
		"duckdb",
		// Text & data processing
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
		"eza",
		"lsd",
		"tree",
		"xargs",
		"parallel",
		"sd",
		"column",
		"csvtool",
		"mlr",
		"xmlstarlet",
		// Network & download
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
		"nc",
		"socat",
		"wireguard",
		"ping",
		"dig",
		"nslookup",
		"traceroute",
		"mtr",
		"ip",
		"ifconfig",
		// Media & document
		"ffmpeg",
		"ffprobe",
		"sox",
		"imagemagick",
		"convert",
		"pandoc",
		"typst",
		"latex",
		"pdflatex",
		"lualatex",
		"tesseract",
		"pdftotext",
		"pdfimages",
		"libreoffice",
		// Cloud & infra
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
		"rclone",
		"mc",
		"restic",
		"borg",
		// AI & LLM
		"ollama",
		"huggingface-cli",
		"llama-cli",
		"llama-run",
		// Web automation
		"chromium",
		"chrome",
		"playwright",
		"puppeteer",
		"links",
		"lynx",
		"w3m",
		// GPU & hardware
		"nvidia-smi",
		"rocm-smi",
		"lscpu",
		"lspci",
		"lsusb",
		// Code quality & linters
		"ruff",
		"black",
		"yapf",
		"eslint",
		"prettier",
		"shellcheck",
		"hadolint",
		"biome",
		// Clipboard
		"pbcopy",
		"pbpaste",
		"xclip",
		"xsel",
		"wl-copy",
		"wl-paste",
		// Task runners
		"just",
		"task",
		"pm2",
		"crontab",
		// Security
		"gitleaks",
		"trufflehog",
		"trivy",
		"gpg",
		// Benchmarks
		"hyperfine",
		"wrk",
		"hey",
		"ab",
		"speedtest-cli",
		// System info & debug
		"journalctl",
		"dmesg",
		"strace",
		"ltrace",
		"valgrind",
		"gdb",
		// Env managers
		"asdf",
		"mise",
		"rtx",
		"nvm",
		"fnm",
		"pyenv",
		// Modern CLI
		"zoxide",
		"dust",
		"duf",
		"delta",
		"btop",
		"htop",
		"glances",
		// Data formats
		"protoc",
		"parquet-cli",
		// Misc
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
		"units",
		"scrcpy",
		"osascript",
		"xdotool",
	]);

	// Scan $PATH once — fast, no child processes
	const pathDirs = (process.env.PATH || "").split(":").filter(Boolean);
	const available = new Set<string>();
	for (const dir of pathDirs) {
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				if (wanted.has(entry)) available.add(entry);
			}
		} catch {
			// skip unreadable dirs
		}
	}
	return Array.from(available).sort().join(", ") || "(none detected)";
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
