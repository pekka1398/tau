/**
 * Project Map tool — codebase navigation map.
 *
 * Manages .pi/project-map.md: read, generate (scan codebase), save.
 */

import { Type } from "typebox";
import { execCommand } from "../exec.ts";
import type { ToolDefinition } from "../tool-types.ts";

const MAP_FILENAME = "project-map.md";

function getMapPath(cwd: string): string {
	return `${cwd}/.pi/${MAP_FILENAME}`;
}

export function createProjectMapToolDefinition(): ToolDefinition {
	return {
		name: "project-map",
		label: "Project Map",
		description: [
			"Codebase navigation map. Actions:",
			"- 'read': Return the existing project map from .pi/project-map.md. If none exists, prompts generation.",
			"- 'generate': Scan the codebase structure and return raw data for map creation.",
			"  After generation, format the data into a markdown table and save with the 'save' action.",
			"  Then maintain the map with bash 'edit' as you learn more about files.",
			"- 'save': Write markdown content to the map file.",
		].join("\n"),
		promptSnippet: "Project codebase map for navigation. Use 'read' to load it, 'generate' to create it.",
		promptGuidelines: [
			"At the start of a session, call project-map with action 'read' to load the codebase map.",
			"If the map doesn't exist yet, call project-map with action 'generate' to create it.",
			"When you discover new information about a file, use bash 'edit' to update the map directly.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("read"), Type.Literal("generate"), Type.Literal("save")], {
				description: "'read' returns existing map, 'generate' scans codebase, 'save' writes content to map file",
			}),
			content: Type.Optional(Type.String({ description: "Markdown content to save (required for 'save' action)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { action, content } = params as { action: string; content?: string };
			const mapPath = getMapPath(ctx.cwd);

			// ── read ──
			if (action === "read") {
				try {
					const { stdout, code } = await execCommand("cat", [mapPath], ctx.cwd, { timeout: 5000 });
					if (code === 0 && stdout.trim()) {
						return {
							content: [{ type: "text", text: stdout }],
							details: { action: "read", exists: true, path: mapPath },
						};
					}
				} catch {}
				return {
					content: [
						{
							type: "text",
							text: "No project map exists yet. Call project-map with action 'generate' to create one.",
						},
					],
					details: { action: "read", exists: false, path: mapPath },
				};
			}

			// ── save ──
			if (action === "save") {
				if (!content) {
					return {
						content: [{ type: "text", text: "Error: 'content' is required for save action." }],
						details: { action: "save", error: "missing content" },
					};
				}
				try {
					const tmpPath = `/tmp/project-map-${Date.now()}.md`;
					const escaped = JSON.stringify(content);
					await execCommand(
						"node",
						["-e", `require('fs').writeFileSync(${JSON.stringify(tmpPath)}, ${escaped})`],
						ctx.cwd,
						{ timeout: 10000 },
					);
					await execCommand("bash", ["-c", `mkdir -p "$(dirname '${mapPath}')"`], ctx.cwd, { timeout: 5000 });
					await execCommand("mv", [tmpPath, mapPath], ctx.cwd, { timeout: 5000 });
					return {
						content: [{ type: "text", text: `Project map saved to ${mapPath}` }],
						details: { action: "save", path: mapPath, bytes: content.length },
					};
				} catch (e) {
					return {
						content: [{ type: "text", text: `Error saving map: ${e}` }],
						details: { action: "save", error: String(e) },
					};
				}
			}

			// ── generate ──
			if (action === "generate") {
				const TIMEOUT = 15000;
				const results: Record<string, string> = {};
				const noiseFilter =
					"-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/__pycache__/*' -not -path '*/target/*' -not -path '*/.pi/*' -not -path '*/graphify-out/*' -not -path '*/reference-repo/*'";
				const codeExts =
					"\\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.rs' -o -name '*.go' -o -name '*.java' -o -name '*.kt' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' \\)";

				try {
					const { stdout } = await execCommand(
						"bash",
						["-c", `find . -maxdepth 2 -type d ${noiseFilter} | sort`],
						ctx.cwd,
						{ timeout: TIMEOUT },
					);
					results.dirStructure = stdout;
				} catch (e) {
					results.dirStructure = `Error: ${e}`;
				}

				try {
					const { stdout } = await execCommand(
						"bash",
						["-c", `find . -maxdepth 4 ${codeExts} ${noiseFilter} | sort`],
						ctx.cwd,
						{ timeout: TIMEOUT },
					);
					results.fileTree = stdout;
				} catch (e) {
					results.fileTree = `Error: ${e}`;
				}

				try {
					const { stdout } = await execCommand(
						"bash",
						[
							"-c",
							`find . -maxdepth 4 ${codeExts} ${noiseFilter} | xargs wc -l 2>/dev/null | sort -rn | head -80`,
						],
						ctx.cwd,
						{ timeout: TIMEOUT },
					);
					results.lineCounts = stdout;
				} catch (e) {
					results.lineCounts = `Error: ${e}`;
				}

				try {
					const { stdout } = await execCommand(
						"bash",
						[
							"-c",
							`for f in $(find . -maxdepth 3 -name 'package.json' ${noiseFilter} | sort); do echo "=== $f ==="; head -30 "$f"; echo; done`,
						],
						ctx.cwd,
						{ timeout: TIMEOUT },
					);
					results.packages = stdout;
				} catch (e) {
					results.packages = `Error: ${e}`;
				}

				try {
					const { stdout } = await execCommand(
						"bash",
						[
							"-c",
							`for f in $(find . -maxdepth 3 \\( -name 'README.md' -o -name 'index.ts' -o -name 'cli.ts' -o -name 'main.ts' \\) ${noiseFilter} | sort); do echo "=== $f ==="; head -15 "$f"; echo; done`,
						],
						ctx.cwd,
						{ timeout: TIMEOUT },
					);
					results.entryPoints = stdout;
				} catch (e) {
					results.entryPoints = `Error: ${e}`;
				}

				const output = [
					"# Codebase Scan Results",
					"",
					"Format this data into a markdown table with these columns:",
					"| 路徑 | 行數 | 功能描述 | 關鍵詞 |",
					"",
					"Guidelines:",
					"- Include 80-120 of the most architecturally important source files",
					"- Prioritize: entry points, core abstractions, large files (>500 lines), important feature modules",
					"- Skip: test files, generated files (*.generated.ts), small config/type files, examples",
					"- '功能描述': one sentence in Chinese describing what the file does",
					"- '關鍵詞': 3-5 English terms for search matching",
					"- Sort by package/module, then by importance within each group",
					"",
					"After formatting, save the table using project-map action 'save'.",
					"",
					"## Directory Structure",
					"```",
					results.dirStructure.trim(),
					"```",
					"",
					"## File Tree (code files)",
					"```",
					results.fileTree.trim(),
					"```",
					"",
					"## Line Counts (top 80)",
					"```",
					results.lineCounts.trim(),
					"```",
					"",
					"## Package.json Summaries",
					"```",
					results.packages.trim(),
					"```",
					"",
					"## Entry Points",
					"```",
					results.entryPoints.trim(),
					"```",
				].join("\n");

				return {
					content: [{ type: "text", text: output }],
					details: { action: "generate" },
				};
			}

			return {
				content: [{ type: "text", text: `Unknown action: ${action}. Use 'read', 'generate', or 'save'.` }],
				details: { action, error: "unknown action" },
			};
		},
	};
}
