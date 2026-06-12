/**
 * Project roadmap management.
 *
 * Creates and maintains .pi/ROADMAP.md — a structured overview of the project
 * that agents can reference to understand file layout and important files.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

function getRoadmapPath(cwd: string): string {
	return join(cwd, ".pi", "ROADMAP.md");
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

		// Build tree structure
		const lines: string[] = [];
		const indent = "  ";

		// Group by top-level directory
		const groups = new Map<string, string[]>();
		for (const file of files) {
			const parts = file.split("/");
			const topLevel = parts[0];
			if (!groups.has(topLevel)) groups.set(topLevel, []);
			groups.get(topLevel)!.push(file);
		}

		for (const [name, groupFiles] of groups) {
			if (groupFiles.length === 1 && !groupFiles[0].includes("/")) {
				// Single file at root
				lines.push(`${name}`);
			} else {
				// Directory
				lines.push(`${name}/`);
				// Show first 3 levels
				const subGroups = new Map<string, string[]>();
				for (const f of groupFiles) {
					const rel = f.slice(name.length + 1);
					const subParts = rel.split("/");
					const subKey = subParts.length > 1 ? `${subParts[0]}/` : subParts[0];
					if (!subGroups.has(subKey)) subGroups.set(subKey, []);
					subGroups.get(subKey)!.push(rel);
				}
				let count = 0;
				for (const [subName, subFiles] of subGroups) {
					if (count >= 15) {
						lines.push(`${indent}... (${subGroups.size - count} more)`);
						break;
					}
					if (subFiles.length === 1) {
						lines.push(`${indent}${subName}`);
					} else {
						lines.push(`${indent}${subName} (${subFiles.length} files)`);
					}
					count++;
				}
			}
		}

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
			const files = execSync(`find ${dir} -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.d.ts" -not -name "*.test.ts" | sort`, {
				cwd,
				encoding: "utf-8",
				timeout: 10000,
			})
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

	// Ensure .pi directory exists
	const piDir = join(cwd, ".pi");
	if (!existsSync(piDir)) {
		mkdirSync(piDir, { recursive: true });
	}

	const fileTree = generateFileTree(cwd);
	const fileTable = generateFileTable(cwd);

	const content = `# Project Roadmap

> Auto-generated project overview. Update this file as the project evolves.
> Agents: reference this file to understand project structure and find important files.

## File Structure

\`\`\`
${fileTree}
\`\`\`

## Important Files

${fileTable}

## Quick Reference

- **Entry point**: packages/coding-agent/src/cli.ts
- **Main logic**: packages/coding-agent/src/main.ts
- **System prompt**: packages/coding-agent/src/core/system-prompt.ts
- **Tools**: packages/coding-agent/src/core/tools/
- **Subagent**: packages/coding-agent/src/core/subagent/
- **TUI**: packages/coding-agent/src/modes/interactive/
- **AI provider**: packages/ai/src/
- **Agent loop**: packages/agent/src/
`;

	writeFileSync(roadmapPath, content, "utf-8");
	return roadmapPath;
}
