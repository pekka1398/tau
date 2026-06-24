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
export { createEditRedirectToolDefinition } from "./edit-redirect.ts";
export { createTranscribeToolDefinition } from "./transcribe.ts";
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
export { createVisionToolDefinition } from "./vision.ts";

import type { AgentTool } from "../agent/index.ts";
import { createSubagentToolDefinition, type SubagentToolOptions } from "../subagent/tool.ts";
import type { ToolDefinition } from "../tool-types.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditRedirectToolDefinition } from "./edit-redirect.ts";
import { createTranscribeToolDefinition } from "./transcribe.ts";
import { createVisionToolDefinition } from "./vision.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName = "bash" | "subagent" | "transcribe" | "vision" | "edit";
export const allToolNames: Set<ToolName> = new Set(["bash", "subagent", "transcribe", "vision", "edit"]);

export interface ToolsOptions {
	bash?: BashToolOptions;
	subagent?: SubagentToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	if (toolName === "bash") return createBashToolDefinition(cwd, options?.bash);
	if (toolName === "subagent") return createSubagentToolDefinition(options?.subagent);
	if (toolName === "transcribe") return createTranscribeToolDefinition();
	if (toolName === "vision") return createVisionToolDefinition();
	if (toolName === "edit") return createEditRedirectToolDefinition();
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	if (toolName === "bash") return createBashTool(cwd, options?.bash);
	if (toolName === "subagent") return createSubagentToolDefinition(options?.subagent) as ToolDef as Tool;
	if (toolName === "transcribe") return createTranscribeToolDefinition() as ToolDef as Tool;
	if (toolName === "edit") return createEditRedirectToolDefinition() as ToolDef as Tool;
	throw new Error(`Unknown tool name: ${toolName}`);
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		bash: createBashToolDefinition(cwd, options?.bash),
		subagent: createSubagentToolDefinition(options?.subagent),
		transcribe: createTranscribeToolDefinition(),
		vision: createVisionToolDefinition(),
		edit: createEditRedirectToolDefinition(),
	};
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		bash: createBashTool(cwd, options?.bash),
		subagent: createSubagentToolDefinition(options?.subagent) as ToolDef as Tool,
		transcribe: createTranscribeToolDefinition() as ToolDef as Tool,
		vision: createVisionToolDefinition() as ToolDef as Tool,
		edit: createEditRedirectToolDefinition() as ToolDef as Tool,
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createBashTool(cwd, options?.bash),
		createSubagentToolDefinition(options?.subagent) as ToolDef as Tool,
		createTranscribeToolDefinition() as ToolDef as Tool,
		createVisionToolDefinition() as ToolDef as Tool,
		createEditRedirectToolDefinition() as ToolDef as Tool,
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createBashTool(cwd, options?.bash)];
}
