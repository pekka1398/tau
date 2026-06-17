/**
 * SubagentTool - Delegate tasks to specialized agents with isolated context.
 *
 * Supports four execution modes:
 *   - Fork:   { task: "..." } (inherits parent context, prompt cache sharing)
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Each mode can run synchronously (blocking) or asynchronously (background).
 * Background tasks are tracked via TaskRegistry and inject notifications
 * into the main agent when they complete.
 *
 * Tool inheritance: subagents receive a filtered tool pool based on the
 * agent definition's `tools` field. '*' or undefined means all tools.
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentToolResult } from "@earendil-works/pi-agent-core";
import { getSubagentOutput, getSubagentUsage, runSubagent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../tool-types.ts";
import type { AgentConfig, AgentScope } from "./agents.ts";
import { discoverAgents } from "./agents.ts";
import { buildForkedMessages, isInForkChild } from "./fork.ts";
import type { TaskRegistry } from "./task-registry.ts";
import { recordTranscript, writeAgentMetadata } from "./transcript.ts";
import { createAgentWorktree, hasWorktreeChanges, removeAgentWorktree, type WorktreeInfo } from "./worktree.ts";

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
	agentSource: "user" | "project" | "built-in" | "unknown";
	task: string;
	output: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain" | "fork";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	isAsync?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve which tools an agent should have access to based on its definition.
 *
 * - tools: undefined or ['*'] → all available tools
 * - tools: ['bash', 'transcribe'] → only those tools
 * - Model 'inherit' is resolved by the caller (not here)
 */
export function resolveAgentTools(
	agent: AgentConfig,
	availableTools: import("@earendil-works/pi-agent-core").AgentTool<any>[],
): import("@earendil-works/pi-agent-core").AgentTool<any>[] {
	// No tool restriction or wildcard → all tools
	if (!agent.tools || agent.tools.length === 0 || agent.tools.includes("*")) {
		return availableTools;
	}

	const allowedNames = new Set(agent.tools);
	return availableTools.filter((t) => allowedNames.has(t.name));
}

/**
 * Resolve the model for an agent, handling 'inherit' semantics.
 */
