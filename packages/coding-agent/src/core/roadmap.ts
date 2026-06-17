/**
 * Project roadmap management.
 *
 * Creates and maintains a ROADMAP.md — a structured overview of the project
 * that agents can reference to understand file layout and important files.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureProjectDir, getProjectDir } from "../config.ts";

function getRoadmapPath(cwd: string): string {
	return join(getProjectDir(cwd), "ROADMAP.md");
}

/**
 * Check if ROADMAP.md exists.
 */
export function roadmapExists(cwd: string): boolean {
	return existsSync(getRoadmapPath(cwd));
}

/**
 * Get the absolute path to ROADMAP.md.
 */
export function getRoadmapAbsolutePath(cwd: string): string {
	return getRoadmapPath(cwd);
}

/**
 * Generate a file tree respecting .gitignore.
 */
function generateFileTree(cwd: string): string {
	try {
		// Use git ls-files to get tracked files (respects .gitignore)
		const files = execSync("git ls-files --cached --others --exclude-standard", {
			cwd,
			encoding: "utf-8",
			timeout: 10000,
		})
			.trim()
			.split("\n")
			.filter(Boolean)
			.sort();

		if (files.length === 0) return "(no files found)";

		const lines: string[] = [];
		const MAX_DEPTH = 5;
		const MAX_ENTRIES_PER_DIR = 20;

		function renderTree(fileList: string[], depth: number, prefix: string): void {
			if (depth >= MAX_DEPTH) {
				if (fileList.length > 0) {
					lines.push(`${prefix}... (${fileList.length} more files)`);
				}
				return;
			}

			// Group files by their next path component
			const groups = new Map<string, { files: string[]; hasChildren: boolean }>();
			const directFiles: string[] = [];

			for (const file of fileList) {
				const remaining = file;
				const slashIdx = remaining.indexOf("/");
				if (slashIdx === -1) {
					directFiles.push(remaining);
				} else {
					const dirName = remaining.slice(0, slashIdx);
					if (!groups.has(dirName)) groups.set(dirName, { files: [], hasChildren: false });
					const group = groups.get(dirName)!;
					const child = remaining.slice(slashIdx + 1);
					if (child.includes("/")) group.hasChildren = true;
					group.files.push(child);
				}
			}

			// Sort: directories first, then files
			const sortedDirs = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
			directFiles.sort();

			let count = 0;
			for (const [dirName, { files: subFiles, hasChildren }] of sortedDirs) {
				if (count >= MAX_ENTRIES_PER_DIR) {
					lines.push(`${prefix}... (${sortedDirs.length + directFiles.length - count} more)`);
					return;
				}
				const marker = hasChildren || subFiles.length > 1 ? "/" : "";
				lines.push(`${prefix}${dirName}${marker} (${subFiles.length})`);
				renderTree(subFiles, depth + 1, `${prefix}  `);
				count++;
			}

			for (const file of directFiles) {
				if (count >= MAX_ENTRIES_PER_DIR) {
					lines.push(`${prefix}... (${directFiles.length - (count - sortedDirs.length)} more)`);
					return;
				}
				lines.push(`${prefix}${file}`);
				count++;
			}
		}

		renderTree(files, 0, "");

		return lines.join("\n");
	} catch {
		return "(git not available)";
	}
}

/**
 * Scan the project for important files and generate a table.
 */
function generateFileTable(cwd: string): string {
	const importantDirs = ["packages/coding-agent/src", "packages/agent/src", "packages/ai/src", "packages/tui/src"];
	const rows: string[] = [];

	rows.push("| Absolute Path | Lines | Keywords | Description |");
	rows.push("|---|---|---|---|");

	for (const dir of importantDirs) {
		const fullPath = join(cwd, dir);
		if (!existsSync(fullPath)) continue;

		try {
			const files = execSync(
				`find ${dir} -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.d.ts" -not -name "*.test.ts" | sort`,
				{
					cwd,
					encoding: "utf-8",
					timeout: 10000,
				},
			)
				.trim()
				.split("\n")
				.filter(Boolean);

			for (const file of files) {
				const absPath = join(cwd, file);
				try {
					const content = readFileSync(absPath, "utf-8");
					const lineCount = content.split("\n").length;

					// Extract keywords from first few lines and exports
					const keywords = extractKeywords(content, file);
					const description = extractDescription(content, file);

					rows.push(`| ${absPath} | ${lineCount} | ${keywords} | ${description} |`);
				} catch {
					// Skip unreadable files
				}
			}
		} catch {
			// Skip on error
		}
	}

	return rows.join("\n");
}

/**
 * Extract keywords from file content.
 */
