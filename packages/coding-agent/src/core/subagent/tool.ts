/**
 * SubagentTool - Delegate tasks to specialized agents with isolated context.
 *
 * Supports three execution modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Each mode can run synchronously (blocking) or asynchronously (background).
 * Background tasks are tracked via TaskRegistry and inject notifications
 * into the main agent when they complete.
 */

import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { getSubagentOutput, getSubagentUsage, runSubagent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../tool-types.ts";
import type { AgentConfig, AgentScope } from "./agents.ts";
import { discoverAgents } from "./agents.ts";
import type { TaskRegistry } from "./task-registry.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

// ============================================================================
// Types
// ============================================================================

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	output: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	isAsync?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function truncateOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted]`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

// ============================================================================
// Single agent execution (sync)
// ============================================================================

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	agents: AgentConfig[],
	agentName: string,
	task: string,
	model: import("@earendil-works/pi-ai").Model<any> | undefined,
	getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined,
	streamFn: import("@earendil-works/pi-agent-core").StreamFn | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	parentTools?: import("@earendil-works/pi-agent-core").AgentTool<any>[],
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			output: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		};
	}

	const taskMessages: import("@earendil-works/pi-agent-core").AgentMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: `Task: ${task}` }],
			timestamp: Date.now(),
		},
	];

	const tools = parentTools ?? [];
	const resolvedModel = model;
	const allMessages: import("@earendil-works/pi-agent-core").AgentMessage[] = [];

	try {
		const stream = runSubagent({
			model: resolvedModel!,
			systemPrompt: agent.systemPrompt,
			messages: taskMessages,
			tools,
			getApiKey,
			streamFn,
			signal,
		});

		for await (const event of stream) {
			if (event.type === "message_end") {
				allMessages.push(event.message);

				if (onUpdate && event.message.role === "assistant") {
					const usage = getSubagentUsage(allMessages);
					onUpdate({
						content: [{ type: "text", text: getSubagentOutput(allMessages) || "(running...)" }],
						details: makeDetails([
							{
								agent: agentName,
								agentSource: agent.source,
								task,
								output: getSubagentOutput(allMessages) || "(running...)",
								usage,
								model: resolvedModel?.id,
							},
						]),
					});
				}
			}
		}

		const finalMessages = await stream.result();
		const output = getSubagentOutput(finalMessages);
		const usage = getSubagentUsage(finalMessages);

		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			output,
			usage,
			model: resolvedModel?.id,
		};
	} catch (error) {
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			output: error instanceof Error ? error.message : String(error),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			model: resolvedModel?.id,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

// ============================================================================
// Async execution helper
// ============================================================================

/**
 * Run a single agent in the background. Returns immediately; the task is
 * tracked in the TaskRegistry and a notification fires on completion.
 */
function runSingleAgentAsync(
	taskRegistry: TaskRegistry,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	model: import("@earendil-works/pi-ai").Model<any> | undefined,
	getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined,
	streamFn: import("@earendil-works/pi-agent-core").StreamFn | undefined,
	parentTools?: import("@earendil-works/pi-agent-core").AgentTool<any>[],
): string {
	const taskId = randomUUID();
	const abortController = new AbortController();

	taskRegistry.register({
		id: taskId,
		agentType: agentName,
		description: task,
		status: "running",
		abortController,
	});

	// Fire-and-forget
	void (async () => {
		try {
			const result = await runSingleAgent(
				agents,
				agentName,
				task,
				model,
				getApiKey,
				streamFn,
				abortController.signal,
				undefined, // no onUpdate for background tasks (could add later)
				(results) => ({ mode: "single", agentScope: "user", projectAgentsDir: null, results, isAsync: true }),
				parentTools,
			);

			if (result.errorMessage) {
				taskRegistry.fail(taskId, result.errorMessage);
			} else {
				taskRegistry.complete(taskId, result);
			}
		} catch (error) {
			taskRegistry.fail(taskId, error instanceof Error ? error.message : String(error));
		}
	})();

	return taskId;
}

// ============================================================================
// Tool definition
// ============================================================================

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(
		Type.String({
			description: 'Which agent directories to use: "user", "project", or "both". Default: "user".',
			default: "user",
		}),
	),
	run_in_background: Type.Optional(
		Type.Boolean({
			description: "Run the agent in the background without blocking the main agent. Default: false.",
			default: false,
		}),
	),
});

interface SubagentToolParams {
	agent?: string;
	task?: string;
	tasks?: Array<{ agent: string; task: string }>;
	chain?: Array<{ agent: string; task: string }>;
	agentScope?: string;
	run_in_background?: boolean;
}

/**
 * Options for creating the subagent tool.
 */
export interface SubagentToolOptions {
	/** Task registry for background execution. Enables run_in_background mode. */
	taskRegistry?: TaskRegistry;
	/** Get the current set of tools available to the parent agent. Passed to subagents. */
	getTools?: () => import("@earendil-works/pi-agent-core").AgentTool<any>[];
}

/**
 * Create the SubagentTool definition.
 *
 * @param options - Options including optional task registry for background execution.
 *   When taskRegistry is provided, enables `run_in_background` mode. The registry's
 *   notification callback should be configured by the AgentSession to inject results
 *   back into the main agent conversation.
 */
export function createSubagentToolDefinition(
	options?: SubagentToolOptions,
): ToolDefinition<typeof SubagentParams, SubagentDetails> {
	const taskRegistry = options?.taskRegistry;
	const getTools = options?.getTools;
	return {
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default agent scope is "user" (from ~/.pi/agent/agents).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
			"Set run_in_background: true to run without blocking the main agent.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const p = params as SubagentToolParams;
			const agentScope: AgentScope = (p.agentScope as AgentScope) ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const isAsync = p.run_in_background === true && taskRegistry !== undefined;

			const hasChain = (p.chain?.length ?? 0) > 0;
			const hasTasks = (p.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(p.agent && p.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					isAsync,
				});

			// Validate: exactly one mode must be specified
			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			// Get model and auth from context
			const model = ctx.model;
			const getApiKey = ctx.modelRegistry
				? async (_provider: string) => {
						if (!model) return undefined;
						const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
						return result.ok ? result.apiKey : undefined;
					}
				: undefined;

			// ================================================================
			// Async (background) mode
			// ================================================================
			if (isAsync) {
				// Single async
				if (p.agent && p.task) {
					const taskId = runSingleAgentAsync(
						taskRegistry,
						agents,
						p.agent,
						p.task,
						model,
						getApiKey,
						undefined,
						getTools?.(),
					);
					return {
						content: [
							{
								type: "text",
								text: `Background agent launched.\nAgent: ${p.agent}\nTask: ${p.task}\nID: ${taskId}\n\nThe agent is working in the background. You will be notified when it completes. Continue with other work.`,
							},
						],
						details: makeDetails("single")([]),
					};
				}

				// Parallel async
				if (p.tasks && p.tasks.length > 0) {
					const taskIds = p.tasks.map((t) =>
						runSingleAgentAsync(taskRegistry, agents, t.agent, t.task, model, getApiKey, undefined, getTools?.()),
					);
					return {
						content: [
							{
								type: "text",
								text: `${taskIds.length} background agents launched.\n${p.tasks.map((t, i) => `  ${i + 1}. [${t.agent}] ${t.task} (ID: ${taskIds[i]})`).join("\n")}\n\nThe agents are working in the background. You will be notified as each completes. Continue with other work.`,
							},
						],
						details: makeDetails("parallel")([]),
					};
				}

				// Chain cannot be async (each step depends on previous output)
				if (p.chain) {
					// Fall through to sync execution below
				}
			}

			// ================================================================
			// Sync mode
			// ================================================================

			// Chain mode (always sync)
			if (p.chain && p.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < p.chain.length; i++) {
					const step = p.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					const result = await runSingleAgent(
						agents,
						step.agent,
						taskWithContext,
						model,
						getApiKey,
						undefined,
						signal,
						onUpdate
							? (partial) => {
									const currentResult = partial.details?.results[0];
									if (currentResult) {
										onUpdate({
											content: partial.content,
											details: makeDetails("chain")([...results, currentResult]),
										});
									}
								}
							: undefined,
						makeDetails("chain"),
						getTools?.(),
					);
					result.step = i + 1;
					results.push(result);

					if (result.errorMessage) {
						return {
							content: [
								{
									type: "text",
									text: `Chain stopped at step ${i + 1} (${step.agent}): ${result.output}`,
								},
							],
							details: makeDetails("chain")(results),
						};
					}
					previousOutput = result.output;
				}
				return {
					content: [
						{
							type: "text",
							text: results[results.length - 1]?.output || "(no output)",
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			// Parallel mode (sync)
			if (p.tasks && p.tasks.length > 0) {
				if (p.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${p.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};
				}

				const allResults: SingleResult[] = new Array(p.tasks.length);

				const results = await mapWithConcurrencyLimit(p.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						agents,
						t.agent,
						t.task,
						model,
						getApiKey,
						undefined,
						signal,
						onUpdate
							? (partial) => {
									if (partial.details?.results[0]) {
										allResults[index] = partial.details.results[0];
										onUpdate({
											content: partial.content,
											details: makeDetails("parallel")(allResults.filter(Boolean)),
										});
									}
								}
							: undefined,
						makeDetails("parallel"),
						getTools?.(),
					);
					allResults[index] = result;
					return result;
				});

				const successCount = results.filter((r) => !r.errorMessage).length;
				const summaries = results.map((r) => {
					const output = truncateOutput(r.output);
					const status = r.errorMessage ? "failed" : "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			// Single mode (sync)
			if (p.agent && p.task) {
				const result = await runSingleAgent(
					agents,
					p.agent,
					p.task,
					model,
					getApiKey,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
					getTools?.(),
				);
				if (result.errorMessage) {
					return {
						content: [{ type: "text", text: `Agent failed: ${result.output}` }],
						details: makeDetails("single")([result]),
					};
				}
				return {
					content: [{ type: "text", text: result.output || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			// Fallback
			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},
	};
}
