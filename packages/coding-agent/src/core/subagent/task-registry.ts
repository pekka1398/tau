/**
 * TaskRegistry - Tracks background subagent tasks.
 *
 * When a subagent runs in async mode, it registers here.
 * The registry tracks status, progress, and injects notifications
 * back into the main agent when tasks complete.
 */

import type { SingleResult } from "./tool.ts";

// ============================================================================
// Types
// ============================================================================

export interface SubagentTask {
	id: string;
	agentType: string;
	description: string;
	status: "running" | "completed" | "failed" | "killed";
	abortController: AbortController;
	progress: {
		toolUseCount: number;
		tokenCount: number;
		lastActivity?: string;
	};
	startTime: number;
	endTime?: number;
	result?: SingleResult;
	error?: string;
}

export type NotificationCallback = (task: SubagentTask, result: SingleResult) => void;

// ============================================================================
// Registry
// ============================================================================

export class TaskRegistry {
	private tasks = new Map<string, SubagentTask>();
	private onNotification: NotificationCallback | null = null;

	/**
	 * Set the callback that fires when a background task completes.
	 * Used by AgentSession to inject notifications into the main agent.
	 */
	setNotificationCallback(callback: NotificationCallback): void {
		this.onNotification = callback;
	}

	/**
	 * Register a new background task.
	 */
	register(task: Omit<SubagentTask, "progress" | "startTime">): SubagentTask {
		const fullTask: SubagentTask = {
			...task,
			progress: { toolUseCount: 0, tokenCount: 0 },
			startTime: Date.now(),
		};
		this.tasks.set(task.id, fullTask);
		return fullTask;
	}

	/**
	 * Update progress for a running task.
	 */
	updateProgress(taskId: string, progress: { toolUseCount: number; tokenCount: number; lastActivity?: string }): void {
		const task = this.tasks.get(taskId);
		if (task && task.status === "running") {
			task.progress = progress;
		}
	}

	/**
	 * Mark a task as completed and fire notification.
	 */
	complete(taskId: string, result: SingleResult): void {
		const task = this.tasks.get(taskId);
		if (!task || task.status !== "running") return;

		task.status = "completed";
		task.endTime = Date.now();
		task.result = result;

		this.onNotification?.(task, result);
	}

	/**
	 * Mark a task as failed and fire notification.
	 */
	fail(taskId: string, error: string): void {
		const task = this.tasks.get(taskId);
		if (!task || task.status !== "running") return;

		task.status = "failed";
		task.endTime = Date.now();
		task.error = error;

		const failResult: SingleResult = {
			agent: task.agentType,
			agentSource: "unknown",
			task: task.description,
			output: error,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			errorMessage: error,
		};
		this.onNotification?.(task, failResult);
	}

	/**
	 * Kill a running task.
	 */
	kill(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task || task.status !== "running") return;

		task.abortController.abort();
		task.status = "killed";
		task.endTime = Date.now();
	}

	/**
	 * Get a specific task.
	 */
	get(taskId: string): SubagentTask | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * Get all tasks.
	 */
	getAll(): SubagentTask[] {
		return Array.from(this.tasks.values());
	}

	/**
	 * Get running tasks only.
	 */
	getRunning(): SubagentTask[] {
		return this.getAll().filter((t) => t.status === "running");
	}

	/**
	 * Kill all running tasks.
	 */
	killAll(): void {
		for (const task of this.tasks.values()) {
			if (task.status === "running") {
				this.kill(task.id);
			}
		}
	}
}

// ============================================================================
// Notification formatting
// ============================================================================

/**
 * Build a human-readable notification message for a completed/failed task.
 */
export function formatTaskNotification(task: SubagentTask, result: SingleResult): string {
	const duration = task.endTime ? Math.round((task.endTime - task.startTime) / 1000) : 0;
	const status = task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "stopped";

	const parts = [`[Subagent "${task.agentType}" ${status}]`, `Task: ${task.description}`];

	if (result.usage.turns > 0) {
		const usageParts: string[] = [];
		if (result.usage.turns) usageParts.push(`${result.usage.turns} turns`);
		if (result.usage.input) usageParts.push(`input: ${result.usage.input}`);
		if (result.usage.output) usageParts.push(`output: ${result.usage.output}`);
		if (result.usage.cost > 0) usageParts.push(`cost: $${result.usage.cost.toFixed(4)}`);
		if (duration > 0) usageParts.push(`${duration}s`);
		parts.push(`Usage: ${usageParts.join(", ")}`);
	}

	if (result.output && result.output.length > 0) {
		// Truncate long outputs in notifications
		const maxLen = 2000;
		const output = result.output.length > maxLen ? `${result.output.slice(0, maxLen)}...` : result.output;
		parts.push(`\n${output}`);
	}

	return parts.join("\n");
}
