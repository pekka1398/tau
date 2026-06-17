import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import type { TaskManager } from "../../../core/task-manager.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function _sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private thinkingHidden = false;
	private toolsExpanded = false;
	private taskManager: TaskManager | undefined;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		void footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setThinkingHidden(hidden: boolean): void {
		this.thinkingHidden = hidden;
	}

	setToolsExpanded(expanded: boolean): void {
		this.toolsExpanded = expanded;
	}

	setTaskManager(taskManager: TaskManager): void {
		this.taskManager = taskManager;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const _state = this.session.state;

		// Use last assistant message's usage (per-turn, not cumulative)
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let newTokens = 0;
		let cost = 0;
		let actualCost: number | undefined;

		const entries = this.session.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const u = entry.message.usage;
				input = u.input;
				output = u.output;
				cacheRead = u.cacheRead;
				newTokens = u.input;
				cost = u.cost.total;
				actualCost = u.actualCost;
				break;
			}
		}

		// Build compact footer: in:X(R:X/N:X) out:X $X(P:$X)
		// $ = actual cost from API, P = config-based predicted cost
		const totalPrompt = input + cacheRead;
		const inParts = [`R:${formatTokens(cacheRead)}`, `N:${formatTokens(newTokens)}`];
		const costPart = actualCost !== undefined ? ` $${actualCost.toFixed(4)}(P:$${cost.toFixed(4)})` : "";
		const statsLine = `in:${formatTokens(totalPrompt)}(${inParts.join("/")}) out:${formatTokens(output)}${costPart}`;

		// Build left side: toggle state indicators
		const thinkingLabel = this.thinkingHidden ? "[thinking:hidden]" : "[thinking:show]";
		const toolsLabel = this.toolsExpanded ? "[toolresult:show]" : "[toolresult:hidden]";
		const leftSide = `${toolsLabel} ${thinkingLabel}`;

		// Combine left + right with padding, truncate if content exceeds width
		let combined: string;
		const totalLength = leftSide.length + 1 + statsLine.length; // +1 for min separator
		if (totalLength <= width) {
			combined = leftSide + " ".repeat(width - leftSide.length - statsLine.length) + statsLine;
		} else {
			// Content exceeds width: truncate stats line to fit
			const availableForStats = width - leftSide.length - 1; // -1 for separator
			if (availableForStats > 0) {
				const truncatedStats = truncateToWidth(statsLine, availableForStats);
				combined = `${leftSide} ${truncatedStats}`;
			} else {
				// Even left side exceeds width, truncate everything
				combined = truncateToWidth(`${leftSide} ${statsLine}`, width);
			}
		}

		// Build second line for background tasks
		const runningTasks = this.taskManager?.getRunningTasks() ?? [];
		if (runningTasks.length === 0) {
			return [theme.fg("dim", combined)];
		}

		// Show background task info
		const bgParts: string[] = [];
		for (const task of runningTasks) {
			// Get command name (first word, truncated)
			const cmdName = task.command.split(/\s+/)[0] ?? task.command;
			const cmdTruncated = cmdName.length > 20 ? `${cmdName.slice(0, 17)}...` : cmdName;

			// Read last line of log file
			let lastLine = "";
			try {
				const content = readFileSync(task.outputPath, "utf-8");
				const lines = content.split("\n").filter((l) => l.length > 0);
				if (lines.length > 0) {
					lastLine = lines[lines.length - 1] ?? "";
					// Truncate to 30 chars
					if (lastLine.length > 30) {
						lastLine = `${lastLine.slice(0, 27)}...`;
					}
					// Sanitize: remove control chars
					lastLine = lastLine.replace(/[\x00-\x1f\x7f]/g, "").trim();
				}
			} catch {
				// File may not exist yet or be locked
			}

			const taskInfo = lastLine ? `[bg:${cmdTruncated}] ${lastLine}` : `[bg:${cmdTruncated}]`;
			bgParts.push(taskInfo);
		}

		const bgLine = bgParts.join(" | ");
		const bgTruncated = bgLine.length > width ? `${bgLine.slice(0, width - 3)}...` : bgLine;

		return [theme.fg("dim", combined), theme.fg("accent", bgTruncated)];
	}
}