export function resolveAgentModel(
	agent: AgentConfig,
	parentModel: import("@earendil-works/pi-ai").Model<any> | undefined,
	fallbackModel: import("@earendil-works/pi-ai").Model<any> | undefined,
): import("@earendil-works/pi-ai").Model<any> | undefined {
	if (agent.model === "inherit") {
		return parentModel;
	}
	// If agent has a specific model override, it would be resolved here.
	// For now, fall back to the caller-provided model.
	return fallbackModel;
}

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

	// Resolve tools based on agent definition
	const availableTools = parentTools ?? [];
	const tools = resolveAgentTools(agent, availableTools);
	const resolvedModel = resolveAgentModel(agent, model, model);
	const allMessages: import("@earendil-works/pi-agent-core").AgentMessage[] = [];
	const agentRunId = randomUUID();

	// Record agent metadata
	writeAgentMetadata(agentRunId, { agentType: agentName, task, source: agent.source });

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
			}

			// Forward progress on any event type
			if (onUpdate) {
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

		const finalMessages = await stream.result();
		const output = getSubagentOutput(finalMessages);
		const usage = getSubagentUsage(finalMessages);

		// Record transcript
		recordTranscript(agentRunId, finalMessages);

		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			output,
			usage,
			model: resolvedModel?.id,
		};
	} catch (error) {
		// Record partial transcript on error
		if (allMessages.length > 0) {
			recordTranscript(agentRunId, allMessages);
		}

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
// Fork agent execution
// ============================================================================

/**
 * Run a fork agent with pre-built messages (inherited from parent context).
 * Unlike runSingleAgent, this doesn't construct messages from an agent definition
 * — it uses the parent's conversation + fork directive directly.
 */
async function runForkAgent(
	messages: AgentMessage[],
	systemPrompt: string,
	tools: import("@earendil-works/pi-agent-core").AgentTool<any>[],
	model: import("@earendil-works/pi-ai").Model<any> | undefined,
	getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined,
	streamFn: import("@earendil-works/pi-agent-core").StreamFn | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const allMessages: AgentMessage[] = [];
	const agentRunId = randomUUID();

	// Record agent metadata
	writeAgentMetadata(agentRunId, { agentType: "fork", task: "(inherited context)" });

	try {
		const stream = runSubagent({
			model: model!,
			systemPrompt,
			messages,
			tools,
			getApiKey,
			streamFn,
			signal,
		});

		for await (const event of stream) {
			if (event.type === "message_end") {
				allMessages.push(event.message);
			}

			// Forward progress on any event type
			if (onUpdate) {
				const usage = getSubagentUsage(allMessages);
				onUpdate({
					content: [{ type: "text", text: getSubagentOutput(allMessages) || "(running...)" }],
					details: makeDetails([
						{
							agent: "fork",
							agentSource: "unknown",
							task: "(inherited context)",
							output: getSubagentOutput(allMessages) || "(running...)",
							usage,
							model: model?.id,
						},
					]),
				});
			}
		}

		const finalMessages = await stream.result();
		const output = getSubagentOutput(finalMessages);
		const usage = getSubagentUsage(finalMessages);

		// Record transcript
		recordTranscript(agentRunId, finalMessages);

		return {
			agent: "fork",
			agentSource: "unknown",
			task: "(inherited context)",
			output,
			usage,
			model: model?.id,
		};
	} catch (error) {
		// Record partial transcript on error
		if (allMessages.length > 0) {
			recordTranscript(agentRunId, allMessages);
		}

		return {
			agent: "fork",
			agentSource: "unknown",
			task: "(inherited context)",
			output: error instanceof Error ? error.message : String(error),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			model: model?.id,
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
	isolation: Type.Optional(
		Type.String({
			description: 'Isolation mode. "worktree" creates a temporary git worktree for the agent.',
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
	isolation?: string;
}

/**
 * Options for creating the subagent tool.
 */
export interface SubagentToolOptions {
	/** Task registry for background execution. Enables run_in_background mode. */
	taskRegistry?: TaskRegistry;
	/** Get the current set of tools available to the parent agent. Passed to subagents. */
	getTools?: () => import("@earendil-works/pi-agent-core").AgentTool<any>[];
	/** Get the parent's conversation messages. Used for fork mode context inheritance. */
	getParentMessages?: () => AgentMessage[];
	/** Get the parent's system prompt. Used for fork mode (cache-identical prefix). */
	getParentSystemPrompt?: () => string;
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
	const getParentMessages = options?.getParentMessages;
	const getParentSystemPrompt = options?.getParentSystemPrompt;
	return {
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes:",
			"  - fork: { task } — inherits parent conversation context, prompt cache sharing",
			"  - single: { agent, task } — uses named agent definition",
			"  - parallel: { tasks } — multiple agents concurrently",
			"  - chain: { chain } — sequential with {previous} placeholder",
			'Default agent scope is "user" (from ~/.tau/agent/agents).',
			"To use project-local agents, set agentScope: 'both'.",
			"Set run_in_background: true to run without blocking the main agent.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const p = params as SubagentToolParams;
			const agentScope: AgentScope = (p.agentScope as AgentScope) ?? "user";
			const cwd = ctx?.cwd ?? process.cwd();
			const discovery = discoverAgents(cwd, agentScope);
			const agents = discovery.agents;
			const isAsync = p.run_in_background === true && taskRegistry !== undefined;

			// Resolve isolation: param > agent definition > none
			const resolvedIsolation = p.isolation;

			const hasChain = (p.chain?.length ?? 0) > 0;
			const hasTasks = (p.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(p.agent && p.task);
			const hasFork = Boolean(p.task && !p.agent && !p.tasks && !p.chain);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle) + Number(hasFork);

			const makeDetails =
				(mode: "single" | "parallel" | "chain" | "fork") =>
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
			const model = ctx?.model;
			const getApiKey = ctx?.modelRegistry
				? async (_provider: string) => {
						if (!model) return undefined;
						const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
						return result.ok ? result.apiKey : undefined;
					}
				: undefined;

			// ================================================================
			// Worktree isolation
			// ================================================================
			let worktreeInfo: WorktreeInfo | null = null;
			if (resolvedIsolation === "worktree") {
				const slug = randomUUID().slice(0, 8);
				worktreeInfo = createAgentWorktree(cwd, slug);
			}

			// Cleanup helper — checks for changes, removes if clean
			const cleanupWorktree = async (): Promise<{ worktreePath?: string; worktreeBranch?: string }> => {
				if (!worktreeInfo) return {};
				const { worktreePath, worktreeBranch, headCommit, gitRoot } = worktreeInfo;
				worktreeInfo = null; // idempotent

				if (hasWorktreeChanges(worktreePath, headCommit)) {
					return { worktreePath, worktreeBranch };
				}
				removeAgentWorktree(worktreePath, worktreeBranch, gitRoot);
				return {};
			};

			try {
				// ================================================================
				// Fork mode — inherit parent context, prompt cache sharing
				// ================================================================
				if (hasFork) {
					const parentMessages = getParentMessages?.();
					const parentSystemPrompt = getParentSystemPrompt?.();

					// Guard: need parent context for fork mode
					if (!parentMessages || parentMessages.length === 0) {
						// Fall back to single mode with general-purpose agent
						const fallbackAgent = agents.find((a) => a.name === "general-purpose");
						if (!fallbackAgent) {
							return {
								content: [
									{ type: "text", text: "Fork mode requires parent context. No parent messages available." },
								],
								details: makeDetails("fork")([]),
							};
						}
						// Fall through to single mode below
					} else {
						// Guard against recursive forking
						if (isInForkChild(parentMessages)) {
							return {
								content: [
									{
										type: "text",
										text: "Fork is not available inside a forked worker. Complete your task directly.",
									},
								],
								details: makeDetails("fork")([]),
							};
						}

						const forkMessages = buildForkedMessages(parentMessages, p.task!);

						// Inject worktree notice if isolated
						if (worktreeInfo) {
							forkMessages.push({
								role: "user",
								content: [
									{
										type: "text",
										text: `You are operating in an isolated git worktree at ${worktreeInfo.worktreePath}. Paths in the inherited context refer to the parent's working directory (${cwd}); translate them to your worktree root. Re-read files before editing. Your changes stay in this worktree.`,
									},
								],
								timestamp: Date.now(),
							});
						}

						const forkSystemPrompt =
							parentSystemPrompt ?? agents.find((a) => a.name === "general-purpose")?.systemPrompt ?? "";
						const allTools = getTools?.() ?? [];

						if (isAsync && taskRegistry) {
							// Async fork
							const taskId = randomUUID();
							const abortController = new AbortController();
							taskRegistry.register({
								id: taskId,
								agentType: "fork",
								description: p.task!,
								status: "running",
								abortController,
							});

							void (async () => {
								try {
									const result = await runForkAgent(
										forkMessages,
										forkSystemPrompt,
										allTools,
										model,
										getApiKey,
										undefined,
										abortController.signal,
										undefined,
										makeDetails("fork"),
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

							return {
								content: [
									{
										type: "text",
										text: `Fork agent launched in background.\nTask: ${p.task}\nID: ${taskId}\n\nThe agent inherited your conversation context. You will be notified when it completes.`,
									},
								],
								details: makeDetails("fork")([]),
							};
						}

						// Sync fork
						const result = await runForkAgent(
							forkMessages,
							forkSystemPrompt,
							allTools,
							model,
							getApiKey,
							undefined, // streamFn — uses default
							signal,
							onUpdate
								? (partial) => {
										onUpdate(partial);
									}
								: undefined,
							makeDetails("fork"),
						);

						if (result.errorMessage) {
							return {
								content: [{ type: "text", text: `Fork agent failed: ${result.output}` }],
								details: makeDetails("fork")([result]),
							};
						}
						return {
							content: [{ type: "text", text: result.output || "(no output)" }],
							details: makeDetails("fork")([result]),
						};
					}
				}

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
							runSingleAgentAsync(
								taskRegistry,
								agents,
								t.agent,
								t.task,
								model,
								getApiKey,
								undefined,
								getTools?.(),
							),
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
			} finally {
				await cleanupWorktree();
			}
		},
	};
}