function extractKeywords(content: string, filePath: string): string {
	const keywords: Set<string> = new Set();

	// From filename
	const basename = filePath.split("/").pop()?.replace(".ts", "") ?? "";
	if (basename) keywords.add(basename);

	// From exports
	const exportMatches = content.matchAll(/export\s+(?:function|const|class|interface|type)\s+(\w+)/g);
	for (const m of exportMatches) {
		if (keywords.size >= 5) break;
		keywords.add(m[1]);
	}

	// From imports of project modules
	const importMatches = content.matchAll(/from\s+["']\.\/([\w-]+)/g);
	for (const m of importMatches) {
		if (keywords.size >= 5) break;
		keywords.add(m[1]);
	}

	return Array.from(keywords).slice(0, 5).join(", ") || basename;
}

/**
 * Extract a description from the file's JSDoc or first meaningful comment.
 */
function extractDescription(content: string, _filePath: string): string {
	// Try JSDoc block comment
	const jsdocMatch = content.match(/\/\*\*\s*\n\s*\*\s*(.+?)(?:\n|\*\/)/);
	if (jsdocMatch) {
		return jsdocMatch[1].trim().slice(0, 80);
	}

	// Try single-line comment at top
	const commentMatch = content.match(/^\/\/\s*(.+)$/m);
	if (commentMatch) {
		return commentMatch[1].trim().slice(0, 80);
	}

	return "(no description)";
}

/**
 * Create the ROADMAP.md file with project overview.
 */
export function createRoadmap(cwd: string): string {
	const roadmapPath = getRoadmapPath(cwd);

	// Ensure project directory exists
	ensureProjectDir(cwd);

	const fileTree = generateFileTree(cwd);
	const fileTable = generateFileTable(cwd);

	const content = `# Project Roadmap

> Auto-generated project overview. Update this file as the project evolves.
> Agents: reference this file to understand project structure and find important files.

## Architecture

\`\`\`
packages/ai              LLM provider abstraction (OpenRouter, model registry, streaming)
packages/agent           Agent loop core (runAgentLoop, EventStream, tool execution)
packages/tui             Terminal UI components (Ink-based, themes, keybindings)
packages/ai-dash         Sandboxed shell (C, modified dash) — spawned as subprocess

packages/coding-agent    Main product — depends on all above
├─ src/cli/              CLI argument parsing, entry point
├─ src/core/             Session management, tools, subagent, config
│  ├─ tools/             Bash, Transcribe, Vision tool definitions
│  ├─ subagent/          Fork, worktree, transcript, built-in agents
│  ├─ compaction/        Context compaction for long sessions
│  └─ extensions/        Extension type stubs (infrastructure removed)
├─ src/modes/            Execution modes
│  ├─ interactive/       TUI mode (default)
│  ├─ print-mode.ts      Single-shot mode (-p flag)
│  └─ rpc/               JSON-RPC mode
└─ src/bun/              Bun-specific entry point and sandbox fix
\`\`\`

## Dependencies

\`\`\`
coding-agent ──→ agent ──→ ai (LLM provider, streaming)
    │                        ↑
    ├────────────────────────┘
    │
    ├────→ tui (terminal rendering)
    │
    └────→ ai-dash (C binary, spawned via child_process.spawn)
\`\`\`

## Entry Points

| Want to... | Go to |
|---|---|
| Change CLI args | \`src/cli/args.ts\` |
| Change tool behavior | \`src/core/tools/bash.ts\` |
| Add a new tool | \`src/core/tools/\` + \`src/core/tools/index.ts\` |
| Change system prompt | \`src/core/prompts/static-system-prompt.md\` |
| Change subagent logic | \`src/core/subagent/tool.ts\` |
| Change agent definitions | \`src/core/subagent/agents.ts\` + \`built-in-agents.ts\` |
| Change TUI display | \`src/modes/interactive/\` |
| Change model/provider | \`packages/ai/src/providers/\` |
| Change agent loop | \`packages/agent/src/agent-loop.ts\` |
| Change fork/worktree | \`src/core/subagent/fork.ts\` + \`worktree.ts\` |
| Change todo system | \`src/core/todo.ts\` |
| Change roadmap | \`src/core/roadmap.ts\` |
| Change config/paths | \`src/config.ts\` |
| Change keybindings | \`src/core/keybindings.ts\` |
| Change theme | \`src/modes/interactive/theme/\` |

## File Structure

\`\`\`
${fileTree}
\`\`\`

## Important Files

${fileTable}

## Tech Stack

- **Runtime**: Bun (compiled binary) / Node.js (dev)
- **Language**: TypeScript (strict)
- **Lint**: Biome
- **Build**: tsgo (type check) + bun build --compile (binary)
- **Shell**: ai-dash (C, modified dash) — spawned as subprocess
- **Test**: Vitest
- **Package**: npm workspaces

## Conventions

- Tool 用 bash，没有独立的 read/write/edit
- 子代理默认继承父工具，除非 agent definition 限制 tools 字段
- Commit message: feat/fix/refactor + 简短描述
- 不要加不必要的抽象层，三次重复才提取
- 改动只限于需求范围，不要"顺手"改别的
`;

	writeFileSync(roadmapPath, content, "utf-8");
	return roadmapPath;
}
