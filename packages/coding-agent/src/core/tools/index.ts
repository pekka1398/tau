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
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "bash";
export const allToolNames: Set<ToolName> = new Set(["bash"]);

export interface ToolsOptions {
	bash?: BashToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	if (toolName === "bash") return createBashToolDefinition(cwd, options?.bash);
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	if (toolName === "bash") return createBashTool(cwd, options?.bash);
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return { bash: createBashToolDefinition(cwd, options?.bash) };
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return { bash: createBashTool(cwd, options?.bash) };
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createBashTool(cwd, options?.bash)];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createBashTool(cwd, options?.bash)];
}
