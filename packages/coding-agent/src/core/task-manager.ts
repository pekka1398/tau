/**
 * Background task manager for tracking async bash commands.
 */

import { randomBytes } from "node:crypto";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

export interface BackgroundTask {
	id: string;
	command: string;
	description: string;
	status: TaskStatus;
	pid?: number;
	startTime: number;
	endTime?: number;
	exitCode?: number;
	outputPath: string;
	stderr?: string;
}

export interface TaskCompletedEvent {
	task: BackgroundTask;
}

export interface TaskManagerEvents {
	task_completed: TaskCompletedEvent;
	task_failed: TaskCompletedEvent;
}

/**
 * Manages background tasks (async bash commands).
 * Tracks running processes, collects output to disk, and emits events on completion.
 */
export class TaskManager {
	private tasks = new Map<string, BackgroundTask>();
	private processes = new Map<string, ChildProcess>();
	private outputStreams = new Map<string, WriteStream>();
	private emitter = new EventEmitter();
	private disposed = false;

	/**
	 * Register a new background task and start collecting its output.
	 * Returns a task ID that can be used to check status later.
	 */
	register(params: {
		command: string;
		description?: string;
		process: ChildProcess;
		onStdout?: (data: Buffer) => void;
	}): string {
		const id = this.generateTaskId();
		const outputPath = join(tmpdir(), `pi-task-${id}.log`);
		const stream = createWriteStream(outputPath);

		const task: BackgroundTask = {
			id,
			command: params.command,
			description: params.description ?? params.command,
			status: "running",
			pid: params.process.pid,
			startTime: Date.now(),
			outputPath,
		};

		this.tasks.set(id, task);
		this.processes.set(id, params.process);
		this.outputStreams.set(id, stream);

		// Collect stdout to file
		if (params.process.stdout) {
			params.process.stdout.on("data", (chunk: Buffer) => {
				stream.write(chunk);
				params.onStdout?.(chunk);
			});
		}

		// Collect stderr (also write to log file so progress bars etc. are captured)
		let stderrBuf = "";
		if (params.process.stderr) {
			params.process.stderr.on("data", (chunk: Buffer) => {
				stream.write(chunk);
				stderrBuf += chunk.toString("utf-8");
			});
		}

		// Handle completion
		params.process.on("close", (code) => {
			task.status = code === 0 ? "completed" : "failed";
			task.exitCode = code ?? undefined;
			task.endTime = Date.now();
			task.stderr = stderrBuf || undefined;

			stream.end();
			this.processes.delete(id);
			this.outputStreams.delete(id);

			if (!this.disposed) {
				const eventName = task.status === "completed" ? "task_completed" : "task_failed";
				this.emitter.emit(eventName, { task } satisfies TaskCompletedEvent);
			}
		});

		params.process.on("error", (err) => {
			task.status = "failed";
			task.endTime = Date.now();
			task.stderr = err.message;

			stream.end();
			this.processes.delete(id);
			this.outputStreams.delete(id);

			if (!this.disposed) {
				this.emitter.emit("task_failed", { task } satisfies TaskCompletedEvent);
			}
		});

		return id;
	}

	/** Get a task by ID. */
	getTask(id: string): BackgroundTask | undefined {
		return this.tasks.get(id);
	}

	/** Get all tasks. */
	getAllTasks(): BackgroundTask[] {
		return Array.from(this.tasks.values());
	}

	/** Get only running tasks. */
	getRunningTasks(): BackgroundTask[] {
		return this.getAllTasks().filter((t) => t.status === "running");
	}

	/** Kill a running task by ID. */
	kill(id: string): boolean {
		const proc = this.processes.get(id);
		const task = this.tasks.get(id);
		if (!proc || !task || task.status !== "running") {
			return false;
		}

		task.status = "killed";
		task.endTime = Date.now();

		try {
			proc.kill("SIGTERM");
		} catch {
			// Process may already be dead
		}

		const stream = this.outputStreams.get(id);
		if (stream) {
			stream.end();
			this.outputStreams.delete(id);
		}
		this.processes.delete(id);

		this.emitter.emit("task_failed", { task } satisfies TaskCompletedEvent);
		return true;
	}

	/** Subscribe to task events. */
	on(event: "task_completed" | "task_failed", handler: (data: TaskCompletedEvent) => void): () => void {
		this.emitter.on(event, handler);
		return () => this.emitter.off(event, handler);
	}

	/** Clean up all resources. */
	dispose(): void {
		this.disposed = true;
		for (const [id] of this.processes) {
			this.kill(id);
		}
		this.emitter.removeAllListeners();
	}

	private generateTaskId(): string {
		return randomBytes(6).toString("hex");
	}
}
