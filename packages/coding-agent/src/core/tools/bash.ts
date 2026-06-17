import { appendFileSync, constants, createWriteStream, existsSync } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Container, Text } from "@earendil-works/pi-tui";
import { AI_DASH } from "ai-dash";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { waitForChildProcess } from "../../utils/child-process.ts";
import { getShellEnv, killProcessTree, trackDetachedChildPid, untrackDetachedChildPid } from "../../utils/shell.ts";
import type { AgentToolResult, ToolDefinition, ToolRenderResultOptions } from "../tool-types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { getTextOutput, invalidArgText } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

const bashSchema = Type.Object({
	command: Type.String({ description: "A single shell command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	run_in_background: Type.Optional(
		Type.Boolean({
			description:
				"Set to true to run this command in the background. You will be notified when it completes. Use this for long-running commands (builds, tests, servers) so you can continue with other work.",
		}),
	),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	metadata?: BashIntent;
	exitCode?: number | null;
}

export interface BashIntent {
	intent: "read" | "edit" | "list" | "search" | "fs" | "bash";
	cmd?: string;
	path?: string;
	compound?: boolean;
	redirect?: "write" | "append";
	heredoc?: boolean;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
			/** Called when the child process is spawned, before awaiting completion. */
			onSpawn?: (child: import("child_process").ChildProcess) => void;
		},
	) => Promise<{ exitCode: number | null; metadata?: BashIntent; stderr?: string }>;
}

/**
 * Create bash operations using ai-dash as the shell backend.
 * Spawns ai-dash -c <command> and reads fd 3 for semantic metadata.
 */
export function createLocalBashOperations(): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env, onSpawn }) => {
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}
			if (signal?.aborted) {
				throw new Error("aborted");
			}

			// Spawn ai-dash with fd 3 piped for metadata
			const child = spawn(AI_DASH, ["-c", command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: ["ignore", "pipe", "pipe", "pipe"],
				windowsHide: true,
			});
			if (child.pid) trackDetachedChildPid(child.pid);
			onSpawn?.(child);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			// Read fd 3 for semantic metadata
			let metadataJson = "";
			if (child.stdio[3]) {
				child.stdio[3].on("data", (chunk: Buffer) => {
					metadataJson += chunk.toString("utf-8");
				});
			}

			try {
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}
				child.stdout?.on("data", onData);
				// Collect stderr separately
				let stderrBuf = "";
				child.stderr?.on("data", (chunk: Buffer) => {
					stderrBuf += chunk.toString("utf-8");
				});
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				const exitCode = await waitForChildProcess(child);
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}

				// Parse metadata from fd 3
				let metadata: BashIntent | undefined;
				if (metadataJson) {
					try {
						const line = metadataJson.trim().split("\n")[0];
						if (line) metadata = JSON.parse(line);
					} catch {
						// Ignore parse errors
					}
				}

				return { exitCode, metadata, stderr: stderrBuf || undefined };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/** Task manager for background command execution */
	taskManager?: import("../task-manager.ts").TaskManager;
	/**
	 * Registry for mid-execution background requests.
	 * Key: toolCallId, Value: resolve function that backgrounds the running command.
	 * When resolve is called, the execute() stops waiting and moves the process to TaskManager.
	 */
	backgroundRegistry?: Map<string, (taskId: string) => void>;
	/** Enable read-before-write check for edit commands. Default: true */
	readBeforeWrite?: boolean;
}

