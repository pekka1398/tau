export {
	type BashIntent,
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { createSubagentToolDefinition, type SubagentToolOptions } from "../subagent/tool.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "bash" | "subagent";
export const allToolNames: Set<ToolName> = new Set(["bash", "subagent"]);

export interface ToolsOptions {
	bash?: BashToolOptions;
	subagent?: SubagentToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	if (toolName === "bash") return createBashToolDefinition(cwd, options?.bash);
	if (toolName === "subagent") return createSubagentToolDefinition(options?.subagent);
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	// Subagent doesn't need a separate AgentTool wrapper; ToolDefinition is sufficient
	// for the registry (same as bash's ToolDefinition path).
	if (toolName === "bash") return createBashTool(cwd, options?.bash);
	if (toolName === "subagent") return createSubagentToolDefinition(options?.subagent) as ToolDef as Tool;
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		bash: createBashToolDefinition(cwd, options?.bash),
		subagent: createSubagentToolDefinition(options?.subagent),
	};
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		bash: createBashTool(cwd, options?.bash),
		subagent: createSubagentToolDefinition(options?.subagent) as ToolDef as Tool,
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createBashTool(cwd, options?.bash), createSubagentToolDefinition(options?.subagent) as ToolDef as Tool];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createBashTool(cwd, options?.bash)];
}