const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
};

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
	/** Full styled output for collapsed visual truncation (null = not collapsed) */
	collapsedStyledOutput: string | null;
};

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
		collapsedStyledOutput: null,
	};

	override render(width: number): string[] {
		// If we have collapsed content, apply visual line truncation at render time
		if (this.state.collapsedStyledOutput !== null) {
			const { visualLines, skippedCount } = truncateToVisualLines(
				this.state.collapsedStyledOutput,
				BASH_PREVIEW_LINES,
				width,
				0,
			);
			this.state.cachedWidth = width;
			this.state.cachedLines = visualLines;
			this.state.cachedSkipped = skippedCount;
			if (process.env.TAU_DEBUG_TOOL_RESULT) {
				appendFileSync(
					"/tmp/bash-render.log",
					`[${new Date().toISOString()}] BashResultRender: collapsedStyledOutput exists → ${visualLines.length} lines (skipped=${skippedCount})\n`,
				);
			}
			return visualLines;
		}
		return super.render(width);
	}
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBashCall(args: { command?: string; timeout?: number } | undefined, expanded = false): string {
	const rawCommand = args?.command;
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	let commandDisplay: string;
	if (rawCommand === undefined || rawCommand === null) {
		commandDisplay = invalidArgText(theme);
	} else {
		commandDisplay = rawCommand || theme.fg("toolOutput", "...");
	}
	// Truncate long commands to BASH_PREVIEW_LINES when collapsed
	if (!expanded) {
		const lines = commandDisplay.split("\n");
		if (lines.length > BASH_PREVIEW_LINES) {
			commandDisplay = lines.slice(0, BASH_PREVIEW_LINES).join("\n");
		}
	}
	return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix;
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const _state = component.state;
	const _dbg = process.env.TAU_DEBUG_TOOL_RESULT;
	const _ts = () => new Date().toISOString();
	component.clear();

	const intent = result.details?.metadata?.intent;
	const exitCode = result.details?.exitCode;
	const failed = exitCode != null && exitCode !== 0;

	if (_dbg)
		appendFileSync(
			"/tmp/bash-rebuild.log",
			`[${_ts()}] === rebuildBashResultRenderComponent === expanded=${options.expanded} isPartial=${options.isPartial} intent=${intent} exitCode=${exitCode} failed=${failed}\n`,
		);

	if (!options.expanded && !options.isPartial) {
		if (!failed && (intent === "read" || intent === "list" || intent === "search")) {
			component.state.collapsedStyledOutput = null;
			if (_dbg)
				appendFileSync("/tmp/bash-rebuild.log", `[${_ts()}] → EARLY RETURN: hiding read/list/search result\n`);
			return;
		}
		if (_dbg)
			appendFileSync("/tmp/bash-rebuild.log", `[${_ts()}] → NOT hiding (intent=${intent} or failed=${failed})\n`);
	} else {
		if (_dbg)
			appendFileSync(
				"/tmp/bash-rebuild.log",
				`[${_ts()}] → Skipping intent check (expanded=${options.expanded} isPartial=${options.isPartial})\n`,
			);
	}

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			if (_dbg)
				appendFileSync(
					"/tmp/bash-rebuild.log",
					`[${_ts()}] → EXPANDED: adding full output as Text child (${styledOutput.split("\n").length} lines)\n`,
				);
			component.state.collapsedStyledOutput = null;
			component.addChild(new Text(styledOutput, 0, 0));
		} else {
			if (_dbg)
				appendFileSync(
					"/tmp/bash-rebuild.log",
					`[${_ts()}] → COLLAPSED: storing as collapsedStyledOutput (${styledOutput.split("\n").length} lines)\n`,
				);
			// Collapsed: store full content, visual truncation applied at render time
			component.state.collapsedStyledOutput = styledOutput;
		}
	} else {
		if (_dbg) appendFileSync("/tmp/bash-rebuild.log", `[${_ts()}] → NO OUTPUT: nothing to render\n`);
	}

	if (options.expanded) {
		if (truncation?.truncated || fullOutputPath) {
			const warnings: string[] = [];
			if (fullOutputPath) {
				warnings.push(`Full output: ${fullOutputPath}`);
			}
			if (truncation?.truncated) {
				if (truncation.truncatedBy === "lines") {
					warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
				} else {
					warnings.push(
						`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
					);
				}
			}
			component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
		}

		if (startedAt !== undefined) {
			const label = options.isPartial ? "Elapsed" : "Took";
			const endTime = endedAt ?? Date.now();
			const exitCode = result.details?.exitCode;
			const exitSuffix = exitCode != null && exitCode !== 0 ? ` ${theme.fg("warning", `(exit ${exitCode})`)}` : "";
			component.addChild(
				new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}${exitSuffix}`, 0, 0),
			);
		}
	}
}

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations();
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const readBeforeWrite = options?.readBeforeWrite ?? false;

	// Read-before-write tracking: paths that have been fully read
	const readFileState = new Set<string>();

	/**
	 * Split a command string by shell operators (|, &&, ||, ;),
	 * respecting quotes and subshell nesting.
	 * Returns an array of sub-command strings.
	 */
	function splitByShellOperators(cmd: string): string[] {
		const parts: string[] = [];
		let current = "";
		let inSingleQuote = false;
		let inDoubleQuote = false;
		let depth = 0;

		for (let i = 0; i < cmd.length; i++) {
			const c = cmd[i]!;

			if (inSingleQuote) {
				current += c;
				if (c === "'") inSingleQuote = false;
				continue;
			}
			if (inDoubleQuote) {
				current += c;
				if (c === '"' && (i === 0 || cmd[i - 1] !== "\\")) inDoubleQuote = false;
				continue;
			}

			if (c === "'") {
				inSingleQuote = true;
				current += c;
				continue;
			}
			if (c === '"') {
				inDoubleQuote = true;
				current += c;
				continue;
			}
			if (c === "(") {
				depth++;
				current += c;
				continue;
			}
			if (c === ")") {
				depth--;
				current += c;
				continue;
			}

			if (depth > 0) {
				current += c;
				continue;
			}

			// Shell operators
			if (c === "|") {
				parts.push(current);
				current = "";
				if (cmd[i + 1] === "|") i++; // skip ||
				continue;
			}
			if (c === "&" && cmd[i + 1] === "&") {
				parts.push(current);
				current = "";
				i++; // skip second &
				continue;
			}
			if (c === ";") {
				parts.push(current);
				current = "";
				continue;
			}

			current += c;
		}

		if (current.trim()) parts.push(current);
		return parts;
	}

	/**
	 * Parse a single (non-compound) command to detect edit operations.
	 * Returns the target file path if found, null otherwise.
	 */
	function extractSingleEditTarget(subcmd: string): string | null {
		const parts = subcmd.trim().split(/\s+/);
		if (parts.length < 2) return null;

		const bin = parts[0]?.split("/").pop() ?? parts[0]; // handle /usr/bin/edit

		// edit [-a] <path>
		if (bin === "edit") {
			for (let i = 1; i < parts.length; i++) {
				if (parts[i]!.startsWith("-")) continue;
				return parts[i]!;
			}
		}

		// sed -i[BUFFIX] ... <path>  (last non-flag arg)
		// perl -i[BUFFIX] ... <path> (last non-flag arg)
		if (bin === "sed" || bin === "perl") {
			let hasI = false;
			for (let i = 1; i < parts.length; i++) {
				if (parts[i] === "-i" || (parts[i]!.startsWith("-i") && parts[i]!.length > 2)) {
					hasI = true;
					break;
				}
			}
			if (hasI) {
				for (let i = parts.length - 1; i >= 1; i--) {
					if (!parts[i]!.startsWith("-")) return parts[i]!;
				}
			}
		}

		return null;
	}

	/**
	 * Parse a command string to detect edit operations (edit, sed -i, perl -i).
	 * Handles compound commands (pipes, &&, ||, ;) by splitting and scanning each part.
	 * Returns all target file paths found.
	 * This is a pre-execution check — we parse the command before running it.
	 */
	function extractEditTargets(cmd: string): string[] {
		const targets: string[] = [];
		const parts = splitByShellOperators(cmd);
		for (const part of parts) {
			const target = extractSingleEditTarget(part);
			if (target) targets.push(target);
		}
		return targets;
	}

	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		promptSnippet: "Execute shell commands via ai-dash. Use cat to read, edit to edit, grep to search, find to list.",
		parameters: bashSchema,
		async execute(
			_toolCallId: string,
			{ command, timeout, run_in_background }: { command: string; timeout?: number; run_in_background?: boolean },
			signal: AbortSignal | undefined,
			onUpdate: ((result: AgentToolResult<BashToolDetails | undefined>) => void) | undefined,
			_ctx: unknown,
		) {
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
			const taskManager = options?.taskManager;

			// For background tasks, ensure Python output is unbuffered
			if (run_in_background) {
				spawnContext.env.PYTHONUNBUFFERED = "1";
			}

			const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			let isBackgrounded = false;
			let bgLogStream: ReturnType<typeof createWriteStream> | undefined;
			const handleData = (data: Buffer) => {
				if (isBackgrounded) {
					bgLogStream?.write(data);
					return;
				}
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async () => {
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				// Read-before-write: pre-check edit commands (handles compound commands)
				if (readBeforeWrite) {
					const editTargets = extractEditTargets(command);
					for (const editTarget of editTargets) {
						const fullPath = pathResolve(spawnContext.cwd, editTarget);
						if (existsSync(fullPath) && !readFileState.has(fullPath)) {
							throw new Error(
								`File has not been read yet: ${editTarget}\n` +
									`To avoid editing the wrong lines, read the file first:\n` +
									`  cat ${editTarget}\n` +
									`or\n` +
									`  nl ${editTarget}`,
							);
						}
					}
				}

				let exitCode: number | null;
				let intent: BashIntent | undefined;
				let stderrOutput: string | undefined;

				// Set up background support: capture child process via onSpawn,
				// create a promise that resolves when background is triggered.
				let childProcess: import("child_process").ChildProcess | undefined;
				let backgroundResolve: ((taskId: string) => void) | undefined;
				const backgroundPromise = new Promise<{ backgrounded: true; taskId: string }>((resolve) => {
					backgroundResolve = (taskId: string) => resolve({ backgrounded: true, taskId });
				});

				// For run_in_background: resolve immediately after spawn
				const autoBackground = run_in_background && taskManager;

				// Register in backgroundRegistry so Ctrl+B can trigger it
				const bgRegistry = options?.backgroundRegistry;
				if (bgRegistry && backgroundResolve) {
					bgRegistry.set(_toolCallId, backgroundResolve);
				}

				try {
					// Race between normal execution and background signal
					const execPromise = ops
						.exec(spawnContext.command, spawnContext.cwd, {
							onData: handleData,
							signal,
							timeout,
							env: spawnContext.env,
							onSpawn: (child) => {
								childProcess = child;
								// For run_in_background: resolve after 0.1s to let exec set up
								if (autoBackground && backgroundResolve) {
									const resolve = backgroundResolve;
									setTimeout(() => {
										const bgTaskId = Math.random().toString(36).slice(2, 10);
										resolve(bgTaskId);
									}, 100);
								}
							},
						})
						.then((result) => ({ backgrounded: false as const, ...result }));

					const raceResult = await Promise.race([execPromise, backgroundPromise]);

					// Unregister from backgroundRegistry
					if (bgRegistry) {
						bgRegistry.delete(_toolCallId);
					}

					if (raceResult.backgrounded) {
						// Move process to TaskManager
						isBackgrounded = true;
						clearUpdateTimer();
						let registeredTaskId: string | undefined;
						if (childProcess && taskManager) {
							registeredTaskId = taskManager.register({
								command,
								description: command,
								process: childProcess,
							});
							// Open log stream and write existing output
							const task = taskManager.getTask(registeredTaskId);
							if (task) {
								bgLogStream = createWriteStream(task.outputPath, { flags: "a" });
								// Write existing output from accumulator
								const existingSnapshot = output.snapshot();
								if (existingSnapshot.content) {
									bgLogStream.write(existingSnapshot.content);
									if (!existingSnapshot.content.endsWith("\\n")) {
										bgLogStream.write(Buffer.from("\\n"));
									}
								}
							}
						}
						const bgTask = registeredTaskId ? taskManager?.getTask(registeredTaskId) : undefined;
						const pidNote = childProcess?.pid ? `\nPID: ${childProcess.pid}` : "";
						const outputNote = bgTask ? `\nOutput: ${bgTask.outputPath}` : "";
						return {
							content: [
								{
									type: "text",
									text: `Command moved to background (task ${registeredTaskId})${pidNote}${outputNote}`,
								},
							],
							details: {
								metadata: { intent: "bash" as const },
								isBackground: true,
								backgroundTaskId: registeredTaskId,
							},
						};
					}

					// Normal completion
					exitCode = raceResult.exitCode;
					intent = raceResult.metadata;
					stderrOutput = raceResult.stderr;

					// Read-before-write: record successfully read files
					if (intent?.intent === "read" && intent.path && !intent.compound) {
						const fullPath = pathResolve(spawnContext.cwd, intent.path);
						readFileState.add(fullPath);
					}
				} catch (err) {
					// Unregister from backgroundRegistry on error
					if (bgRegistry) {
						bgRegistry.delete(_toolCallId);
					}

					const snapshot = await finishOutput();
					const { text, details } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						return {
							content: [{ type: "text", text: appendStatus(text, "Command aborted") }],
							details: { ...details, metadata: intent, exitCode: null },
						};
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						return {
							content: [
								{
									type: "text",
									text: appendStatus(text, `Command timed out after ${timeoutSecs} seconds`),
								},
							],
							details: { ...details, metadata: intent, exitCode: null },
						};
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: rawOutput, details } = formatOutput(snapshot);

				// Append stderr with label if present
				const outputText = stderrOutput?.trim()
					? `${rawOutput}\n---\n[stderr]\n${stderrOutput.trimEnd()}`
					: rawOutput;

				return {
					content: [{ type: "text", text: outputText }],
					details: { ...details, metadata: intent, exitCode },
					isError: exitCode != null && exitCode !== 0,
				};
			} finally {
				clearUpdateTimer();
			}
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatBashCall(args, context.expanded));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
